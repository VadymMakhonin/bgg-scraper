export class RateLimiter {
  private queue: Array<() => void> = [];
  private running = false;
  private minDelay: number;
  private maxDelay: number;
  private lastRequestTime = 0;

  constructor(minDelay: number = 1000, maxDelay: number = 2000) {
    this.minDelay = minDelay;
    this.maxDelay = maxDelay;
  }

  async throttle<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.running || this.queue.length === 0) {
      return;
    }

    this.running = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      const randomDelay = this.minDelay + Math.random() * (this.maxDelay - this.minDelay);
      
      const waitTime = Math.max(0, randomDelay - timeSinceLastRequest);
      
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      const task = this.queue.shift();
      if (task) {
        this.lastRequestTime = Date.now();
        await task();
      }
    }

    this.running = false;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}