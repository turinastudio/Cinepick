import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DomainRateLimiter } from '../../lib/rate-limiter.js';

describe('DomainRateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new DomainRateLimiter({ minDelay: 10, maxDelay: 20 });
  });

  it('should allow immediate access when no pending requests', async () => {
    const start = Date.now();
    await limiter.waitForDomain('example.com');
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `Should be fast, took ${elapsed}ms`);
  });

  it('should enforce minimum delay between requests to same domain', async () => {
    await limiter.waitForDomain('example.com');

    const start = Date.now();
    await limiter.waitForDomain('example.com');
    const elapsed = Date.now() - start;
    // With minDelay=10 and some jitter, should be at least 10ms
    assert.ok(elapsed >= 8, `Should wait, took ${elapsed}ms`);
  });

  it('should not block requests to different domains', async () => {
    await limiter.waitForDomain('example.com');
    const start = Date.now();
    await limiter.waitForDomain('other.com');
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `Different domain should be fast, took ${elapsed}ms`);
  });

  it('should extract domain from URL', () => {
    const domain = limiter._getDomain('https://example.com/path?query=1');
    assert.strictEqual(domain, 'example.com');
  });

  it('should handle invalid URLs gracefully', () => {
    const domain = limiter._getDomain('not-a-valid-url');
    assert.strictEqual(domain, 'not-a-valid-url');
  });

  it('should record requests manually', () => {
    limiter.recordRequest('https://example.com/test');
    const stats = limiter.getStats();
    assert.ok(stats['example.com'] !== undefined, 'Should track example.com');
  });

  it('should return stats for tracked domains', () => {
    limiter.recordRequest('https://example.com/test');
    const stats = limiter.getStats();
    assert.ok(typeof stats['example.com'].lastRequestMsAgo === 'number');
    assert.ok(typeof stats['example.com'].queuedRequests === 'number');
  });
});
