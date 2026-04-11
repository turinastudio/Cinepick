import {
  getAnimeProviderById,
  debugAnimeProviderSearch,
  debugAnimeProviderStreams,
  getAnimeProviderIds,
  isAnimeProviderId,
  isExplicitAnimeVideoId,
  resolveAnimeDebugPayload,
  resolveAnimeMetaPayload,
  resolveAnimeStreamPayload
} from "./core.js";
import { detectAnimeForExternalId } from "./detection.js";

const ANIME_ID_PREFIXES = ["animeflv:", "animeav1:", "henaojara:", "tioanime:", "anilist:", "kitsu:", "mal:", "anidb:"];

function getAnimeEngineIdPrefixes() {
  return [...ANIME_ID_PREFIXES];
}

function isAnimeEngineProviderId(providerId) {
  return isAnimeProviderId(providerId);
}

function getAnimeEngineProviderIds() {
  return getAnimeProviderIds();
}

export function getIdPrefixes() {
  return getAnimeEngineIdPrefixes();
}

export function isProviderId(providerId) {
  return isAnimeEngineProviderId(providerId);
}

export function getProviderById(providerId) {
  return getAnimeProviderById(providerId);
}

export async function shouldUseAnimeEngine(type, id, options = {}) {
  const enabled = Boolean(options.enabled);
  if (!enabled) {
    return { useAnimeEngine: false, reason: "engine_disabled" };
  }

  if (isExplicitAnimeVideoId(id)) {
    return { useAnimeEngine: true, reason: "explicit_anime_id" };
  }

  const detection = await detectAnimeForExternalId(type, id).catch((error) => ({
    isAnime: false,
    source: "error",
    error: error instanceof Error ? error.message : String(error)
  }));

  return {
    useAnimeEngine: Boolean(detection?.isAnime),
    reason: detection?.isAnime ? "external_anime_detected" : "general_content",
    detection
  };
}

export async function resolveMeta(type, id) {
  const payload = await resolveAnimeMetaPayload(type, id);
  return {
    mode: "anime",
    payload
  };
}

export async function resolveStreams(type, id) {
  const payload = await resolveAnimeStreamPayload(type, id);
  return {
    mode: "anime",
    payload
  };
}

export async function resolveDebug(type, id) {
  const payload = await resolveAnimeDebugPayload(type, id);
  return {
    mode: "anime",
    payload
  };
}

export async function resolveProviderDebug(providerId, type, id) {
  return debugAnimeProviderStreams(providerId, type, id);
}

export async function resolveProviderSearchDebug(providerId, type, query, genres = []) {
  return debugAnimeProviderSearch(providerId, type, query, genres);
}

// Deprecated aliases kept for compatibility with older imports.
export { getAnimeEngineIdPrefixes };
export { isAnimeEngineProviderId };
export { getAnimeEngineProviderIds };
export { resolveMeta as resolveAnimeEngineMeta };
export { resolveStreams as resolveAnimeEngineStreams };
export { resolveDebug as resolveAnimeEngineDebug };
export { resolveProviderDebug as resolveAnimeEngineProviderDebug };
export { resolveProviderSearchDebug as resolveAnimeEngineProviderSearchDebug };
