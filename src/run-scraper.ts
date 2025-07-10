import { ListScraper } from './scrapers/listScraper';
import { Logger, LogLevel } from './utils/logger';

async function main() {
  const logger = Logger.getInstance();
  logger.setLogLevel(LogLevel.INFO);
  
  // Check for debug mode
  const debugMode = process.env.DEBUG === 'true' || process.argv.includes('--debug');
  
  if (debugMode) {
    logger.setLogLevel(LogLevel.DEBUG);
    logger.info('🐛 Debug mode enabled - browser will be visible and screenshots will be saved');
  }
  
  const scraper = new ListScraper(debugMode);
  
  try {
    // Parse command line arguments (filter out --debug)
    const args = process.argv.slice(2).filter(arg => arg !== '--debug');
    
    let options: { startPage?: number; endPage?: number; maxPages?: number } = {};
    
    if (args.length === 0) {
      // Default: scrape 1 page for testing
      options = { maxPages: 1 };
    } else if (args.length === 1) {
      // Single argument: maxPages (old behavior)
      options = { maxPages: parseInt(args[0]) || 1 };
    } else if (args.length === 2) {
      // Two arguments: startPage and endPage
      options = { 
        startPage: parseInt(args[0]) || 1,
        endPage: parseInt(args[1]) || 1
      };
    } else {
      logger.error('Usage: npm run scrape [maxPages] OR npm run scrape [startPage] [endPage] [--debug]');
      process.exit(1);
    }
    
    await scraper.scrapeTop5000Games(options);
    
    const progress = await scraper.getProgress();
    logger.info(`✅ Scraping completed! Total games in database: ${progress.scraped}`);
    
  } catch (error) {
    logger.error('❌ Scraping failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);