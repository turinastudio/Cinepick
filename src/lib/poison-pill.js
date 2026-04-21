/**
 * Poison pill detector for web scraping.
 *
 * Detects paywalls, captchas, anti-bot pages, rate limits, and other
 * patterns that indicate the scraper is being blocked or the site is down.
 *
 * Used to avoid wasting retries and time on known-bad responses.
 */

/** @enum {string} */
export const PoisonPillType = {
  PAYWALL: "paywall",
  CAPTCHA: "captcha",
  CLOUDFLARE: "cloudflare",
  RATE_LIMIT: "rate_limit",
  LOGIN_REQUIRED: "login_required",
  NOT_FOUND: "not_found",
  SITE_DOWN: "site_down",
  REDIRECTED: "redirected",
  NONE: "none"
};

/**
 * Poison pill detection result.
 * @typedef {object} PoisonPillResult
 * @property {boolean} detected
 * @property {PoisonPillType} type
 * @property {number} confidence - 0.0 to 1.0
 * @property {string} details - Human-readable description
 */

// Patterns organized by type
const PATTERNS = {
  [PoisonPillType.CLOUDFLARE]: [
    "checking your browser",
    "cloudflare",
    "ddos protection",
    "please wait while we verify",
    "just a moment",
    "cf-challenge",
    "ray id"
  ],
  [PoisonPillType.CAPTCHA]: [
    "verify you are human",
    "captcha",
    "recaptcha",
    "hcaptcha",
    "robot verification",
    "prove you're not a robot",
    "i'm not a robot"
  ],
  [PoisonPillType.PAYWALL]: [
    "subscribe to continue",
    "subscription required",
    "become a member",
    "sign up to read",
    "you've reached your limit",
    "article limit reached",
    "premium content",
    "contenido premium",
    "solo miembros",
    "registrarse para continuar"
  ],
  [PoisonPillType.RATE_LIMIT]: [
    "too many requests",
    "rate limit exceeded",
    "slow down",
    "try again later",
    "429",
    "demasiadas peticiones"
  ],
  [PoisonPillType.LOGIN_REQUIRED]: [
    "sign in to continue",
    "log in required",
    "create an account",
    "inicia sesion",
    "registrate",
    "debes iniciar sesion"
  ],
  [PoisonPillType.NOT_FOUND]: [
    "404 not found",
    "page not found",
    "pagina no encontrada",
    "error 404",
    "no se encontro"
  ],
  [PoisonPillType.SITE_DOWN]: [
    "502 bad gateway",
    "503 service unavailable",
    "504 gateway timeout",
    "site is currently down",
    "temporarily unavailable",
    "service unavailable",
    "nginx",
    "apache error"
  ]
};

// Known Spanish streaming site domains and their typical anti-bot behavior
const KNOWN_DOMAINS = {
  // Anti-bot common on these sites
  "gnula": { typicalAntiBot: PoisonPillType.CLOUDFLARE },
  "cuevana": { typicalAntiBot: PoisonPillType.CLOUDFLARE },
  "cinecalidad": { typicalAntiBot: PoisonPillType.CAPTCHA }
};

/**
 * Detects poison pills in scraped content.
 */
export class PoisonPillDetector {
  /**
   * Detect poison pill type from content.
   *
   * @param {object} options
   * @param {string} options.content - The HTML/text content
   * @param {string} options.url - The URL that was fetched
   * @param {number} [options.statusCode] - HTTP status code
   * @returns {PoisonPillResult}
   */
  detect({ content, url, statusCode = 200 }) {
    // Check status code first
    if (statusCode === 429) {
      return {
        detected: true,
        type: PoisonPillType.RATE_LIMIT,
        confidence: 1.0,
        details: `HTTP 429 Too Many Requests from ${url}`
      };
    }

    if (statusCode === 403) {
      // 403 could be Cloudflare or IP ban
      return {
        detected: true,
        type: PoisonPillType.CLOUDFLARE,
        confidence: 0.7,
        details: `HTTP 403 Forbidden from ${url}`
      };
    }

    if (statusCode === 503) {
      return {
        detected: true,
        type: PoisonPillType.SITE_DOWN,
        confidence: 0.9,
        details: `HTTP 503 Service Unavailable from ${url}`
      };
    }

    if (statusCode === 404) {
      return {
        detected: true,
        type: PoisonPillType.NOT_FOUND,
        confidence: 1.0,
        details: `HTTP 404 Not Found: ${url}`
      };
    }

    // Check content is valid
    if (!content || typeof content !== "string") {
      return {
        detected: true,
        type: PoisonPillType.SITE_DOWN,
        confidence: 0.8,
        details: `Empty response from ${url}`
      };
    }

    if (content.length < 100) {
      return {
        detected: true,
        type: PoisonPillType.SITE_DOWN,
        confidence: 0.6,
        details: `Suspiciously short response (${content.length} bytes) from ${url}`
      };
    }

    // Pattern matching in content
    const contentLower = content.toLowerCase();

    for (const [type, patterns] of Object.entries(PATTERNS)) {
      for (const pattern of patterns) {
        if (contentLower.includes(pattern.toLowerCase())) {
          return {
            detected: true,
            type,
            confidence: type === PoisonPillType.CLOUDFLARE ? 0.85 : 0.7,
            details: `Pattern match: "${pattern}" in ${url}`
          };
        }
      }
    }

    // Check for redirect to parking/error pages
    if (url && url.includes("parking") || url.includes("domain-for-sale")) {
      return {
        detected: true,
        type: PoisonPillType.REDIRECTED,
        confidence: 0.9,
        details: `Redirected to parking page: ${url}`
      };
    }

    // No poison detected
    return {
      detected: false,
      type: PoisonPillType.NONE,
      confidence: 0,
      details: ""
    };
  }

  /**
   * Quick check: is this content likely a poison pill?
   *
   * @param {string} content
   * @param {number} statusCode
   * @returns {boolean}
   */
  static isPoisoned(content, statusCode = 200) {
    const detector = new PoisonPillDetector();
    const result = detector.detect({ content, statusCode });
    return result.detected;
  }

  /**
   * Get expected anti-bot type for a known domain.
   *
   * @param {string} domain
   * @returns {PoisonPillType | null}
   */
  static getExpectedAntiBotType(domain) {
    for (const [key, config] of Object.entries(KNOWN_DOMAINS)) {
      if (domain.toLowerCase().includes(key)) {
        return config.typicalAntiBot;
      }
    }
    return null;
  }
}
