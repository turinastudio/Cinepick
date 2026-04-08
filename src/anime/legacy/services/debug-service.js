const { parseVideoId, isNativeProviderId, getNativeSlugAndEpisode } = require("../lib/ids");
const { combineStreams } = require("../lib/stream-combiner");
const { debugSelectStreams } = require("../lib/stream-selection");
const { debugSupportStream } = require("../lib/support-stream");
const {
  debugExternalResolution,
  getProviderById
} = require("../providers");

async function debugNativeResolution(videoId) {
  const native = getNativeSlugAndEpisode(videoId);
  const providers = ["animeflv", "animeav1", "henaojara"];

  const settled = await Promise.allSettled(
    providers.map((providerId) =>
      getProviderById(providerId).getStreams({
        slug: native.slug,
        episode: native.episode
      })
    )
  );

  const results = providers.map((providerId, index) => {
    const item = settled[index];
    return {
      providerId,
      ok: item?.status === "fulfilled",
      count: item?.status === "fulfilled" && Array.isArray(item.value) ? item.value.length : 0,
      error: item?.status === "rejected" ? (item.reason?.message || String(item.reason)) : null
    };
  });

  const combined = combineStreams(
    settled.map((item, index) =>
      item.status === "fulfilled"
        ? item.value.map((stream) => ({
          ...stream,
          _providerId: providers[index]
        }))
        : []
    )
  );
  const selection = debugSelectStreams(combined);
  const support = debugSupportStream(selection.selectedStreams);

  return {
    input: { videoId },
    native: {
      providerId: native.providerId,
      slug: native.slug,
      episode: native.episode || null
    },
    providerStreams: results,
    combinedStreamCount: combined.length,
    selection,
    support
  };
}

async function resolveDebugResponse(type, videoId) {
  const parsed = parseVideoId(videoId);

  if (isNativeProviderId(parsed.prefix)) {
    return debugNativeResolution(videoId);
  }

  return debugExternalResolution(type, videoId);
}

async function debugProviderSearch(providerId, type, query, genres = []) {
  const provider = getProviderById(providerId);

  if (!provider) {
    return {
      error: `Unknown provider ${providerId}`
    };
  }

  const results = await provider.search({
    query,
    type,
    genres
  }).catch((error) => {
    throw new Error(error instanceof Error ? error.message : String(error));
  });

  return {
    providerId,
    type,
    query,
    genres,
    resultCount: Array.isArray(results) ? results.length : 0,
    results: (Array.isArray(results) ? results : []).slice(0, 20).map((item) => ({
      slug: item.slug,
      title: item.title,
      type: item.type,
      hasPoster: Boolean(item.poster),
      hasOverview: Boolean(item.overview)
    }))
  };
}

module.exports = {
  debugProviderSearch,
  resolveDebugResponse
};
