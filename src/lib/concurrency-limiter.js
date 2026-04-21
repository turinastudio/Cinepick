/**
 * Concurrency limiter for async operations.
 *
 * Limits the number of concurrent executions to avoid overwhelming
 * external services and exhausting system resources.
 *
 * Usage:
 *   const limiter = new ConcurrencyLimiter(6);
 *   const results = await Promise.all(
 *     items.map(item => limiter.enqueue(() => doWork(item)))
 *   );
 */

export class ConcurrencyLimiter {
  constructor(maxConcurrent = 6) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  async enqueue(fn) {
    if (this.running >= this.maxConcurrent) {
      await new Promise((resolve) => this.queue.push(resolve));
    }

    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this._processQueue();
    }
  }

  _processQueue() {
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const next = this.queue.shift();
      next();
    }
  }

  get stats() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent
    };
  }
}

// Singleton instance for provider scraping
const PROVIDER_CONCURRENCY = Math.max(
  2,
  Math.min(12, Number.parseInt(process.env.PROVIDER_MAX_CONCURRENT || "6", 10))
);

export const providerLimiter = new ConcurrencyLimiter(PROVIDER_CONCURRENCY);
