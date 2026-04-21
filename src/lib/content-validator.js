/**
 * Content validation for scraping results.
 *
 * Detects when a provider's HTML structure has changed,
 * when a site is down/redirected, or when extraction returned empty.
 * Provides early failure signals instead of silent empty arrays.
 */

// Minimum content thresholds (tunable per provider if needed)
const MIN_HTML_LENGTH = 200;        // Below this = likely empty/error page
const MIN_STREAM_TITLE = 3;         // Min chars in stream title
const MIN_PLAYER_URLS = 1;          // Min player URLs found to continue
const MIN_SEARCH_RESULTS = 1;       // Min search results to consider provider alive

/**
 * Known site signatures for detecting structural changes.
 * Providers can register custom signatures.
 */
const SITE_SIGNATURES = {
  // Generic anti-bot pages
  cloudflare: [
    "cloudflare", "checking your browser", "ddos protection",
    "just a moment", "cf-challenge"
  ],
  captcha: [
    "captcha", "recaptcha", "hcaptcha", "verify you are human",
    "robot verification"
  ],
  paywall: [
    "subscribe", "premium", "suscrib", "registr", "inicia sesion",
    "create account", "sign in to continue"
  ],
  error: [
    "404 not found", "page not found", "error 404", "502 bad gateway",
    "503 service unavailable", "504 gateway timeout"
  ],
  parking: [
    "parked domain", "domain for sale", "buy this domain",
    "sedo", "godaddy auction"
  ]
};

/**
 * Validates raw HTML content before attempting to parse it.
 *
 * @param {string} html - The raw HTML response body
 * @param {string} url - The URL that was fetched (for context)
 * @returns {{ valid: boolean, reason?: string, contentType?: string }}
 */
export function validateHtmlContent(html, url = "") {
  if (!html || typeof html !== "string") {
    return { valid: false, reason: "empty_response" };
  }

  if (html.length < MIN_HTML_LENGTH) {
    return { valid: false, reason: "content_too_short", length: html.length };
  }

  const lowerHtml = html.toLowerCase();

  // Check for known poison signatures
  for (const [type, signatures] of Object.entries(SITE_SIGNATURES)) {
    for (const sig of signatures) {
      if (lowerHtml.includes(sig.toLowerCase())) {
        return { valid: false, reason: `${type}_detected`, signature: sig };
      }
    }
  }

  // Check for very large pages (might be a different site)
  if (html.length > 500000) {
    return { valid: false, reason: "content_suspiciously_large", length: html.length };
  }

  return { valid: true, length: html.length };
}

/**
 * Validates extracted player URLs.
 *
 * @param {Array} players - Array of player URL objects
 * @param {string} providerId - The provider that extracted them
 * @returns {{ valid: boolean, reason?: string, count: number }}
 */
export function validatePlayerUrls(players, providerId = "") {
  if (!Array.isArray(players)) {
    return { valid: false, reason: "not_an_array", count: 0 };
  }

  const validPlayers = players.filter((p) => {
    if (!p || typeof p !== "object") return false;
    const url = p.url || p.embedUrl || p.playerUrl;
    if (!url || typeof url !== "string") return false;
    if (!/^https?:\/\//i.test(url)) return false;
    return true;
  });

  if (validPlayers.length === 0 && players.length > 0) {
    return { valid: false, reason: "no_valid_urls", total: players.length, valid: 0 };
  }

  return { valid: true, count: validPlayers.length };
}

/**
 * Validates search results from a provider.
 *
 * @param {Array} results - Search results array
 * @param {string} providerId - The provider
 * @param {string} query - The original search query
 * @returns {{ valid: boolean, reason?: string, count: number }}
 */
export function validateSearchResults(results, providerId = "", query = "") {
  if (!Array.isArray(results)) {
    return { valid: false, reason: "not_an_array", count: 0 };
  }

  return { valid: true, count: results.length };
}

/**
 * Validates a single stream result before adding to response.
 *
 * @param {object} stream - Stream object to validate
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateStream(stream) {
  if (!stream || typeof stream !== "object") {
    return { valid: false, reason: "not_an_object" };
  }

  // Check title quality
  const title = stream.title || stream.name || "";
  if (title.length < MIN_STREAM_TITLE) {
    return { valid: false, reason: "title_too_short", title: String(title).slice(0, 50) };
  }

  // Check for valid URL or proxied path
  const url = stream.url || stream.externalUrl || "";
  if (!url || (typeof url === "string" && url.trim() === "")) {
    return { valid: false, reason: "missing_url" };
  }

  return { valid: true };
}

/**
 * Provider-level validation wrapper.
 * Wraps a provider's getStreamsFromExternalId and validates the result.
 *
 * @param {Function} providerFn - The provider's stream resolution function
 * @param {string} providerId - Provider identifier
 * @param {object} params - Parameters to pass to providerFn
 * @returns {Promise<{ok: boolean, value?: Array, error?: string}>}
 */
export async function withContentValidation(providerFn, providerId, params) {
  try {
    const result = await providerFn(params);

    if (!Array.isArray(result)) {
      return {
        ok: false,
        error: `Provider ${providerId} returned non-array: ${typeof result}`
      };
    }

    // Check stream quality
    const validStreams = [];
    const invalidReasons = {};

    for (const stream of result) {
      const validation = validateStream(stream);
      if (validation.valid) {
        validStreams.push(stream);
      } else {
        invalidReasons[validation.reason] = (invalidReasons[validation.reason] || 0) + 1;
      }
    }

    // Log if we filtered out streams
    const filteredCount = result.length - validStreams.length;
    if (filteredCount > 0) {
      console.warn(
        `[content-validator] ${providerId}: filtered ${filteredCount}/${result.length} invalid streams`,
        JSON.stringify(invalidReasons)
      );
    }

    return { ok: true, value: validStreams };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
