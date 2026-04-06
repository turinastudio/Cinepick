import {
  getAnimeMappingByImdbId,
  getOtakuMappingByImdbId,
  getOtakuMappingByTmdbId
} from "./anime-mappings.js";
import { resolveAnimeImdbId } from "./anime-relations.js";
import { fetchJson } from "./webstreamer/http.js";

const TMDB_API_KEY = process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c";

function hasJapaneseScript(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(value || ""));
}

async function fetchTmdbSignals(type, externalId) {
  const mediaType = type === "series" ? "tv" : "movie";
  const rawId = String(externalId || "");
  let itemId = "";

  if (rawId.startsWith("tmdb:")) {
    itemId = rawId.replace(/^tmdb:/, "").split(":")[0];
  } else if (rawId.startsWith("tt")) {
    const findPayload = await fetchJson(
      `https://api.themoviedb.org/3/find/${rawId.split(":")[0]}?api_key=${TMDB_API_KEY}&external_source=imdb_id`
    ).catch(() => null);
    const results = mediaType === "tv" ? findPayload?.tv_results : findPayload?.movie_results;
    itemId = Array.isArray(results) && results[0]?.id ? String(results[0].id) : "";
  }

  if (!itemId) {
    return { isAnime: false, source: "none" };
  }

  const details = await fetchJson(
    `https://api.themoviedb.org/3/${mediaType}/${itemId}?api_key=${TMDB_API_KEY}&language=en-US`
  ).catch(() => null);

  if (!details) {
    return { isAnime: false, source: "tmdb_unavailable" };
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

  return {
    isAnime: Boolean(isAnimated && (isJapaneseOrigin || japaneseScript)),
    source: "tmdb",
    isAnimated,
    isJapaneseOrigin,
    japaneseScript
  };
}

export async function classifyContentForProviderRouting(type, externalId) {
  const rawId = String(externalId || "").trim();
  const baseImdbId = rawId.startsWith("tt") ? rawId.split(":")[0] : "";
  const tmdbId = rawId.startsWith("tmdb:") ? rawId.replace(/^tmdb:/, "").split(":")[0] : "";
  const resolvedAnimeImdbId = !baseImdbId && /^[a-z]+:/i.test(rawId)
    ? await resolveAnimeImdbId(rawId).catch(() => null)
    : null;
  const effectiveImdbId = baseImdbId || resolvedAnimeImdbId || "";

  const animeMapping = effectiveImdbId ? getAnimeMappingByImdbId(effectiveImdbId) : null;
  const otakuFromImdb = effectiveImdbId ? getOtakuMappingByImdbId(effectiveImdbId) : null;
  const otakuFromTmdb = tmdbId ? getOtakuMappingByTmdbId(tmdbId) : null;
  const tmdbSignals = await fetchTmdbSignals(type, effectiveImdbId || rawId).catch(() => ({ isAnime: false, source: "error" }));

  const isAnime = Boolean(animeMapping || otakuFromImdb || otakuFromTmdb || tmdbSignals?.isAnime);

  return {
    type,
    externalId,
    kind: isAnime ? "anime" : "general",
    confidence: isAnime ? "high" : "high",
    reasons: {
      animeMapping: Boolean(animeMapping),
      otakuMapping: Boolean(otakuFromImdb || otakuFromTmdb),
      tmdbSignals
    },
    resolved: {
      imdbId: effectiveImdbId || null,
      tmdbId: tmdbId || null
    }
  };
}
