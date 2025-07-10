import { Page } from 'playwright';
import { BaseScraper } from './baseScraper';
import { Game } from '../models/Game';

interface GameDetails {
  year: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  minPlayingTime: number | null;
  maxPlayingTime: number | null;
  weight: number | null;
  languageDependenceText: string | null;
  officialAge: number | null;
  categories: string[];
  mechanisms: string[];
  families: string[];
  communityPlayerRatings: {
    playerCount: number;
    bestPercentage: number | null;
    recommendedPercentage: number | null;
    notRecommendedPercentage: number | null;
    totalVotes: number | null;
  }[];
  communityAgeRatings: {
    age: number;
    percentage: number | null;
    voteCount: number | null;
  }[];
}

export class DetailScraper extends BaseScraper {
  private workerId: string;
  private batchSize: number;

  constructor(debugMode: boolean = false, workerId?: string, batchSize: number = 10) {
    super(debugMode, 2000, 3000); // 2-3 seconds between requests for detail pages
    this.workerId = workerId || `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.batchSize = batchSize;
  }

  // Helper method to open a poll modal and wait for content
  private async openPollModal(page: Page, pollType: string): Promise<boolean> {
    try {
      const button = await page.waitForSelector(`[item-poll-button="${pollType}"]`, { timeout: 5000 });
      if (!button) {
        this.logger.debug(`${pollType} poll button not found`);
        return false;
      }

      await button.click();
      
      // Wait for modal to open and table to load
      await page.waitForSelector('.table.table-condensed.table-striped.poll-results', { timeout: 10000 });
      
      // Small delay to ensure content is fully loaded
      await page.waitForTimeout(1000);
      
      return true;
    } catch (error) {
      this.logger.debug(`Failed to open ${pollType} poll modal:`, error);
      return false;
    }
  }

  // Helper method to close any open modal
  private async closeModal(page: Page): Promise<void> {
    try {
      // Try multiple selectors for closing modals
      const closeSelectors = [
        'button[ng-click="$dismiss()"]',
        '.modal .close',
        '.modal-header .close',
        'button.close'
      ];

      for (const selector of closeSelectors) {
        try {
          const closeButton = await page.waitForSelector(selector, { timeout: 2000 });
          if (closeButton) {
            await closeButton.click();
            await page.waitForTimeout(500); // Wait for modal to close
            return;
          }
        } catch {
          // Try next selector
        }
      }
    } catch {
      // Modal might have closed automatically
    }
  }

  async scrapeGameDetails(gameId?: number): Promise<void> {
    await this.initializeScraper();
    
    try {
      // Release any games that might be claimed by this worker from previous runs
      await this.gameRepository.releaseClaimedGames(this.workerId);
      
      if (gameId) {
        // Single game mode
        const game = await this.gameRepository.findById(gameId);
        if (!game) {
          this.logger.error(`Game with ID ${gameId} not found in database`);
          return;
        }
        await this.scrapeGameDetailPage(game);
        return;
      }

      // Batch processing mode for parallel execution
      this.logger.info(`🚀 Starting parallel scraper worker: ${this.workerId}`);
      
      let totalProcessed = 0;
      let batchCount = 0;
      
      while (true) {
        // Claim a batch of games to process
        const gamesToScrape = await this.gameRepository.claimGamesForProcessing(this.workerId, this.batchSize);
        
        if (gamesToScrape.length === 0) {
          this.logger.info(`✅ No more games to process. Worker ${this.workerId} finished.`);
          break;
        }
        
        batchCount++;
        this.logger.info(`📦 Batch ${batchCount}: Processing ${gamesToScrape.length} games`);
        
        // Process each game in the batch
        for (const game of gamesToScrape) {
          try {
            await this.rateLimiter.throttle(async () => {
              await this.scrapeGameDetailPage(game);
            });
            
            totalProcessed++;
            this.logger.info(`✅ [${this.workerId}] Completed ${totalProcessed} games - ${game.name}`);
            
          } catch (error) {
            this.logger.error(`❌ [${this.workerId}] Failed to scrape ${game.name}:`, error);
          }
        }
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      this.logger.info(`🎉 Worker ${this.workerId} completed! Total games processed: ${totalProcessed}`);
      
    } catch (error) {
      this.logger.error(`❌ Worker ${this.workerId} error:`, error);
      throw error;
    } finally {
      // Clean up any remaining claimed games
      await this.gameRepository.releaseClaimedGames(this.workerId);
      await this.cleanupScraper();
    }
  }

  private async scrapeGameDetailPage(game: Pick<Game, 'id' | 'bggUrl' | 'name'>): Promise<void> {
    const page = await this.browser.newPage();
    
    try {
      this.logger.debug(`Scraping details for: ${game.name}`);
      
      // Navigate to game detail page
      await page.goto(game.bggUrl, { waitUntil: 'load', timeout: 30000 });
      
      // Handle login if required
      await this.handleLoginIfRequired(page);
      
      if (this.debugMode) {
        await this.browser.debugPageContent(page, `game-${game.id}-main`);
      }
      
      // Extract game details from main page
      const gameDetails = await this.extractGameDetails(page);
      this.logger.debug(`Extracted game details:`, gameDetails);
      
      // Extract community player count data
      const communityPlayerData = await this.extractCommunityPlayerData(page);
      gameDetails.communityPlayerRatings = communityPlayerData;
      this.logger.debug(`Community player data:`, communityPlayerData);
      
      // Extract community age data
      const communityAgeData = await this.extractCommunityAgeData(page);
      gameDetails.communityAgeRatings = communityAgeData;
      this.logger.debug(`Community age data:`, communityAgeData);
      
      // Navigate to credits page for categories/mechanisms/families
      const creditsData = await this.scrapeCreditsPage(page, game.bggUrl);
      gameDetails.categories = creditsData.categories;
      gameDetails.mechanisms = creditsData.mechanisms;
      gameDetails.families = creditsData.families;
      this.logger.debug(`Credits data:`, creditsData);
      
      // Update game with all details
      this.logger.debug(`Updating game ${game.id} with details:`, gameDetails);
      await this.updateGameWithDetails(game.id, gameDetails);
      
      this.logger.debug(`Successfully scraped details for: ${game.name}`);
    } catch (error) {
      this.logger.error(`Error scraping details for ${game.name}:`, error);
      
      // Take debug screenshot on error
      try {
        await this.browser.debugPageContent(page, `game-${game.id}-error`);
      } catch (debugError) {
        this.logger.error('Failed to take debug screenshot:', debugError);
      }
      
      throw error;
    } finally {
      await page.close();
    }
  }

  private async extractGameDetails(page: Page): Promise<GameDetails> {
    return await page.evaluate(() => {
      const details: GameDetails = {
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
        families: [],
        communityPlayerRatings: [],
        communityAgeRatings: []
      };
      
      try {
        // Extract data from BGG's JavaScript object
        const gameData = (window as any).GEEK?.geekitemPreload?.item;
        
        if (gameData) {
          // Extract year published
          if (gameData?.yearpublished) {
            details.year = parseInt(gameData.yearpublished);
          }
          
          // Extract player count
          if (gameData?.minplayers) {
            details.minPlayers = parseInt(gameData.minplayers);
          }
          if (gameData?.maxplayers) {
            details.maxPlayers = parseInt(gameData.maxplayers);
          }
          
          // Extract playing time
          if (gameData?.minplaytime) {
            details.minPlayingTime = parseInt(gameData.minplaytime);
          }
          if (gameData?.maxplaytime) {
            details.maxPlayingTime = parseInt(gameData.maxplaytime);
          }
          
          // Extract age recommendation
          if (gameData?.minage) {
            details.officialAge = parseInt(gameData.minage);
          }
          
          // Extract weight/complexity
          if (gameData?.polls?.boardgameweight?.averageweight) {
            details.weight = parseFloat(gameData.polls.boardgameweight.averageweight);
          }
          
          // Extract language dependence
          if (gameData?.polls?.languagedependence) {
            details.languageDependenceText = gameData.polls.languagedependence;
          }
          
          console.log('Successfully extracted game data from GEEK object:', details);
        } else {
          console.log('GEEK.geekitemPreload.item not found');
        }
      } catch (error) {
        console.error('Error extracting game details:', error);
      }
      
      return details;
    });
  }

  private async extractCommunityPlayerData(page: Page): Promise<GameDetails['communityPlayerRatings']> {
    try {
      // Open the player count poll modal
      const modalOpened = await this.openPollModal(page, 'numplayers');
      if (!modalOpened) {
        return [];
      }
      
      // Extract data from the poll results table
      const communityPlayerRatings = await page.evaluate(() => {
        const ratings: GameDetails['communityPlayerRatings'] = [];
        
        const table = document.querySelector('.table.table-condensed.table-striped.poll-results');
        if (!table) return ratings;
        
        const rows = table.querySelectorAll('tbody tr[ng-repeat="row in question.results.question.choicesr"]');
        
        rows.forEach(row => {
          const playerCountCell = row.querySelector('th');
          if (playerCountCell) {
            const playerCountText = playerCountCell.textContent?.trim();
            if (playerCountText) {
              let playerCount: number;
              
              // Handle special cases like "more than 4"
              if (playerCountText.includes('more than')) {
                playerCount = 99; // Use 99 for "more than X"
              } else {
                playerCount = parseInt(playerCountText);
              }
              
              if (!isNaN(playerCount)) {
                const dataCells = row.querySelectorAll('td[ng-repeat="column in question.results.question.choicesc"]');
                const voteCountCell = row.querySelector('td.ng-binding:last-child');
                
                let bestPercentage: number | null = null;
                let recommendedPercentage: number | null = null;
                let notRecommendedPercentage: number | null = null;
                let totalVotes: number | null = null;
                
                // Extract percentages from the three data cells (Best, Recommended, Not Recommended)
                if (dataCells.length >= 3) {
                  const bestText = dataCells[0].textContent?.trim();
                  const recommendedText = dataCells[1].textContent?.trim();
                  const notRecommendedText = dataCells[2].textContent?.trim();
                  
                  if (bestText) {
                    const bestMatch = bestText.match(/([\d.]+)%/);
                    if (bestMatch) bestPercentage = parseFloat(bestMatch[1]);
                  }
                  
                  if (recommendedText) {
                    const recommendedMatch = recommendedText.match(/([\d.]+)%/);
                    if (recommendedMatch) recommendedPercentage = parseFloat(recommendedMatch[1]);
                  }
                  
                  if (notRecommendedText) {
                    const notRecommendedMatch = notRecommendedText.match(/([\d.]+)%/);
                    if (notRecommendedMatch) notRecommendedPercentage = parseFloat(notRecommendedMatch[1]);
                  }
                }
                
                // Extract total votes
                if (voteCountCell) {
                  const voteText = voteCountCell.textContent?.trim();
                  if (voteText) {
                    const voteCount = parseInt(voteText);
                    if (!isNaN(voteCount)) totalVotes = voteCount;
                  }
                }
                
                ratings.push({
                  playerCount,
                  bestPercentage,
                  recommendedPercentage,
                  notRecommendedPercentage,
                  totalVotes
                });
              }
            }
          }
        });
        
        return ratings;
      });
      
      // Close the modal
      await this.closeModal(page);
      
      return communityPlayerRatings;
    } catch (error) {
      this.logger.error('Error extracting community player data:', error);
      return [];
    }
  }

  private async extractCommunityAgeData(page: Page): Promise<GameDetails['communityAgeRatings']> {
    try {
      // Open the age poll modal
      const modalOpened = await this.openPollModal(page, 'playerage');
      if (!modalOpened) {
        return [];
      }
      
      // Extract data from the poll results table
      const communityAgeRatings = await page.evaluate(() => {
        const ratings: GameDetails['communityAgeRatings'] = [];
        
        const tables = document.querySelectorAll('.table.table-condensed.table-striped.poll-results');
        
        // Look for the minimum age table (usually the first one)
        const minAgeTable = tables[0];
        if (minAgeTable) {
          const rows = minAgeTable.querySelectorAll('tbody tr[ng-repeat="column in question.results.question.choicesc"]');
          
          rows.forEach(row => {
            const ageCell = row.querySelector('th span');
            if (ageCell) {
              const ageText = ageCell.textContent?.trim();
              if (ageText) {
                let age: number;
                
                // Handle special cases like "21 and up"
                if (ageText.includes('and up')) {
                  age = parseInt(ageText) || 21; // Default to 21 if parsing fails
                } else {
                  age = parseInt(ageText);
                }
                
                if (!isNaN(age)) {
                  const cells = row.querySelectorAll('td');
                  let percentage: number | null = null;
                  let voteCount: number | null = null;
                  
                  // Find percentage cell (usually 3rd cell, contains % sign)
                  for (let i = 0; i < cells.length; i++) {
                    const cellText = cells[i].textContent?.trim();
                    if (cellText && cellText.includes('%')) {
                      const percentageMatch = cellText.match(/([\d.]+)%/);
                      if (percentageMatch) {
                        percentage = parseFloat(percentageMatch[1]);
                      }
                    }
                  }
                  
                  // Find vote count cell (usually last cell with just a number)
                  const lastCell = cells[cells.length - 1];
                  if (lastCell) {
                    const voteText = lastCell.textContent?.trim();
                    if (voteText) {
                      const voteMatch = voteText.match(/^(\d+)$/);
                      if (voteMatch) {
                        voteCount = parseInt(voteMatch[1]);
                      }
                    }
                  }
                  
                  ratings.push({
                    age,
                    percentage,
                    voteCount
                  });
                }
              }
            }
          });
        }
        
        return ratings;
      });
      
      // Close the modal
      await this.closeModal(page);
      
      return communityAgeRatings;
    } catch (error) {
      this.logger.error('Error extracting community age data:', error);
      return [];
    }
  }

  private async scrapeCreditsPage(page: Page, gameUrl: string): Promise<{categories: string[], mechanisms: string[], families: string[]}> {
    const creditsUrl = gameUrl + '/credits';
    
    try {
      await page.goto(creditsUrl, { waitUntil: 'load', timeout: 30000 });
      
      // Handle login if required
      await this.handleLoginIfRequired(page);
      
      if (this.debugMode) {
        await this.browser.debugPageContent(page, `credits-page`);
      }
      
      return await page.evaluate(() => {
        const result = {
          categories: [] as string[],
          mechanisms: [] as string[],
          families: [] as string[]
        };
        
        // Extract categories
        const categoryLinks = document.querySelectorAll('a[href*="/boardgamecategory/"]');
        categoryLinks.forEach(link => {
          const categoryName = link.textContent?.trim();
          if (categoryName) {
            result.categories.push(categoryName);
          }
        });
        
        // Extract mechanisms
        const mechanismLinks = document.querySelectorAll('a[href*="/boardgamemechanic/"]');
        mechanismLinks.forEach(link => {
          const mechanismName = link.textContent?.trim();
          if (mechanismName) {
            result.mechanisms.push(mechanismName);
          }
        });
        
        // Extract families
        const familyLinks = document.querySelectorAll('a[href*="/boardgamefamily/"]');
        familyLinks.forEach(link => {
          const familyName = link.textContent?.trim();
          if (familyName) {
            result.families.push(familyName);
          }
        });
        
        return result;
      });
    } catch (error) {
      this.logger.error('Error scraping credits page:', error);
      return { categories: [], mechanisms: [], families: [] };
    }
  }

  private async updateGameWithDetails(gameId: number, details: GameDetails): Promise<void> {
    await this.gameRepository.updateGameWithAllDetails(gameId, details);
  }
}