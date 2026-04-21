/**
 * Per-domain rate limiter for scraping.
 *
 * Prevents overwhelming individual sites by enforcing minimum
 * delays between requests to the same domain.
 *
 * Usage:
 *   await rateLimiter.waitForDomain("gnula.life");
 *   // ... make request ...
 */

const DEFAULT_MIN_DELAY_MS = 500;    // Minimum gap between requests
const DEFAULT_MAX_DELAY_MS = 2000;   // Maximum random jitter added
const MAX_QUEUE_PER_DOMAIN = 5;      // Max pending requests per domain

/**
 * Tracks last request time per domain and manages wait queue.
 */
class DomainRateLimiter {
  constructor(options = {}) {
    this.minDelay = options.minDelay ?? DEFAULT_MIN_DELAY_MS;
    this.maxDelay = options.maxDelay ?? DEFAULT_MAX_DELAY_MS;
    this.lastRequest = new Map();  // domain -> timestamp
    this.queue = new Map();        // domain -> Promise[]
  }

  /**
   * Extract domain from URL.
   */
  _getDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return String(url);
    }
  }

  /**
   * Wait until it's safe to make a request to this domain.
   *
   * @param {string} url - The URL about to be requested
   * @returns {Promise<void>}
   */
  async waitForDomain(url) {
    const domain = this._getDomain(url);
    const now = Date.now();

    if (!this.queue.has(domain)) {
      this.queue.set(domain, []);
    }

    return new Promise((resolve) => {
      this.queue.get(domain).push(resolve);

      // If this is the first in queue, process immediately or after delay
      if (this.queue.get(domain).length === 1) {
        this._processQueue(domain);
      }
    });
  }

  /**
   * Process the wait queue for a domain.
   */
  async _processQueue(domain) {
    const queue = this.queue.get(domain);
    if (!queue || queue.length === 0) return;

    const lastReq = this.lastRequest.get(domain) || 0;
    const elapsed = Date.now() - lastReq;
    const neededDelay = Math.max(0, this.minDelay - elapsed);
    const jitter = Math.random() * (this.maxDelay - this.minDelay);
    const waitMs = neededDelay + jitter;

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    // Release the first waiter
    this.lastRequest.set(domain, Date.now());
    const next = queue.shift();
    if (next) next();

    // Process remaining queue
    if (queue.length > 0) {
      this._processQueue(domain);
    }
  }

  /**
   * Record a request was made (for external tracking).
   * @param {string} url
   */
  recordRequest(url) {
    const domain = this._getDomain(url);
    this.lastRequest.set(domain, Date.now());
  }

  /**
   * Get current rate limiter stats.
   * @returns {object}
   */
  getStats() {
    const stats = {};
    for (const [domain, lastReq] of this.lastRequest) {
      const elapsed = Date.now() - lastReq;
      const queueLen = this.queue.get(domain)?.length || 0;
      stats[domain] = {
        lastRequestMsAgo: Math.round(elapsed),
        queuedRequests: queueLen,
        readyForNext: elapsed >= this.minDelay
      };
    }
    return stats;
  }
}

// Singleton instance for the addon
export const rateLimiter = new DomainRateLimiter({
  minDelay: Number.parseInt(process.env.SCRAPING_MIN_DELAY_MS || "500", 10) || DEFAULT_MIN_DELAY_MS,
  maxDelay: Number.parseInt(process.env.SCRAPING_MAX_DELAY_MS || "2000", 10) || DEFAULT_MAX_DELAY_MS
});

export { DomainRateLimiter };
