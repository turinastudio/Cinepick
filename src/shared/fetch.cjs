const { getBrowserHeaders } = require("../lib/user-agents.js");

const REQUEST_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(
    process.env.WEBSTREAM_HTTP_TIMEOUT_MS ||
    process.env.PROVIDER_TIMEOUT_MS ||
    "15000",
    10
  ) || 15000
);

const REQUEST_RETRY_COUNT = Math.max(
  0,
  Math.min(Number.parseInt(process.env.WEBSTREAM_HTTP_RETRIES || "1", 10) || 1, 2)
);

const RETRYABLE_STATUS_CODES = new Set([403, 429, 502, 503, 504]);
const RETRYABLE_ERROR_NAMES = new Set(["AbortError"]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN"
]);
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 10000;

function mergeHeaders(headers) {
  return { ...getBrowserHeaders(), ...(headers || {}) };
}

function isRetryableStatus(status) {
  return RETRYABLE_STATUS_CODES.has(Number(status));
}

function isRetryableError(error) {
  const name = String(error?.name || "");
  const code = String(error?.code || "").toUpperCase();
  return RETRYABLE_ERROR_NAMES.has(name) || RETRYABLE_ERROR_CODES.has(code);
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter.
 * Formula: min(maxMs, baseMs * 2^attempt + random(0, baseMs))
 */
function calcBackoff(attempt, baseMs = RETRY_BASE_MS, maxMs = RETRY_MAX_MS) {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs;
  return Math.min(maxMs, exponential + jitter);
}

async function fetchWithRetry(url, options = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= REQUEST_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        headers: mergeHeaders(options.headers),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (attempt < REQUEST_RETRY_COUNT && isRetryableStatus(response.status)) {
        await wait(calcBackoff(attempt));
        continue;
      }

      if (!response || !response.ok || response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP error! Status: ${response?.status}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      if (attempt >= REQUEST_RETRY_COUNT || !isRetryableError(error)) {
        throw error;
      }

      await wait(calcBackoff(attempt));
    }
  }

  throw lastError || new Error(`Request failed for ${url}`);
}

async function fetchText(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  return response.text();
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  return response.json();
}

module.exports = {
  fetchJson,
  fetchText,
  fetchWithRetry,
  getBrowserHeaders
};
