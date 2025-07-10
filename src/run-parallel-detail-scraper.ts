import { DetailScraper } from './scrapers/detailScraper';
import { Logger, LogLevel } from './utils/logger';
import { spawn } from 'child_process';

async function runSingleWorker(workerId: string, debugMode: boolean = false): Promise<void> {
  const logger = Logger.getInstance();
  logger.setLogLevel(debugMode ? LogLevel.DEBUG : LogLevel.INFO);
  
  const scraper = new DetailScraper(debugMode, workerId, 5); // Batch size of 5
  
  try {
    await scraper.scrapeGameDetails();
    logger.info(`🎉 Worker ${workerId} completed successfully`);
  } catch (error) {
    logger.error(`❌ Worker ${workerId} failed:`, error);
    throw error;
  }
}

async function runParallelScrapers() {
  // Parse command line arguments
  const args = process.argv.slice(2).filter(arg => arg !== '--debug' && arg !== '--single-process');
  const debugMode = process.env.DEBUG === 'true' || process.argv.includes('--debug');
  
  let numWorkers = 5; // default
  
  if (args.length === 1) {
    const parsedWorkers = parseInt(args[0]);
    if (isNaN(parsedWorkers) || parsedWorkers < 1 || parsedWorkers > 20) {
      console.error('❌ Number of workers must be between 1 and 20');
      console.error('Usage: npm run scrape:details:parallel [numWorkers] [--debug] [--single-process]');
      process.exit(1);
    }
    numWorkers = parsedWorkers;
  } else if (args.length > 1) {
    console.error('❌ Too many arguments');
    console.error('Usage: npm run scrape:details:parallel [numWorkers] [--debug] [--single-process]');
    process.exit(1);
  }
  
  // Environment variable can still override if no command line argument provided
  if (args.length === 0 && process.env.WORKERS) {
    numWorkers = parseInt(process.env.WORKERS) || 5;
  }
  
  console.log(`🚀 Starting ${numWorkers} parallel detail scrapers...`);
  
  // Global cleanup: Release all claimed games before starting
  console.log('🧹 Releasing all claimed games from previous runs...');
  try {
    const tempScraper = new DetailScraper(false, 'cleanup-worker');
    const released = await tempScraper['gameRepository'].releaseAllClaimedGames();
    console.log(`✅ Released ${released.count} previously claimed games`);
  } catch (error) {
    console.error('⚠️  Failed to release claimed games:', error);
    console.log('Continuing anyway...');
  }
  
  if (process.argv.includes('--single-process')) {
    // Run all workers in the same process (for debugging)
    const workers = [];
    for (let i = 1; i <= numWorkers; i++) {
      const workerId = `worker-${i}`;
      workers.push(runSingleWorker(workerId, debugMode));
    }
    
    try {
      await Promise.all(workers);
      console.log('🎉 All workers completed successfully!');
    } catch (error) {
      console.error('❌ Some workers failed:', error);
      process.exit(1);
    }
  } else {
    // Run each worker in a separate process (recommended for production)
    const workers = [];
    
    for (let i = 1; i <= numWorkers; i++) {
      const workerId = `worker-${i}`;
      console.log(`🚀 Starting worker ${workerId}...`);
      
      const args = ['src/run-detail-scraper.ts', workerId];
      if (debugMode) args.push('--debug');
      
      const worker = spawn('ts-node', args, {
        stdio: 'inherit',
        env: { ...process.env, WORKER_ID: workerId }
      });
      
      workers.push(new Promise((resolve, reject) => {
        worker.on('exit', (code) => {
          if (code === 0) {
            console.log(`✅ Worker ${workerId} completed successfully`);
            resolve(workerId);
          } else {
            console.error(`❌ Worker ${workerId} failed with code ${code}`);
            reject(new Error(`Worker ${workerId} failed`));
          }
        });
        
        worker.on('error', (error) => {
          console.error(`❌ Worker ${workerId} error:`, error);
          reject(error);
        });
      }));
    }
    
    try {
      await Promise.all(workers);
      console.log('🎉 All workers completed successfully!');
    } catch (error) {
      console.error('❌ Some workers failed:', error);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  runParallelScrapers().catch(console.error);
}