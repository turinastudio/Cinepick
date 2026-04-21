import { getRandomUserAgent } from "../../user-agents.js";

const PROVIDER_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.PROVIDER_TIMEOUT_MS || "25000", 10) || 25000
);
const EXTRACTOR_TIMEOUT_MS = Math.max(
  1000,
  Math.min(
    Number.parseInt(process.env.EXTRACTOR_TIMEOUT_MS || "4000", 10) || 4000,
    PROVIDER_TIMEOUT_MS
  )
);
const EXTRACTOR_RETRY_COUNT = Math.max(
  0,
  Math.min(Number.parseInt(process.env.EXTRACTOR_RETRIES || "1", 10) || 1, 2)
);
const RETRYABLE_STATUS_CODES = new Set([403, 429, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN"
]);

function isRetryableStatus(status) {
  return RETRYABLE_STATUS_CODES.has(Number(status));
}

function isRetryableError(error) {
  const code = String(error?.code || "").toUpperCase();
  return RETRYABLE_ERROR_CODES.has(code);
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function calcExtractorBackoff(attempt) {
  const baseMs = 300;
  const maxMs = 3000;
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs;
  return Math.min(maxMs, exponential + jitter);
}

async function fetchWithTimeout(url, options = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= EXTRACTOR_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), EXTRACTOR_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutHandle);

      if (attempt < EXTRACTOR_RETRY_COUNT && isRetryableStatus(response?.status)) {
        await wait(calcExtractorBackoff(attempt));
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutHandle);

      if (error?.name === "AbortError") {
        throw new Error(`Extractor timeout after ${EXTRACTOR_TIMEOUT_MS}ms para ${url}`);
      }

      lastError = error;

      if (attempt >= EXTRACTOR_RETRY_COUNT || !isRetryableError(error)) {
        throw error;
      }

      await wait(calcExtractorBackoff(attempt));
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw lastError || new Error(`Extractor request failed for ${url}`);
}

async function fetchText(url, headers = {}) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "user-agent": getRandomUserAgent(),
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...headers
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`Extractor respondio ${response.status} para ${url}`);
  }

  return response.text();
}

async function fetchJson(url, headers = {}) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
      ...headers
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`Extractor JSON respondio ${response.status} para ${url}`);
  }

  return response.json();
}

export {
  PROVIDER_TIMEOUT_MS,
  EXTRACTOR_TIMEOUT_MS,
  EXTRACTOR_RETRY_COUNT,
  RETRYABLE_STATUS_CODES,
  RETRYABLE_ERROR_CODES,
  isRetryableStatus,
  isRetryableError,
  wait,
  calcExtractorBackoff,
  fetchWithTimeout,
  fetchText,
  fetchJson
};
