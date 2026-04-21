import http from "node:http";
import https from "node:https";
import axios from "axios";
import { getBrowserHeaders } from "../user-agents.js";
import { PoisonPillDetector } from "../poison-pill.js";
import { rateLimiter } from "../rate-limiter.js";
import { logRequestStart, logRequestEnd, logScrapeError, logPoisonPill } from "../scrape-logger.js";

const poisonDetector = new PoisonPillDetector();

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32 });
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;

const cookieJar = new Map();
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
  // Rotate UA on every call, preserve other defaults
  return { ...getBrowserHeaders(), ...(headers || {}) };
}

function isRetryableError(error) {
  return RETRYABLE_ERROR_CODES.has(String(error?.code || "").toUpperCase());
}

function isRetryableStatus(status) {
  return RETRYABLE_STATUS_CODES.has(Number(status));
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter.
 * Prevents thundering herd when many requests fail simultaneously.
 * Formula: min(maxMs, baseMs * 2^attempt + random(0, jitterRange))
 */
function calcBackoff(attempt, baseMs = RETRY_BASE_MS, maxMs = RETRY_MAX_MS) {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs;
  return Math.min(maxMs, exponential + jitter);
}

function getCookieHeader(url) {
  const hostname = new URL(url).hostname;
  return cookieJar.get(hostname) || "";
}

function storeCookies(url, response) {
  const hostname = new URL(url).hostname;
  const existing = cookieJar.get(hostname) || "";
  const cookieMap = new Map();

  if (existing) {
    existing.split(/;\s*/).forEach((pair) => {
      const [name, ...rest] = pair.split("=");
      if (!name || !rest.length) {
        return;
      }

      cookieMap.set(name.trim(), rest.join("=").trim());
    });
  }

  const setCookie = response.headers?.["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];

  cookies.forEach((cookie) => {
    const pair = String(cookie).split(";")[0];
    const [name, ...rest] = pair.split("=");
    if (!name || !rest.length) {
      return;
    }

    cookieMap.set(name.trim(), rest.join("=").trim());
  });

  if (cookieMap.size > 0) {
    cookieJar.set(
      hostname,
      Array.from(cookieMap.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ")
    );
  }
}

async function issueRequest(url, options = {}) {
  const cookieHeader = getCookieHeader(url);
  let lastError = null;

  for (let attempt = 0; attempt <= REQUEST_RETRY_COUNT; attempt += 1) {
    try {
      const response = await axios({
        url,
        method: options.method || "GET",
        headers: mergeHeaders({
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          ...(options.headers || {})
        }),
        data: options.body,
        responseType: options.responseType || "text",
        maxRedirects: 5,
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true
      });

      storeCookies(url, response);

      if (attempt < REQUEST_RETRY_COUNT && isRetryableStatus(response.status)) {
        await wait(calcBackoff(attempt));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= REQUEST_RETRY_COUNT || !isRetryableError(error)) {
        throw error;
      }

      await wait(calcBackoff(attempt));
    }
  }

  throw lastError || new Error(`Request failed for ${url}`);
}

async function warmHost(url, headers) {
  const parsed = new URL(url);
  await issueRequest(parsed.origin, {
    headers: {
      Referer: parsed.origin,
      ...(headers || {})
    }
  }).catch(() => null);
}

export async function fetchPage(url, options = {}) {
  const providerId = options._providerId || "unknown";
  const action = options._action || "fetch";
  const startTime = Date.now();

  // Wait for rate limiter before making request
  await rateLimiter.waitForDomain(url);

  logRequestStart(providerId, url, action);

  try {
    let response = await issueRequest(url, options);

    if (response.status === 403 && !options._warmed) {
      await warmHost(url, options.headers);
      response = await issueRequest(url, { ...options, _warmed: true });
    }

    const durationMs = Date.now() - startTime;
    logRequestEnd(providerId, url, response.status, durationMs, action);

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.statusText} para ${url}`);
    }

    const text = typeof response.data === "string" ? response.data : String(response.data || "");

    // Check for poison pills (anti-bot, paywall, etc.)
    const poison = poisonDetector.detect({
      content: text,
      url: response.request?.res?.responseUrl || url,
      statusCode: response.status
    });

    if (poison.detected) {
      logPoisonPill(providerId, url, poison.type, poison.details);
      const error = new Error(`Poison pill detected: ${poison.type} (${poison.details})`);
      error.poisonPill = poison;
      throw error;
    }

    return {
      text,
      url: response.request?.res?.responseUrl || response.config?.url || url,
      headers: response.headers || {}
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    if (!error.poisonPill) {
      logScrapeError(providerId, url, error, action);
    }
    throw error;
  }
}

export async function fetchText(url, options = {}) {
  const page = await fetchPage(url, options);
  return page.text;
}

export async function fetchJson(url, options = {}) {
  let response = await issueRequest(url, { ...options, responseType: "json" });

  if (response.status === 403 && !options._warmed) {
    await warmHost(url, options.headers);
    response = await issueRequest(url, { ...options, responseType: "json", _warmed: true });
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} para ${url}`);
  }

  return response.data;
}
