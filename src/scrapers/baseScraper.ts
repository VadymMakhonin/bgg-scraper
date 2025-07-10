import { BrowserService } from '../utils/browser';
import { RateLimiter } from '../utils/rateLimiter';
import { Logger } from '../utils/logger';
import { GameRepository } from '../repositories/GameRepository';
import { PrismaService } from '../database/PrismaService';

export abstract class BaseScraper {
  protected browser: BrowserService;
  protected rateLimiter: RateLimiter;
  protected logger: Logger;
  protected gameRepository: GameRepository;
  protected prisma: PrismaService;
  protected debugMode: boolean;

  constructor(debugMode: boolean = false, minDelay: number = 1500, maxDelay: number = 2500) {
    this.browser = new BrowserService(!debugMode);
    this.rateLimiter = new RateLimiter(minDelay, maxDelay);
    this.logger = Logger.getInstance();
    this.gameRepository = new GameRepository();
    this.prisma = PrismaService.getInstance();
    this.debugMode = debugMode;
  }

  protected async initializeScraper(): Promise<void> {
    await this.prisma.connect();
    await this.browser.launch();
    await this.performInitialLogin();
  }

  protected async cleanupScraper(): Promise<void> {
    await this.browser.close();
    await this.prisma.disconnect();
  }

  protected async performInitialLogin(): Promise<void> {
    const username = process.env.BGG_USERNAME;
    const password = process.env.BGG_PASSWORD;
    
    if (!username || !password) {
      this.logger.warn('⚠️ BGG credentials not found in .env file. Continuing without login (may fail on later pages).');
      return;
    }
    
    this.logger.info('🔐 Performing initial BGG login...');
    
    const page = await this.browser.newPage();
    
    try {
      await page.goto('https://boardgamegeek.com/login', { waitUntil: 'load', timeout: 30000 });
      await this.browser.loginToBGG(page, username, password);
      this.logger.info('✅ Initial login successful - ready to scrape');
    } catch (error) {
      this.logger.error('❌ Initial login failed:', error);
      throw error;
    } finally {
      await page.close();
    }
  }

  protected async handleLoginIfRequired(page: any): Promise<void> {
    const loginRequired = await this.browser.isLoginRequired(page);
    if (loginRequired) {
      this.logger.warn(`⚠️ Login session expired, re-authenticating...`);
      const username = process.env.BGG_USERNAME;
      const password = process.env.BGG_PASSWORD;
      
      if (!username || !password) {
        throw new Error('BGG login required but BGG_USERNAME and BGG_PASSWORD not set in .env file');
      }
      
      await this.browser.loginToBGG(page, username, password);
    }
  }
}