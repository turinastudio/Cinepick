/**
 * Structured logging for scraping operations.
 *
 * By default, only logs errors and poison pills to avoid flooding the console
 * with hundreds of lines per search. Success/response events are suppressed
 * unless SCRAPE_DEBUG=1 is set in environment.
 *
 * Integrates with the addon's existing debug system.
 */

import { createDebugLogger } from "../shared/debug.js";

const DEBUG_SCRAPE = /^(1|true|yes)$/i.test(String(process.env.SCIPE_DEBUG || process.env.DEBUG_SCRAPING || "").trim());
const scrapeDebugLog = createDebugLogger("scraping", () => DEBUG_SCRAPE);

/**
 * Log a scraping event in structured format.
 *
 * @param {object} event
 * @param {"request" | "response" | "error" | "poison" | "circuit" | "retry"} event.type
 * @param {string} event.provider - Provider ID (e.g. "gnula", "cuevana")
 * @param {string} [event.action] - Action being performed (search, resolve, etc.)
 * @param {string} [event.url] - URL being fetched
 * @param {number} [event.statusCode] - HTTP response status
 * @param {number} [event.durationMs] - Request duration
 * @param {string} [event.error] - Error message
 * @param {string} [event.poisonType] - Poison pill type if detected
 * @param {string} [event.circuitState] - Circuit breaker state
 * @param {object} [event.meta] - Additional metadata
 */
export function logScrapeEvent(event) {
  const timestamp = new Date().toISOString();

  const logEntry = {
    ts: timestamp,
    type: event.type,
    provider: event.provider,
    ...(event.action && { action: event.action }),
    ...(event.url && { url: event.url }),
    ...(event.statusCode && { status: event.statusCode }),
    ...(event.durationMs && { durationMs: Math.round(event.durationMs) }),
    ...(event.error && { error: event.error }),
    ...(event.poisonType && { poison: event.poisonType }),
    ...(event.circuitState && { circuit: event.circuitState }),
    ...(event.meta && { meta: event.meta })
  };

  // Always log errors and poison pills
  if (event.type === "error") {
    console.error(JSON.stringify(logEntry));
    return;
  }

  if (event.type === "poison") {
    console.warn(JSON.stringify(logEntry));
    return;
  }

  // Only log request/response/circuit/retry in debug mode
  if (DEBUG_SCRAPE) {
    if (event.type === "circuit" || event.type === "retry") {
      console.warn(JSON.stringify(logEntry));
    } else {
      scrapeDebugLog(JSON.stringify(logEntry));
    }
  }
}

/**
 * Convenience: log a request start.
 */
export function logRequestStart(provider, url, action = "resolve") {
  logScrapeEvent({
    type: "request",
    provider,
    action,
    url
  });
}

/**
 * Convenience: log a request completion.
 */
export function logRequestEnd(provider, url, statusCode, durationMs, action = "resolve") {
  logScrapeEvent({
    type: "response",
    provider,
    action,
    url,
    statusCode,
    durationMs
  });
}

/**
 * Convenience: log a scraping error.
 */
export function logScrapeError(provider, url, error, action = "resolve") {
  logScrapeEvent({
    type: "error",
    provider,
    action,
    url,
    error: error instanceof Error ? error.message : String(error)
  });
}

/**
 * Convenience: log a poison pill detection.
 */
export function logPoisonPill(provider, url, poisonType, details) {
  logScrapeEvent({
    type: "poison",
    provider,
    url,
    poisonType,
    error: details
  });
}

/**
 * Convenience: log a circuit breaker state change.
 */
export function logCircuitChange(provider, state, reason) {
  logScrapeEvent({
    type: "circuit",
    provider,
    circuitState: state,
    error: reason
  });
}

/**
 * Convenience: log a retry attempt.
 */
export function logRetry(provider, url, attempt, backoffMs, reason) {
  logScrapeEvent({
    type: "retry",
    provider,
    url,
    meta: { attempt, backoffMs: Math.round(backoffMs), reason }
  });
}
