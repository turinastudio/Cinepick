import { parseVideoId, isNativeProviderId, getNativeSlugAndEpisode, getExternalIdDetails } from "./runtime/lib/ids.js";
import { providers as animeProviders, getProviderById } from "./runtime/providers/registry.js";
import {
  getProviderById as animeProviderApiGetProviderById,
  debugExternalResolution as animeProviderApiDebugExternalResolution,
  resolveExternalMetadata as animeProviderApiResolveExternalMetadata,
  resolveProviderCandidatesDetailed as animeProviderApiResolveProviderCandidatesDetailed
} from "./runtime/providers/index.js";
import { resolveDebugResponse, debugProviderSearch } from "./runtime/services/debug-service.js";
import { resolveMetaResponse } from "./runtime/services/meta-service.js";
import { resolveStreamResponse } from "./runtime/services/stream-service.js";
import { streamResultCache } from "../../shared/cache.js";

const EXPLICIT_ANIME_PREFIXES = new Set(["animeflv", "animeav1", "henaojara", "tioanime", "anilist", "kitsu", "mal", "anidb"]);

// Re-export ids utilities for internal use
const animeIds = { parseVideoId, isNativeProviderId, getNativeSlugAndEpisode, getExternalIdDetails };
const animeProviderApi = {
  getProviderById: animeProviderApiGetProviderById,
  debugExternalResolution: animeProviderApiDebugExternalResolution,
  resolveExternalMetadata: animeProviderApiResolveExternalMetadata,
  resolveProviderCandidatesDetailed: animeProviderApiResolveProviderCandidatesDetailed
};

/**
 * Re-throws an error with a clean message.
 * Normalizes non-Error objects to Error instances.
 */
function rethrowError(error) {
  throw new Error(error instanceof Error ? error.message : String(error));
}

export function getAnimeProviderIds() {
  return (animeProviders || []).map((provider) => provider.id);
}

export function getAnimeProviderById(providerId) {
  return animeProviderApi.getProviderById(providerId) || null;
}

export function isAnimeProviderId(providerId) {
  return Boolean(getAnimeProviderById(providerId));
}

export function isExplicitAnimeVideoId(videoId) {
  const parsed = animeIds.parseVideoId(videoId);
  return EXPLICIT_ANIME_PREFIXES.has(String(parsed.prefix || "").toLowerCase());
}

export function supportsAnimeEngineVideoId(videoId) {
  const parsed = animeIds.parseVideoId(videoId);
  if (animeIds.isNativeProviderId(parsed.prefix)) {
    return true;
  }

  return Boolean(animeIds.getExternalIdDetails(videoId));
}

export async function resolveAnimeStreamPayload(type, videoId) {
  const cacheKey = `streams:anime:${type}:${videoId}`;
  const cached = streamResultCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const result = await resolveStreamResponse(type, videoId);

  if (result?.streams?.length > 0) {
    streamResultCache.set(cacheKey, result);
  }

  return result;
}

export async function resolveAnimeMetaPayload(type, videoId) {
  return resolveMetaResponse(type, videoId);
}

export async function resolveAnimeDebugPayload(type, videoId) {
  return resolveDebugResponse(type, videoId);
}

export async function debugAnimeExternalResolution(type, videoId) {
  return animeProviderApi.debugExternalResolution(type, videoId);
}

export async function debugAnimeProviderSearch(providerId, type, query, genres = []) {
  return debugProviderSearch(providerId, type, query, genres);
}

export async function debugAnimeProviderStreams(providerId, type, videoId) {
  const provider = getAnimeProviderById(providerId);
  if (!provider) {
    return {
      provider: providerId,
      type,
      videoId,
      status: "provider_not_found"
    };
  }

  const parsed = animeIds.parseVideoId(videoId);

  if (animeIds.isNativeProviderId(parsed.prefix)) {
    const native = animeIds.getNativeSlugAndEpisode(videoId);
    if (native.providerId !== providerId) {
      return {
        provider: providerId,
        type,
        videoId,
        status: "native_provider_mismatch",
        nativeProviderId: native.providerId,
        slug: native.slug,
        episode: native.episode || null
      };
    }

    const streams = await provider.getStreams({
      slug: native.slug,
      episode: native.episode
    }).catch(rethrowError);

    return {
      provider: providerId,
      type,
      videoId,
      status: "ok",
      mode: "native",
      slug: native.slug,
      episode: native.episode || null,
      streamCount: Array.isArray(streams) ? streams.length : 0,
      streams: Array.isArray(streams) ? streams : []
    };
  }

  const resolvedMetadata = await animeProviderApi.resolveExternalMetadata(type, videoId);
  const candidateDebug = await animeProviderApi.resolveProviderCandidatesDetailed(type, resolvedMetadata);
  const providerDebug = Array.isArray(candidateDebug.details)
    ? candidateDebug.details.find((item) => item.providerId === providerId)
    : null;
  const candidate = candidateDebug?.candidates?.[providerId] || null;

  if (!candidate?.slug) {
    return {
      provider: providerId,
      type,
      videoId,
      status: "no_candidate",
      mode: "external",
      resolvedMetadata: {
        title: resolvedMetadata.metadata?.title || null,
        imdbId: resolvedMetadata.metadata?.imdbID || null,
        tmdbId: resolvedMetadata.metadata?.tmdbID || null,
        season: resolvedMetadata.season || null,
        episode: resolvedMetadata.episode || null
      },
      search: providerDebug || null
    };
  }

  const streams = await provider.getStreams({
    slug: candidate.slug,
    episode: resolvedMetadata.episode
  }).catch(rethrowError);

  return {
    provider: providerId,
    type,
    videoId,
    status: "ok",
    mode: "external",
    resolvedMetadata: {
      title: resolvedMetadata.metadata?.title || null,
      imdbId: resolvedMetadata.metadata?.imdbID || null,
      tmdbId: resolvedMetadata.metadata?.tmdbID || null,
      season: resolvedMetadata.season || null,
      episode: resolvedMetadata.episode || null
    },
    candidate,
    search: providerDebug || null,
    streamCount: Array.isArray(streams) ? streams.length : 0,
    streams: Array.isArray(streams) ? streams : []
  };
}
