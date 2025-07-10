import { Page } from 'playwright';
import { BaseScraper } from './baseScraper';

interface GameListItem {
  rank: number;
  name: string;
  bggUrl: string;
}

export class ListScraper extends BaseScraper {
  constructor(debugMode: boolean = false) {
    super(debugMode, 1500, 2500); // 1.5-2.5 seconds between requests
  }

  async scrapeTop5000Games(options: { startPage?: number; endPage?: number; maxPages?: number } = {}): Promise<void> {
    await this.initializeScraper();
    
    let startPage = options.startPage || 1;
    let endPage = options.endPage || options.maxPages || 50;
    
    // If only maxPages is provided, use the old behavior (start from 1)
    if (options.maxPages && !options.startPage && !options.endPage) {
      startPage = 1;
      endPage = options.maxPages;
    }
    
    const totalPages = endPage - startPage + 1;
    const totalGames = totalPages * 100;
    
    this.logger.info(`Starting to scrape ${totalGames} games from BGG (pages ${startPage} to ${endPage})`);
    
    try {
      let currentProgress = 0;
      
      for (let page = startPage; page <= endPage; page++) {
        await this.rateLimiter.throttle(async () => {
          await this.scrapePage(page);
        });
        
        currentProgress++;
        this.logger.progress(currentProgress, totalPages, `Page ${page}`);
      }
      
      this.logger.info(`Successfully scraped ${totalGames} games (pages ${startPage}-${endPage})`);
    } catch (error) {
      this.logger.error('Error scraping games list:', error);
      throw error;
    } finally {
      await this.cleanupScraper();
    }
  }

  private async scrapePage(pageNumber: number): Promise<void> {
    const url = `https://boardgamegeek.com/browse/boardgame/page/${pageNumber}`;
    this.logger.debug(`Scraping page ${pageNumber}: ${url}`);
    
    const page = await this.browser.newPage();
    
    try {
      // Navigate to the page - we should already be authenticated
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      
      // Just in case login session expired, check if we need to login again
      await this.handleLoginIfRequired(page);
      
      // Navigate back to the target page after re-login if needed
      if (await this.browser.isLoginRequired(page)) {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      }
      
      if (this.debugMode) {
        await this.browser.debugPageContent(page, `page-${pageNumber}-loaded`);
      }
      
      // Wait for the game list to load with better error handling
      try {
        await this.browser.waitForSelector(page, 'tr[id^="row_"]', 30000);
      } catch (selectorError) {
        this.logger.error(`Failed to find game rows on page ${pageNumber}`);
        
        // Debug: Take screenshot and save HTML
        await this.browser.debugPageContent(page, `page-${pageNumber}-error`);
        
        // Try alternative selectors
        const alternativeSelectors = [
          '.collection_table tbody tr',
          '#collectionitems tr',
          'table tr[id]',
          '.collection_objectname'
        ];
        
        for (const selector of alternativeSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 5000 });
            this.logger.info(`Found alternative selector: ${selector}`);
            break;
          } catch {
            this.logger.debug(`Alternative selector failed: ${selector}`);
          }
        }
        
        throw selectorError;
      }
      
      const games = await this.extractGamesFromPage(page);
      
      if (games.length === 0) {
        this.logger.warn(`No games found on page ${pageNumber}`);
        if (this.debugMode) {
          await this.browser.debugPageContent(page, `page-${pageNumber}-no-games`);
        }
      }
      
      for (const game of games) {
        await this.saveGame(game);
      }
      
      this.logger.debug(`Successfully scraped ${games.length} games from page ${pageNumber}`);
    } catch (error) {
      this.logger.error(`Error scraping page ${pageNumber}:`, error);
      
      // Always take debug screenshot on error
      try {
        await this.browser.debugPageContent(page, `page-${pageNumber}-error`);
      } catch (debugError) {
        this.logger.error('Failed to take debug screenshot:', debugError);
      }
      
      throw error;
    } finally {
      await page.close();
    }
  }

  private async extractGamesFromPage(page: Page): Promise<GameListItem[]> {
    return await page.evaluate(() => {
      const games: GameListItem[] = [];
      const rows = document.querySelectorAll('tr[id^="row_"]');
      
      rows.forEach(row => {
        try {
          // Extract rank
          const rankCell = row.querySelector('td.collection_rank');
          if (!rankCell) return;
          
          const rankText = rankCell.textContent?.trim();
          if (!rankText) return;
          
          const rank = parseInt(rankText);
          if (isNaN(rank)) return;
          
          // Extract game name and URL
          const nameLink = row.querySelector('td.collection_objectname a');
          if (!nameLink) return;
          
          const name = nameLink.textContent?.trim();
          if (!name) return;
          
          const href = nameLink.getAttribute('href');
          if (!href) return;
          
          const bggUrl = `https://boardgamegeek.com${href}`;
          
          games.push({
            rank,
            name,
            bggUrl
          });
        } catch (error) {
          console.error('Error extracting game from row:', error);
        }
      });
      
      return games;
    });
  }

  private async saveGame(game: GameListItem): Promise<void> {
    try {
      // Check if game already exists
      const existingGame = await this.gameRepository.findByBggUrl(game.bggUrl);
      
      if (existingGame) {
        this.logger.debug(`Game already exists: ${game.name} (rank ${game.rank})`);
        return;
      }
      
      // Create new game record
      await this.gameRepository.createGame({
        rank: game.rank,
        name: game.name,
        bggUrl: game.bggUrl,
        year: null,
        minPlayers: null,
        maxPlayers: null,
        minPlayingTime: null,
        maxPlayingTime: null,
        weight: null,
        languageDependenceText: null,
        officialAge: null,
        categories: [],
        mechanisms: [],
        families: []
      });
      
      this.logger.debug(`Saved game: ${game.name} (rank ${game.rank})`);
    } catch (error) {
      this.logger.error(`Error saving game ${game.name}:`, error);
      throw error;
    }
  }

  async getProgress(): Promise<{ scraped: number; total: number }> {
    const stats = await this.gameRepository.getStats();
    return {
      scraped: stats.totalGames,
      total: 5000
    };
  }
}