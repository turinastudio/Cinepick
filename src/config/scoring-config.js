/**
 * Scoring configuration for stream selection.
 *
 * Centralizes all magic numbers, host scores, and defaults
 * so they can be tuned without touching algorithm code.
 */

// ── Host base scores (higher = preferred) ────────────────────
export const HOST_SCORES = {
  vidhide: 100,
  netu: 96,
  hqq: 95,
  streamwish: 90,
  hlswish: 89,
  filemoon: 87,
  vimeos: 85,
  voe: 82,
  goodstream: 72,
  mp4upload: 70,
  okru: 68,
  streamtape: 64,
  upstream: 60,
  uqload: 58,
  dood: 42
};

// ── Default fallback score for unknown hosts ─────────────────
export const DEFAULT_HOST_SCORE = 20;

// ── Resolution scores ────────────────────────────────────────
export const RESOLUTION_SCORES = {
  "4k": 24,
  "2160p": 24,
  "1080p": 18,
  "720p": 10,
  "480p": 5
};

// ── Language tier scores ─────────────────────────────────────
export const LANGUAGE_SCORES = {
  latino: 70,
  castellano: 20,
  subtitulado: 8
};

// ── Transport scores ─────────────────────────────────────────
export const TRANSPORT_SCORES = {
  mp4: 8,
  hls: 5
};

// ── Complexity penalties ─────────────────────────────────────
export const COMPLEXITY_PENALTIES = {
  notWebReady: 2,
  hasCookie: 12,
  manyHeaders: 4,          // Applied when >= 4 headers
  maxHeadersThreshold: 4
};

// ── Provider-specific adjustments ────────────────────────────
// Format: { providerId: { sourceLabel: adjustment } }
export const PROVIDER_ADJUSTMENTS = {
  mhdflix: {
    netu: -28
  }
};

// ── Default disabled sources ─────────────────────────────────
export const DEFAULT_DISABLED_SOURCES = new Set(["netu", "hqq", "waaw", "waaw.tv"]);

// ── Stream selection defaults ────────────────────────────────
export const STREAM_SELECTION_DEFAULTS = {
  maxResults: 2,
  mode: "global",
  internalOnly: true
};

// ── Recommended extractors (default preset) ──────────────────
export const RECOMMENDED_EXTRACTORS = new Set([
  "mp4upload",
  "yourupload",
  "uqload",
  "pixeldrain"
]);

// ── Environment variable helpers ─────────────────────────────
/**
 * Reads disabled sources from env vars, merging with defaults.
 */
export function getDisabledSourceSet() {
  if (/^(1|true|yes)$/i.test(String(process.env.ALLOW_UNSTABLE_HOSTS || ""))) {
    return new Set();
  }

  const configured = String(
    process.env.STREAM_DISABLED_SOURCES ||
    process.env.DISABLED_STREAM_SOURCES ||
    ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return new Set([...DEFAULT_DISABLED_SOURCES, ...configured]);
}

/**
 * Reads max results from env or returns default.
 */
export function getMaxResults(fallback = STREAM_SELECTION_DEFAULTS.maxResults) {
  const envMax = Number.parseInt(process.env.STREAM_MAX_RESULTS || "", 10);
  return Number.isInteger(envMax) && envMax > 0 ? envMax : fallback;
}
