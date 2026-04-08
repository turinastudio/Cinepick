const DEFAULT_MAX_RESULTS = 2;

const HOST_SCORES = {
  yourupload: 92,
  mp4upload: 86,
  pdrain: 84,
  hls: 82,
  streamwish: 78,
  sw: 78,
  filemoon: 76,
  voe: 74,
  mixdrop: 68,
  okru: 66,
  mega: 64,
  netu: 60,
  fembed: 58,
  stape: 56,
  uqload: 54
};

const PROVIDER_SCORES = {
  animeflv: 12,
  animeav1: 8,
  henaojara: 4
};
const {
  dedupeStreamsByTarget,
  getCanonicalStreamTarget
} = require("../../../shared/dedupe.cjs");

function getSelectionMode() {
  return String(process.env.STREAM_SELECTION_MODE || "global").trim().toLowerCase();
}

function getMaxResults(options = {}) {
  const envValue = Number.parseInt(process.env.STREAM_MAX_RESULTS || "", 10);
  if (Number.isInteger(envValue) && envValue > 0) {
    return envValue;
  }

  if (Number.isInteger(options.maxResults) && options.maxResults > 0) {
    return options.maxResults;
  }

  return DEFAULT_MAX_RESULTS;
}

function isInternalOnlyEnabled(options = {}) {
  if (typeof options.internalOnly === "boolean") {
    return options.internalOnly;
  }

  const raw = String(process.env.STREAM_INTERNAL_ONLY || "true").trim();
  return !/^(0|false|no)$/i.test(raw);
}

function dedupeStreams(streams) {
  return dedupeStreamsByTarget(streams, {
    buildKey(stream, targetUrl) {
      const languageBucket = isDubStream(stream) ? "dub" : "sub";
      const sourceLabel = detectSourceLabel(stream);
      return targetUrl
        ? `${languageBucket}::${sourceLabel}::${targetUrl}`
        : `${languageBucket}::${sourceLabel}::${stream.title || ""}::${stream.name || ""}`;
    },
    mapDuplicate(stream, key, targetUrl) {
      return {
        key,
        providerId: stream._providerId || null,
        url: stream.url || null,
        externalUrl: stream.externalUrl || null,
        canonicalTarget: targetUrl || null,
        name: stream.name || null,
        title: stream.title || null,
        language: isDubStream(stream) ? "dub" : "sub"
      };
    }
  });
}

function detectSourceLabel(stream) {
  const text = `${stream.name || ""} ${stream.title || ""} ${stream.url || ""} ${stream.externalUrl || ""}`.toLowerCase();

  for (const host of Object.keys(HOST_SCORES)) {
    if (text.includes(host)) {
      return host;
    }
  }

  return "generic";
}

function detectResolutionScore(stream) {
  const text = `${stream.title || ""} ${stream.description || ""}`.toLowerCase();
  if (/\b(2160p|4k)\b/.test(text)) return 24;
  if (/\b1080p\b/.test(text)) return 18;
  if (/\b720p\b/.test(text)) return 10;
  if (/\b480p\b/.test(text)) return 5;
  return 0;
}

function detectLanguageScore(stream) {
  const text = `${stream.title || ""} ${stream.name || ""}`.toLowerCase();
  if (text.includes("[lat]") || /\blatino\b|\blatam\b/.test(text)) return 24;
  if (text.includes("[cast]") || /\bcastellano\b|\bespa(?:n|ñ)ol\b/.test(text)) return 12;
  if (text.includes("[sub]") || /\bsubtitulado\b|\bvose\b/.test(text)) return 6;
  return 0;
}

function detectTransportScore(stream) {
  const url = String(stream.url || "");
  if (/\.mp4(\?|$)/i.test(url)) return 10;
  if (/\.m3u8(\?|$)/i.test(url)) return 8;
  return 0;
}

function detectComplexityPenalty(stream) {
  const requestHeaders = stream.behaviorHints?.proxyHeaders?.request || {};
  let penalty = 0;

  if (stream.behaviorHints?.notWebReady) {
    penalty += 2;
  }

  if (requestHeaders.Cookie) {
    penalty += 8;
  }

  if (Object.keys(requestHeaders).length >= 4) {
    penalty += 2;
  }

  return penalty;
}

function analyzeStream(stream) {
  const providerId = String(stream._providerId || "").toLowerCase();
  const sourceLabel = detectSourceLabel(stream);
  const language = isDubStream(stream) ? "dub" : "sub";
  const hostBase = HOST_SCORES[sourceLabel] || 20;
  const providerScore = PROVIDER_SCORES[providerId] || 0;
  const resolutionScore = detectResolutionScore(stream);
  const languageScore = detectLanguageScore(stream);
  const transportScore = detectTransportScore(stream);
  const complexityPenalty = detectComplexityPenalty(stream);
  const score =
    hostBase +
    providerScore +
    resolutionScore +
    languageScore +
    transportScore -
    complexityPenalty;

  return {
    stream,
    providerId,
    sourceLabel,
    language,
    score,
    components: {
      hostBase,
      providerScore,
      resolutionScore,
      languageScore,
      transportScore,
      complexityPenalty
    }
  };
}

