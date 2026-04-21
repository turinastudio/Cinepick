import { getPenaltyForSource } from "../../../lib/penalty-reliability.js";
import { buildHttpStreamTitle } from "../../../shared/stream-format.js";
import { dedupeStreamsByTarget } from "../../../shared/dedupe.js";
import requestContextShared from "../../../config/request-context.cjs";
import {
  HOST_SCORES,
  DEFAULT_HOST_SCORE,
  RESOLUTION_SCORES,
  LANGUAGE_SCORES,
  TRANSPORT_SCORES,
  COMPLEXITY_PENALTIES,
  PROVIDER_ADJUSTMENTS,
  DEFAULT_DISABLED_SOURCES,
  STREAM_SELECTION_DEFAULTS,
  getDisabledSourceSet,
  getMaxResults
} from "../../../config/scoring-config.js";

const DEFAULT_MAX_RESULTS = STREAM_SELECTION_DEFAULTS.maxResults;
const {
  getSelectionMaxResults,
  isExtractorEnabled,
  isInternalOnlyEnabled
} = requestContextShared;

function getTitleText(stream) {
  return String(stream._rawTitle ?? stream.title ?? "");
}

function getNameText(stream) {
  return String(stream.name ?? "");
}

function isValidStreamTarget(value) {
  const target = String(value ?? "").trim();
  if (!target) {
    return false;
  }

  return /^https?:\/\//i.test(target) || /^\/p\//.test(target);
}

function detectResolutionScore(stream) {
  const text = `${getTitleText(stream)} ${stream.description || ""}`.toLowerCase();
  if (/\b(2160p|4k)\b/.test(text)) return RESOLUTION_SCORES["4k"];
  if (/\b1080p\b/.test(text)) return RESOLUTION_SCORES["1080p"];
  if (/\b720p\b/.test(text)) return RESOLUTION_SCORES["720p"];
  if (/\b480p\b/.test(text)) return RESOLUTION_SCORES["480p"];
  return 0;
}

function detectLanguageTier(stream) {
  // Cache result on the stream to avoid recomputing
  if (stream._languageTier !== undefined) {
    return stream._languageTier;
  }

  const text = `${getTitleText(stream)} ${getNameText(stream)}`.toLowerCase();
  let tier = 0;
  if (text.includes("[lat]") || /\blatino\b|\blatam\b/.test(text)) tier = 3;
  else if (text.includes("[cast]") || /\bcastellano\b|\bespa(?:n|\u00f1)ol\b/.test(text)) tier = 2;
  else if (text.includes("[sub]") || /\bsubtitulado\b|\bvose\b/.test(text)) tier = 1;

  stream._languageTier = tier;
  return tier;
}

function detectLanguageScore(stream) {
  const tier = detectLanguageTier(stream);
  if (tier === 3) return LANGUAGE_SCORES.latino;
  if (tier === 2) return LANGUAGE_SCORES.castellano;
  if (tier === 1) return LANGUAGE_SCORES.subtitulado;
  return 0;
}

function detectTransportScore(stream) {
  const url = String(stream._targetUrl || stream.url || "");
  if (/\.mp4(\?|$)/i.test(url)) return TRANSPORT_SCORES.mp4;
  if (/\.m3u8(\?|$)/i.test(url)) return TRANSPORT_SCORES.hls;
  return 0;
}

function detectComplexityPenalty(stream) {
  const requestHeaders = stream._proxyHeaders || stream.behaviorHints?.proxyHeaders?.request || {};
  let penalty = 0;

  if (stream.behaviorHints?.notWebReady) {
    penalty += COMPLEXITY_PENALTIES.notWebReady;
  }

  if (requestHeaders.Cookie) {
    penalty += COMPLEXITY_PENALTIES.hasCookie;
  }

  if (Object.keys(requestHeaders).length >= COMPLEXITY_PENALTIES.maxHeadersThreshold) {
    penalty += COMPLEXITY_PENALTIES.manyHeaders;
  }

  return penalty;
}

function detectSourceLabel(stream) {
  // Cache result on the stream to avoid recomputing
  if (stream._sourceLabel !== undefined) {
    return stream._sourceLabel;
  }

  const text = `${getTitleText(stream)} ${getNameText(stream)}`.toLowerCase();
  const url = String(stream._targetUrl || stream.url || "").toLowerCase();

  let label = "generic";
  for (const host of Object.keys(HOST_SCORES)) {
    if (text.includes(host) || url.includes(host)) {
      label = host;
      break;
    }
  }

  stream._sourceLabel = label;
  return label;
}

