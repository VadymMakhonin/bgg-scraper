import { Browser, BrowserContext, Page, chromium } from 'playwright';

export class BrowserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private headless: boolean = true;

  constructor(headless: boolean = true) {
    this.headless = headless;
  }

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.headless,
      slowMo: this.headless ? 0 : 1000, // Slow down for visual debugging
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York'
    });

    // Add request interception to handle rate limiting
    this.context.route('**/*', async (route) => {
      const request = route.request();
      
      // Add delay for BGG requests to be respectful
      if (request.url().includes('boardgamegeek.com')) {
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
      }
      
      await route.continue();
    });
  }

  async newPage(): Promise<Page> {
    if (!this.context) {
      throw new Error('Browser context not initialized. Call launch() first.');
    }
    
    return await this.context.newPage();
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async waitForSelector(page: Page, selector: string, timeout: number = 30000): Promise<void> {
    try {
      await page.waitForSelector(selector, { timeout });
    } catch (error) {
      throw new Error(`Timeout waiting for selector: ${selector}`);
    }
  }

  async safeClick(page: Page, selector: string): Promise<void> {
    await this.waitForSelector(page, selector);
    await page.click(selector);
  }

  async safeGetText(page: Page, selector: string): Promise<string | null> {
    try {
      const element = await page.waitForSelector(selector, { timeout: 5000 });
      return element ? await element.textContent() : null;
    } catch {
      return null;
    }
  }

  async safeGetAttribute(page: Page, selector: string, attribute: string): Promise<string | null> {
    try {
      const element = await page.waitForSelector(selector, { timeout: 5000 });
      return element ? await element.getAttribute(attribute) : null;
    } catch {
      return null;
    }
  }

  async takeScreenshot(page: Page, filename: string): Promise<void> {
    await page.screenshot({ 
      path: `screenshots/${filename}`,
      fullPage: true 
    });
  }

  async debugPageContent(page: Page, pageName: string): Promise<void> {
    // Create screenshots directory if it doesn't exist
    const fs = require('fs');
    if (!fs.existsSync('screenshots')) {
      fs.mkdirSync('screenshots');
    }

    // Take screenshot
    await this.takeScreenshot(page, `${pageName}-screenshot.png`);

    // Log page info
    const url = page.url();
    const title = await page.title();
    const content = await page.content();
    
    console.log(`\n=== DEBUG INFO FOR ${pageName} ===`);
    console.log(`URL: ${url}`);
    console.log(`Title: ${title}`);
    console.log(`Content length: ${content.length} characters`);
    console.log(`Screenshot saved: screenshots/${pageName}-screenshot.png`);
    
    // Save HTML content
    fs.writeFileSync(`screenshots/${pageName}-content.html`, content);
    console.log(`HTML content saved: screenshots/${pageName}-content.html`);
  }

  async isLoginRequired(page: Page): Promise<boolean> {
    const url = page.url();
    const title = await page.title();
    
    return url.includes('/login') || 
           title.toLowerCase().includes('login') ||
           title.toLowerCase().includes('log in');
  }

  async loginToBGG(page: Page, username: string, password: string): Promise<void> {
    console.log('🔐 BGG login required, attempting to authenticate...');
    
    try {
      // First, handle cookie modal if it appears
      await this.handleCookieModal(page);
      
      // Wait for login form
      await page.waitForSelector('input[name="username"]', { timeout: 10000 });
      await page.waitForSelector('input[name="password"]', { timeout: 10000 });
      
      // Fill in credentials
      await page.fill('input[name="username"]', username);
      await page.fill('input[name="password"]', password);
      
      // Submit form
      await page.click('button[type="submit"], input[type="submit"]');
      
      // Wait for redirect after login - but handle cases where we're already redirected
      try {
        await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 });
      } catch (navError) {
        // If navigation times out, check if we're already on the target page
        console.log('🔄 Navigation timeout, checking if login was successful...');
        
        // Wait a bit for any pending redirects
        await page.waitForTimeout(3000);
      }
      
      // Verify we're not still on login page
      const stillOnLogin = await this.isLoginRequired(page);
      if (stillOnLogin) {
        throw new Error('Login failed - still on login page');
      }
      
      console.log('✅ Successfully logged in to BGG');
    } catch (error) {
      console.error('❌ BGG login failed:', error);
      throw error;
    }
  }

  async handleCookieModal(page: Page): Promise<void> {
    try {
      // Common selectors for cookie acceptance buttons
      const cookieSelectors = [
        'button:has-text("I\'m OK with that")',
        'button:has-text("Accept")',
        'button:has-text("OK")',
        'button:has-text("Accept All")',
        'button:has-text("Accept Cookies")',
        '.cookie-accept',
        '.cookie-ok',
        '#cookie-accept',
        '#cookie-ok',
        '[data-testid="cookie-accept"]'
      ];

      console.log('🍪 Checking for cookie modal...');
      
      for (const selector of cookieSelectors) {
        try {
          const element = await page.waitForSelector(selector, { timeout: 3000 });
          if (element) {
            console.log(`🍪 Found cookie modal, clicking: ${selector}`);
            await element.click();
            await page.waitForTimeout(1000); // Wait for modal to close
            return;
          }
        } catch {
          // Try next selector
        }
      }
      
      // If no cookie modal found, that's fine
      console.log('🍪 No cookie modal found, proceeding...');
    } catch (error) {
      console.log('🍪 Error handling cookie modal (proceeding anyway):', error);
    }
  }
}