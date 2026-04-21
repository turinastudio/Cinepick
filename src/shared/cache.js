/**
 * Simple in-memory TTL cache.
 *
 * Entries are evicted lazily on read (when expired) and periodically via
 * a background sweep that runs every SWEEP_INTERVAL_MS.
 *
 * Usage:
 *   import { createCache } from "../shared/cache.js";
 *   const cache = createCache({ defaultTtlMs: 30 * 60 * 1000 });
 *
 *   const value = await cache.getOrSet("key", async () => fetchExpensiveThing(), ttlMs?);
 *   // — or —
 *   cache.set("key", value, ttlMs?);
 *   const hit = cache.get("key"); // undefined if miss/expired
 */

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * @param {{ defaultTtlMs?: number, maxEntries?: number }} options
 */
export function createCache(options = {}) {
  const defaultTtlMs = options.defaultTtlMs || 30 * 60 * 1000; // 30 min
  const maxEntries = options.maxEntries || 2000;

  /** @type {Map<string, { value: any, expiresAt: number }>} */
  const store = new Map();

  // In-flight promises for deduplication of concurrent fetches for the same key.
  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();

  // ── Metrics ──────────────────────────────────────────────────
  let hits = 0;
  let misses = 0;
  let errors = 0;
  let sets = 0;

  // Background sweep (unref'd so it doesn't keep the process alive).
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  }, SWEEP_INTERVAL_MS);

  if (sweepTimer.unref) {
    sweepTimer.unref();
  }

  function evictIfNeeded() {
    if (store.size <= maxEntries) {
      return;
    }

    // Evict oldest entries first.
    const overflow = store.size - maxEntries;
    const iterator = store.keys();
    for (let i = 0; i < overflow; i += 1) {
      const { value: key, done } = iterator.next();
      if (done) break;
      store.delete(key);
    }
  }

  /**
   * Get a cached value, or undefined if expired/missing.
   * @param {string} key
   * @returns {any | undefined}
   */
  function get(key) {
    const entry = store.get(key);
    if (!entry) {
      misses++;
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      misses++;
      return undefined;
    }

    hits++;
    return entry.value;
  }

  /**
   * Store a value with optional TTL override.
   * @param {string} key
   * @param {any} value
   * @param {number} [ttlMs]
   */
  function set(key, value, ttlMs) {
    store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs || defaultTtlMs)
    });
    sets++;
    evictIfNeeded();
  }

  /**
   * Get from cache, or compute + store.  Concurrent calls for the same key
   * will share a single in-flight promise (request deduplication).
   *
   * @param {string} key
   * @param {() => Promise<any>} factory
   * @param {number} [ttlMs]
   * @returns {Promise<any>}
   */
  async function getOrSet(key, factory, ttlMs) {
    const cached = get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Deduplicate concurrent in-flight requests for the same key.
    const pending = inflight.get(key);
    if (pending) {
      return pending;
    }

    const promise = factory().then(
      (value) => {
        inflight.delete(key);
        if (value !== undefined && value !== null) {
          set(key, value, ttlMs);
        }
        return value;
      },
      (error) => {
        inflight.delete(key);
        errors++;
        throw error;
      }
    );

    inflight.set(key, promise);
    return promise;
  }

  /**
   * Remove a specific key.
   * @param {string} key
   */
  function del(key) {
    store.delete(key);
    inflight.delete(key);
  }

  /** Clear all entries. */
  function clear() {
    store.clear();
    inflight.clear();
    hits = 0;
    misses = 0;
    errors = 0;
    sets = 0;
  }

  /** Current number of stored entries. */
  function size() {
    return store.size;
  }

  /** Cache metrics for debugging and monitoring. */
  function stats() {
    const total = hits + misses;
    return {
      hits,
      misses,
      errors,
      sets,
      size: store.size,
      inflightCount: inflight.size,
      hitRate: total > 0 ? (hits / total) : 0,
      missRate: total > 0 ? (misses / total) : 0
    };
  }

  return { get, set, getOrSet, del, clear, size, stats };
}

// Shared singleton caches for the most common use cases.

/** Cache for Cinemeta meta responses — TTL 30 min. */
export const cinemetaCache = createCache({ defaultTtlMs: 30 * 60 * 1000 });

/** Cache for TMDB API responses — TTL 60 min. */
export const tmdbCache = createCache({ defaultTtlMs: 60 * 60 * 1000 });

/** Cache for anime detection results — TTL 60 min. */
export const animeDetectionCache = createCache({ defaultTtlMs: 60 * 60 * 1000 });

/** Cache for resolved stream results — TTL 5 min (short-lived). */
export const streamResultCache = createCache({ defaultTtlMs: 5 * 60 * 1000, maxEntries: 500 });
