const {
  resolveExternalMetadata
} = require("../lib/external-resolution");
const {
  collectStreamGroups,
  getExternalMetaFromCandidates,
  getExternalMetaSource,
  resolveProviderCandidates,
  resolveProviderCandidatesDetailed
} = require("../lib/external-pipeline");
const { combineStreams } = require("../lib/stream-combiner");
const { debugSelectStreams, selectStreams } = require("../lib/stream-selection");
const { debugSupportStream } = require("../lib/support-stream");
const { getProviderById, providers } = require("./registry");

async function getExternalStreams(type, videoId) {
  const resolvedMetadata = await resolveExternalMetadata(type, videoId);
  const candidateState = await resolveProviderCandidates(type, resolvedMetadata);
  const streamGroups = await collectStreamGroups(candidateState.candidates, resolvedMetadata.episode);
  const combined = combineStreams(
    streamGroups
      .filter((item) => item.ok)
      .map((item) =>
        item.streams.map((stream) => ({
          ...stream,
          _providerId: item.providerId
        }))
      )
  );
  return selectStreams(combined);
}

async function getExternalMeta(type, videoId) {
  const metadata = await resolveExternalMetadata(type, videoId);
  const candidateState = await resolveProviderCandidates(type, metadata);
  return getExternalMetaFromCandidates(candidateState.candidates);
}

async function debugExternalResolution(type, videoId) {
  const resolvedMetadata = await resolveExternalMetadata(type, videoId);
  const candidateDebug = await resolveProviderCandidatesDetailed(type, resolvedMetadata);
  const streamGroups = await collectStreamGroups(candidateDebug.candidates, resolvedMetadata.episode);
  const metaSource = getExternalMetaSource(candidateDebug.candidates);
  const combinedStreams = combineStreams(
    streamGroups
      .filter((item) => item.ok)
      .map((item) =>
        item.streams.map((stream) => ({
          ...stream,
          _providerId: item.providerId
        }))
      )
  );
  const selection = debugSelectStreams(combinedStreams);
  const support = debugSupportStream(selection.selectedStreams);

  return {
    input: {
      type,
      videoId
    },
    resolvedMetadata: {
      title: resolvedMetadata.metadata?.title || null,
      imdbId: resolvedMetadata.metadata?.imdbID || null,
      tmdbId: resolvedMetadata.metadata?.tmdbID || null,
      releaseDate: resolvedMetadata.metadata?.releaseDate || null,
      season: resolvedMetadata.season || null,
      episode: resolvedMetadata.episode || null
    },
    searchTerm: candidateDebug.searchTerm,
    metaSource,
    candidates: candidateDebug.candidates,
    searchDebug: candidateDebug.details,
    providerStreams: streamGroups.map((item) => ({
      providerId: item.providerId,
      ok: item.ok,
      count: Array.isArray(item.streams) ? item.streams.length : 0,
      error: item.error
    })),
    combinedStreamCount: combinedStreams.length,
    selection,
    support
  };
}

module.exports = {
  combineStreams,
  debugExternalResolution,
  getExternalMeta,
  getExternalStreams,
  getProviderById,
  providers,
  resolveProviderCandidatesDetailed,
  resolveExternalMetadata
};
