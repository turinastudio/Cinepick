import { getPenaltyForSource } from "./penalty-reliability.js";
import { buildHttpStreamTitle } from "./stream-format.js";

const DEFAULT_MAX_RESULTS = 2;
const DEFAULT_DISABLED_SOURCES = new Set(["netu", "hqq", "waaw", "waaw.tv"]);

const HOST_SCORES = {
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

function getDisabledSourceSet() {
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

function detectResolutionScore(stream) {
  const text = `${stream.title || ""} ${stream.description || ""}`.toLowerCase();
  if (/\b(2160p|4k)\b/.test(text)) return 24;
  if (/\b1080p\b/.test(text)) return 18;
  if (/\b720p\b/.test(text)) return 10;
  if (/\b480p\b/.test(text)) return 5;
  return 0;
}

function detectLanguageTier(stream) {
  const text = `${stream.title || ""} ${stream.name || ""}`.toLowerCase();
  if (text.includes("[lat]") || /\blatino\b|\blatam\b/.test(text)) return 3;
  if (text.includes("[cast]") || /\bcastellano\b|\bespa(?:n|ñ)ol\b/.test(text)) return 2;
  if (text.includes("[sub]") || /\bsubtitulado\b|\bvose\b/.test(text)) return 1;
  return 0;
}

function detectLanguageScore(stream) {
  const tier = detectLanguageTier(stream);
  if (tier === 3) return 70;
  if (tier === 2) return 20;
  if (tier === 1) return 8;
  return 0;
}

function detectTransportScore(stream) {
  const url = String(stream._targetUrl || stream.url || "");
  if (/\.mp4(\?|$)/i.test(url)) return 8;
  if (/\.m3u8(\?|$)/i.test(url)) return 5;
  return 0;
}

function detectComplexityPenalty(stream) {
  const requestHeaders = stream._proxyHeaders || stream.behaviorHints?.proxyHeaders?.request || {};
  let penalty = 0;

  if (stream.behaviorHints?.notWebReady) {
    penalty += 2;
  }

  if (requestHeaders.Cookie) {
    penalty += 12;
  }

  if (Object.keys(requestHeaders).length >= 4) {
    penalty += 4;
  }

  return penalty;
}

function detectSourceLabel(stream) {
  const text = `${stream.title || ""} ${stream.name || ""}`.toLowerCase();
  const url = String(stream.url || "").toLowerCase();

  for (const host of Object.keys(HOST_SCORES)) {
    if (text.includes(host) || url.includes(host)) {
      return host;
    }
  }

  return "generic";
}

function detectProviderAdjustment(providerId, sourceLabel, stream, options = {}) {
  const effectiveProviderId = String(stream._providerId || providerId || "").toLowerCase();

  if (effectiveProviderId === "mhdflix" && sourceLabel === "netu") {
    return -28;
  }

  return 0;
}

function buildSourceKey(providerId, stream) {
  const explicit = stream._sourceKey ? String(stream._sourceKey).toLowerCase() : null;
  if (explicit) {
    return explicit;
  }

  const effectiveProviderId = stream._providerId || providerId;
  return `${effectiveProviderId}:${detectSourceLabel(stream)}`;
}

function dedupeStreams(streams) {
  const seen = new Set();
  const deduped = [];

  for (const stream of streams) {
    const dedupeKey = `${stream.url || ""}::${stream.title || ""}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    deduped.push(stream);
  }

  return deduped;
}

function selectWithProviderDiversity(scoredItems, maxResults) {
  const targetCount = Math.max(1, maxResults);
  const selected = [];
  const usedProviders = new Set();

  for (const item of scoredItems) {
    if (selected.length >= targetCount) {
      break;
    }

    const providerId = String(item.stream._providerId || "").toLowerCase();
    const languageTier = detectLanguageTier(item.stream);

    if (!providerId || usedProviders.has(providerId)) {
      continue;
    }

    const remainingLatinoAlternative = scoredItems.some((candidate) => {
      const candidateProviderId = String(candidate.stream._providerId || "").toLowerCase();
      if (!candidateProviderId || usedProviders.has(candidateProviderId) || candidateProviderId === providerId) {
        return false;
      }

      return detectLanguageTier(candidate.stream) >= 3;
    });

    if (languageTier < 3 && remainingLatinoAlternative) {
      continue;
    }

    selected.push(item);
    usedProviders.add(providerId);
  }

  if (selected.length < targetCount) {
    for (const item of scoredItems) {
      if (selected.length >= targetCount) {
        break;
      }

      if (selected.includes(item)) {
        continue;
      }

      selected.push(item);
    }
  }

  return selected;
}

export function analyzeScoredStreams(providerId, streams, options = {}) {
  const disabledSources = getDisabledSourceSet();

  return dedupeStreams(streams)
    .filter((stream) => {
      const sourceLabel = detectSourceLabel(stream);
      return !disabledSources.has(sourceLabel);
    })
    .map((stream) => {
      const sourceLabel = detectSourceLabel(stream);
      const sourceKey = buildSourceKey(providerId, stream);
      const penalty = getPenaltyForSource(sourceKey);
      const resolutionScore = detectResolutionScore(stream);
      const languageScore = detectLanguageScore(stream);
      const transportScore = detectTransportScore(stream);
      const complexityPenalty = detectComplexityPenalty(stream);
      const providerAdjustment = detectProviderAdjustment(providerId, sourceLabel, stream, options);
      const score =
        (HOST_SCORES[sourceLabel] || 20) +
        resolutionScore +
        languageScore +
        transportScore -
        Math.abs(Math.min(providerAdjustment, 0)) +
        Math.max(providerAdjustment, 0) -
        complexityPenalty -
        penalty;

      const cleanedTitle = options.cleanTitle ? options.cleanTitle(stream.title || "") : (stream.title || "");
      const formattedTitle = buildHttpStreamTitle({
        ...stream,
        title: cleanedTitle,
        _sourceLabel: sourceLabel
      });

      return {
        stream: {
          ...stream,
          title: formattedTitle
        },
        score,
        sourceKey,
        sourceLabel,
        components: {
          hostBase: HOST_SCORES[sourceLabel] || 20,
          resolutionScore,
          languageScore,
          transportScore,
          providerAdjustment,
          complexityPenalty,
          penalty,
          languageTier: detectLanguageTier(stream)
        }
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function scoreAndSelectStreams(providerId, streams, options = {}) {
  const maxResults = Number.parseInt(process.env.STREAM_MAX_RESULTS || "", 10) || options.maxResults || DEFAULT_MAX_RESULTS;
  const cleaned = analyzeScoredStreams(providerId, streams, options);
  const selected = providerId === "global"
    ? selectWithProviderDiversity(cleaned, maxResults)
    : cleaned.slice(0, Math.max(1, maxResults));

  return selected.map((item) => {
    const { _sourceKey, _providerId, _proxyHeaders, _targetUrl, ...stream } = item.stream;
    return stream;
  });
}
