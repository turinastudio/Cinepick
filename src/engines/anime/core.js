import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const animeIds = require("../../anime/legacy/lib/ids.js");
const animeProviders = require("../../anime/legacy/providers/registry.js");
const animeProviderApi = require("../../anime/legacy/providers/index.js");
const animeDebugService = require("../../anime/legacy/services/debug-service.js");
const animeMetaService = require("../../anime/legacy/services/meta-service.js");
const animeStreamService = require("../../anime/legacy/services/stream-service.js");
const EXPLICIT_ANIME_PREFIXES = new Set(["animeflv", "animeav1", "henaojara", "anilist", "kitsu", "mal", "anidb"]);

export function getAnimeProviderIds() {
  return (animeProviders.providers || []).map((provider) => provider.id);
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
  return animeStreamService.resolveStreamResponse(type, videoId);
}

export async function resolveAnimeMetaPayload(type, videoId) {
  return animeMetaService.resolveMetaResponse(type, videoId);
}

export async function resolveAnimeDebugPayload(type, videoId) {
  return animeDebugService.resolveDebugResponse(type, videoId);
}

export async function debugAnimeExternalResolution(type, videoId) {
  return animeProviderApi.debugExternalResolution(type, videoId);
}

export async function debugAnimeProviderSearch(providerId, type, query, genres = []) {
  return animeDebugService.debugProviderSearch(providerId, type, query, genres);
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
    }).catch((error) => {
      throw new Error(error instanceof Error ? error.message : String(error));
    });

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
  }).catch((error) => {
    throw new Error(error instanceof Error ? error.message : String(error));
  });

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
