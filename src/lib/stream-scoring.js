import { getPenaltyForSource } from "./penalty-reliability.js";
import { buildHttpStreamTitle } from "./stream-format.js";

const DEFAULT_MAX_RESULTS = 1;

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
  if (text.includes("[lat]") || /\blatino\b|\blatam\b/.test(text)) return 30;
  if (text.includes("[cast]") || /\bcastellano\b|\bespa[nñ]ol\b/.test(text)) return 18;
  if (text.includes("[sub]") || /\bsubtitulado\b|\bvose\b/.test(text)) return 8;
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

function detectProviderAdjustment(providerId, sourceLabel, stream) {
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

export function analyzeScoredStreams(providerId, streams, options = {}) {
  return dedupeStreams(streams)
    .map((stream) => {
      const sourceLabel = detectSourceLabel(stream);
      const sourceKey = buildSourceKey(providerId, stream);
      const penalty = getPenaltyForSource(sourceKey);
      const resolutionScore = detectResolutionScore(stream);
      const languageScore = detectLanguageScore(stream);
      const transportScore = detectTransportScore(stream);
      const complexityPenalty = detectComplexityPenalty(stream);
      const providerAdjustment = detectProviderAdjustment(providerId, sourceLabel, stream);
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
          penalty
        }
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function scoreAndSelectStreams(providerId, streams, options = {}) {
  const maxResults = Number.parseInt(process.env.STREAM_MAX_RESULTS || "", 10) || options.maxResults || DEFAULT_MAX_RESULTS;
  const cleaned = analyzeScoredStreams(providerId, streams, options);
  return cleaned
    .slice(0, Math.max(1, maxResults))
    .map((item) => {
      const { _sourceKey, _providerId, _proxyHeaders, _targetUrl, ...stream } = item.stream;
      return stream;
    });
}
