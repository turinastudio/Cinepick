import { fetchJson } from "../../shared/fetch.js";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const DEFAULT_TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

function getTmdbApiKey() {
  return String(process.env.TMDB_API_KEY || DEFAULT_TMDB_API_KEY).trim();
}

function getTmdbHeaders() {
  const token = String(process.env.TMDB_API_READ_TOKEN || "").trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function hasJapaneseScript(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(value || ""));
}

async function fetchTmdbJson(url) {
  const headers = getTmdbHeaders();
  return fetchJson(url, Object.keys(headers).length > 0 ? { headers } : {});
}

async function resolveTmdbTarget(type, externalId) {
  const mediaType = type === "series" ? "tv" : "movie";
  const raw = String(externalId || "").trim();
  const apiKey = getTmdbApiKey();

  if (raw.startsWith("tmdb:")) {
    return {
      mediaType,
      tmdbId: raw.replace(/^tmdb:/, "").split(":")[0]
    };
  }

  if (!raw.startsWith("tt")) {
    return null;
  }

  const imdbId = raw.split(":")[0];
  const findPayload = await fetchTmdbJson(
    `${TMDB_API_BASE}/find/${imdbId}?external_source=imdb_id&language=en-US&api_key=${apiKey}`
  );
  const results = mediaType === "tv" ? findPayload?.tv_results : findPayload?.movie_results;
  const tmdbId = Array.isArray(results) && results[0]?.id ? String(results[0].id) : "";

  if (!tmdbId) {
    return null;
  }

  return {
    mediaType,
    tmdbId
  };
}

export async function detectAnimeForExternalId(type, externalId) {
  const resolved = await resolveTmdbTarget(type, externalId).catch(() => null);
  if (!resolved?.tmdbId) {
    return {
      isAnime: false,
      source: "unresolved"
    };
  }

  const apiKey = getTmdbApiKey();
  const details = await fetchTmdbJson(
    `${TMDB_API_BASE}/${resolved.mediaType}/${resolved.tmdbId}?language=en-US&api_key=${apiKey}`
  ).catch(() => null);

  if (!details) {
    return {
      isAnime: false,
      source: "details_unavailable",
      tmdbId: resolved.tmdbId
    };
  }

  const genreNames = Array.isArray(details.genres)
    ? details.genres.map((genre) => String(genre?.name || "").toLowerCase())
    : [];
  const originalLanguage = String(details.original_language || "").toLowerCase();
  const originCountries = Array.isArray(details.origin_country)
    ? details.origin_country.map((country) => String(country || "").toUpperCase())
    : [];
  const titleBlob = [
    details.name,
    details.title,
    details.original_name,
    details.original_title
  ].join(" ");
  const isAnimated = genreNames.includes("animation");
  const isJapaneseOrigin = originalLanguage === "ja" || originCountries.includes("JP");
  const japaneseScript = hasJapaneseScript(titleBlob);
  const isAnime = Boolean(isAnimated && (isJapaneseOrigin || japaneseScript));

  return {
    isAnime,
    source: "tmdb",
    tmdbId: resolved.tmdbId,
    mediaType: resolved.mediaType,
    signals: {
      isAnimated,
      isJapaneseOrigin,
      japaneseScript
    }
  };
}
