import { getNativeSlugAndEpisode, isNativeProviderId, parseVideoId } from "../lib/ids.js";
import { getExternalMeta, getProviderById } from "../providers/index.js";
import { readAiringCache } from "../lib/airing-cache.js";
import { getOrderedProviders } from "../providers/registry.js";
import { pickCandidateForProvider } from "../lib/external-resolution.js";

function buildSlugCandidates(slug) {
  const normalized = String(slug || "").trim();
  if (!normalized) {
    return [];
  }

  const candidates = [normalized];
  if (normalized.endsWith("-tv")) {
    candidates.push(normalized.slice(0, -3));
  } else {
    candidates.push(`${normalized}-tv`);
  }

  return [...new Set(candidates)];
}

async function getAiringEntry(providerId, slug) {
  const cache = await readAiringCache(providerId).catch(() => []);
  const candidateSlugs = new Set(buildSlugCandidates(slug));
  return cache.find((item) => candidateSlugs.has(String(item.slug || "").trim())) || null;
}

function remapMetaIds(meta, providerId, slug) {
  const targetSlug = String(slug || "").trim();

  return {
    ...meta,
    id: `${providerId}:${targetSlug}`,
    videos: Array.isArray(meta?.videos)
      ? meta.videos.map((video, index) => ({
          ...video,
          id: `${providerId}:${targetSlug}:${video.episode || video.number || index + 1}`
        }))
      : meta?.videos,
    behaviorHints: meta?.behaviorHints?.defaultVideoId
      ? {
          ...meta.behaviorHints,
          defaultVideoId: `${providerId}:${targetSlug}:1`
        }
      : meta?.behaviorHints
  };
}

async function buildFallbackNativeMeta(providerId, slug) {
  if (providerId !== "animeflv") {
    return null;
  }

  const airingEntry = await getAiringEntry(providerId, slug);
  const searchTerm = airingEntry?.title || String(slug || "").replace(/-/g, " ").trim();
  if (!searchTerm) {
    return null;
  }

  for (const provider of getOrderedProviders()) {
    if (provider.id === providerId) {
      continue;
    }

    const results = await provider.search({ query: searchTerm, type: airingEntry?.type || "series" }).catch(() => []);
    const candidate = pickCandidateForProvider(provider.id, results, searchTerm, airingEntry?.type || "series");
    if (!candidate?.slug) {
      continue;
    }

    const fallbackMeta = await provider.getMeta({ slug: candidate.slug }).catch(() => null);
    if (!fallbackMeta) {
      continue;
    }

    const remapped = remapMetaIds(fallbackMeta, providerId, slug);
    return {
      ...remapped,
      name: airingEntry?.title || remapped.name,
      poster: airingEntry?.poster || remapped.poster,
      description: airingEntry?.overview || remapped.description
    };
  }

  return null;
}

async function resolveMetaResponse(type, videoId) {
  const parsed = parseVideoId(videoId);

  if (isNativeProviderId(parsed.prefix)) {
    const native = getNativeSlugAndEpisode(videoId);
    const provider = getProviderById(native.providerId);
    const meta = await provider.getMeta({ slug: native.slug, episode: native.episode })
      .catch(() => buildFallbackNativeMeta(native.providerId, native.slug));

    if (!meta) {
      throw new Error(`Failed getting ${provider.name} info`);
    }

    return {
      meta,
      message: `Got ${provider.name} metadata!`
    };
  }

  const { meta, metaSource } = await getExternalMeta(type, videoId);
  const providerName = getProviderById(metaSource?.providerId || "")?.name || "external";
  return {
    meta,
    message: `Got ${providerName} metadata!`
  };
}

export {
  resolveMetaResponse
};