function stripPrivateFields(stream) {
  const { _providerId, _sourceLabel, _score, _dub, ...rest } = stream;
  return rest;
}

function isDubStream(stream) {
  if (stream?._dub === true) {
    return true;
  }

  const text = `${stream?.title || ""} ${stream?.name || ""}`.toLowerCase();
  return /\bdub\b|\blatino\b|\blatam\b|\bcastellano\b|\bespa(?:n|ñ)ol\b/.test(text);
}

function selectPerProvider(scored, maxResults) {
  const buckets = new Map();

  for (const item of scored) {
    const providerId = item.providerId || "unknown";
    if (!buckets.has(providerId)) {
      buckets.set(providerId, []);
    }
    buckets.get(providerId).push(item);
  }

  const selected = [];
  for (const items of buckets.values()) {
    selected.push(...items.slice(0, maxResults));
  }

  return selected.sort((a, b) => b.score - a.score);
}

function selectPreferredLanguagePair(scored, maxResults) {
  if (!Array.isArray(scored) || scored.length === 0) {
    return [];
  }

  const bestSub = scored.find((item) => !isDubStream(item.stream));
  const bestDub = scored.find((item) => isDubStream(item.stream));
  const selected = [];

  if (bestSub) {
    selected.push(bestSub);
  } else {
    selected.push(scored[0]);
  }

  if (maxResults > 1 && bestDub && bestDub !== selected[0]) {
    selected.push(bestDub);
  }

  return selected.slice(0, maxResults);
}

function prepareStreams(streams, options = {}) {
  const internalOnly = isInternalOnlyEnabled(options);
  const dedupeState = dedupeStreams(Array.isArray(streams) ? streams : []);
  const deduped = dedupeState.deduped;
  const filtered = internalOnly
    ? deduped.filter((stream) => typeof stream.url === "string" && !stream.externalUrl)
    : deduped;
  const filteredOutExternal = internalOnly
    ? deduped.filter((stream) => !(typeof stream.url === "string" && !stream.externalUrl))
    : [];

  const scored = filtered
    .map(analyzeStream)
    .sort((a, b) => b.score - a.score);

  return {
    inputCount: Array.isArray(streams) ? streams.length : 0,
    dedupedCount: deduped.length,
    duplicateEntries: dedupeState.duplicates,
    filteredOutExternalCount: filteredOutExternal.length,
    filteredOutExternal,
    internalOnly,
    scored
  };
}

function selectStreams(streams, options = {}) {
  const mode = getSelectionMode();

  if (mode === "off") {
    return dedupeStreams(streams).map(stripPrivateFields);
  }

  const prepared = prepareStreams(streams, options);
  const maxResults = getMaxResults(options);
  const selected = mode === "per_provider"
    ? selectPerProvider(prepared.scored, maxResults)
    : selectPreferredLanguagePair(prepared.scored, maxResults);

  return selected.map((item) =>
    stripPrivateFields({
      ...item.stream,
      _sourceLabel: item.sourceLabel,
      _score: item.score
    })
  );
}

function debugSelectStreams(streams, options = {}) {
  const mode = getSelectionMode();
  const prepared = prepareStreams(streams, options);
  const maxResults = getMaxResults(options);
  const selected = mode === "off"
    ? prepared.scored
    : mode === "per_provider"
      ? selectPerProvider(prepared.scored, maxResults)
      : selectPreferredLanguagePair(prepared.scored, maxResults);

  return {
    selectionMode: mode,
    maxResults,
    inputCount: prepared.inputCount,
    dedupedCount: prepared.dedupedCount,
    duplicateCount: prepared.duplicateEntries.length,
    internalOnly: prepared.internalOnly,
    filteredOutExternalCount: prepared.filteredOutExternalCount,
    duplicateStreams: prepared.duplicateEntries,
    filteredOutStreams: prepared.filteredOutExternal.map((stream) => ({
      providerId: stream._providerId || null,
      url: stream.url || null,
      externalUrl: stream.externalUrl || null,
      name: stream.name || null,
      title: stream.title || null,
      language: isDubStream(stream) ? "dub" : "sub"
    })),
    scoredStreams: prepared.scored.map((item) => ({
      providerId: item.providerId || null,
      sourceLabel: item.sourceLabel,
      language: item.language,
      score: item.score,
      url: item.stream.url || null,
      externalUrl: item.stream.externalUrl || null,
      name: item.stream.name || null,
      title: item.stream.title || null,
      components: item.components
    })),
    selectedStreams: selected.map((item) => ({
      providerId: item.providerId || null,
      sourceLabel: item.sourceLabel,
      language: item.language,
      score: item.score,
      url: item.stream.url || null,
      externalUrl: item.stream.externalUrl || null,
      name: item.stream.name || null,
      title: item.stream.title || null
    }))
  };
}

module.exports = {
  debugSelectStreams,
  selectStreams
};
