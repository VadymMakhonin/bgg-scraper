import { DetailScraper } from './scrapers/detailScraper';
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
  
  // Parse command line arguments (filter out --debug)
  const args = process.argv.slice(2).filter(arg => arg !== '--debug');
  
  let gameId: number | undefined;
  let workerId: string | undefined;
  
  if (args.length === 1) {
    // Check if it's a worker ID or game ID
    if (args[0].startsWith('worker-') || process.env.WORKER_ID) {
      // Worker mode
      workerId = args[0] || process.env.WORKER_ID;
      logger.info(`🔍 Starting worker ${workerId} for parallel scraping`);
    } else {
      // Single game mode
      gameId = parseInt(args[0]);
      if (isNaN(gameId)) {
        logger.error('Game ID must be a valid number');
        process.exit(1);
      }
      logger.info(`🎯 Scraping details for specific game ID: ${gameId}`);
    }
  } else if (args.length === 0) {
    // No arguments: scrape all games that need detailed scraping
    logger.info('🔍 Scraping details for all games that need detailed information');
  } else {
    logger.error('Usage: npm run scrape:details [gameId|workerId] [--debug]');
    logger.error('  - No arguments: scrape all games needing details');
    logger.error('  - gameId: scrape specific game by ID');
    logger.error('  - workerId: run as parallel worker');
    process.exit(1);
  }
  
  const scraper = new DetailScraper(debugMode, workerId, 5);
  
  try {
    // Global cleanup: Release all claimed games before starting (for both single and parallel modes)
    if (!gameId) { // Only do global cleanup when processing multiple games
      logger.info('🧹 Releasing all claimed games from previous runs...');
      const released = await scraper['gameRepository'].releaseAllClaimedGames();
      logger.info(`✅ Released ${released.count} previously claimed games`);
    }
    
    await scraper.scrapeGameDetails(gameId);
    
    logger.info('✅ Detail scraping completed successfully!');
    
  } catch (error) {
    logger.error('❌ Detail scraping failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);