function detectProviderAdjustment(providerId, sourceLabel, stream, options = {}) {
  const effectiveProviderId = String(stream._providerId || providerId || "").toLowerCase();
  void options;

  const providerAdj = PROVIDER_ADJUSTMENTS[effectiveProviderId];
  if (providerAdj && providerAdj[sourceLabel] !== undefined) {
    return providerAdj[sourceLabel];
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

function streamPreferenceScore(stream) {
  const target = String(stream._targetUrl || stream.url || stream.externalUrl || "");
  const hasCanonicalTarget = target.length > 0 ? 2 : 0;
  const prefersDirectMedia = /\.mp4(\?|$)/i.test(target) ? 3 : /\.m3u8(\?|$)/i.test(target) ? 2 : 0;
  const fewerHeaders = Object.keys(stream._proxyHeaders || stream.behaviorHints?.proxyHeaders?.request || {}).length === 0 ? 1 : 0;
  const webReadyBonus = stream.behaviorHints?.notWebReady ? 0 : 1;
  const richerTitle = Math.min(getTitleText(stream).length, 120) / 120;
  return hasCanonicalTarget + prefersDirectMedia + fewerHeaders + webReadyBonus + richerTitle;
}

function dedupeStreams(streams) {
  return dedupeStreamsByTarget(streams, {
    buildKey(stream, canonicalTarget) {
      const sourceLabel = detectSourceLabel(stream);
      const languageTier = detectLanguageTier(stream);
      return canonicalTarget
        ? `${languageTier}::${sourceLabel}::${canonicalTarget}`
        : `${languageTier}::${sourceLabel}::${stream.url || ""}::${stream.externalUrl || ""}::${getTitleText(stream)}`;
    },
    shouldReplace(existing, incoming) {
      return streamPreferenceScore(incoming) > streamPreferenceScore(existing);
    },
    mapDuplicate(stream, key, canonicalTarget) {
      return {
        key,
        providerId: stream._providerId || null,
        url: stream.url || null,
        externalUrl: stream.externalUrl || null,
        canonicalTarget: canonicalTarget || null,
        name: stream.name || null,
        title: getTitleText(stream) || null,
        sourceLabel: detectSourceLabel(stream),
        languageTier: detectLanguageTier(stream)
      };
    }
  }).deduped;
}

function selectWithProviderDiversity(scoredItems, maxResults) {
  const targetCount = Math.max(1, maxResults);
  const selected = [];
  const usedProviders = new Set();

  // Pre-compute: for each provider, what's the highest language tier available?
  // This replaces an O(n^2) .some() loop inside the main iteration with O(1) lookups.
  const maxTierByProvider = new Map();
  for (const item of scoredItems) {
    const pid = String(item.stream._providerId || "").toLowerCase();
    if (!pid) continue;
    const tier = detectLanguageTier(item.stream);
    const current = maxTierByProvider.get(pid) || 0;
    if (tier > current) {
      maxTierByProvider.set(pid, tier);
    }
  }

  // Helper: is there any remaining provider with Latino (tier 3) that we haven't used yet?
  function hasRemainingLatinoAlternative() {
    for (const [pid, tier] of maxTierByProvider) {
      if (!usedProviders.has(pid) && tier >= 3) {
        return true;
      }
    }
    return false;
  }

  for (const item of scoredItems) {
    if (selected.length >= targetCount) {
      break;
    }

    const providerId = String(item.stream._providerId || "").toLowerCase();
    const languageTier = detectLanguageTier(item.stream);

    if (!providerId || usedProviders.has(providerId)) {
      continue;
    }

    // Skip non-Latino if there's still a Latino alternative available from another provider
    if (languageTier < 3 && hasRemainingLatinoAlternative()) {
      continue;
    }

    selected.push(item);
    usedProviders.add(providerId);
  }

  // Fill remaining slots with any unused providers
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
  const internalOnly = isInternalOnlyEnabled(false);

  return dedupeStreams(streams)
    .filter((stream) => {
      if (internalOnly && !isValidStreamTarget(stream.url)) {
        return false;
      }

      if (isValidStreamTarget(stream.url)) {
        return true;
      }

      return /^https?:\/\//i.test(String(stream.externalUrl || "").trim());
    })
    .filter((stream) => {
      const sourceLabel = detectSourceLabel(stream);
      return !disabledSources.has(sourceLabel) && isExtractorEnabled(sourceLabel);
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
        (HOST_SCORES[sourceLabel] || DEFAULT_HOST_SCORE) +
        resolutionScore +
        languageScore +
        transportScore -
        Math.abs(Math.min(providerAdjustment, 0)) +
        Math.max(providerAdjustment, 0) -
        complexityPenalty -
        penalty;

      const cleanedTitle = options.cleanTitle ? options.cleanTitle(getTitleText(stream)) : getTitleText(stream);
      const formattedTitle = buildHttpStreamTitle({
        ...stream,
        _rawTitle: cleanedTitle,
        title: cleanedTitle,
        _sourceLabel: sourceLabel
      });

      return {
        stream: {
          ...stream,
          _rawTitle: cleanedTitle,
          title: formattedTitle
        },
        score,
        sourceKey,
        sourceLabel,
        components: {
          hostBase: HOST_SCORES[sourceLabel] || DEFAULT_HOST_SCORE,
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
  const maxResults = getSelectionMaxResults();
  const cleaned = analyzeScoredStreams(providerId, streams, options);
  const selected = providerId === "global"
    ? selectWithProviderDiversity(cleaned, maxResults)
    : cleaned.slice(0, Math.max(1, maxResults));

  return selected.map((item) => {
    const { _sourceKey, _providerId, _proxyHeaders, _targetUrl, ...stream } = item.stream;
    return stream;
  });
}
