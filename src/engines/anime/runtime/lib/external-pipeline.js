import {
  buildSearchTerm,
  buildSearchTerms,
  pickCandidateForProvider
} from "./external-resolution.js";
import { getOrderedProviders, getProviderById } from "../providers/registry.js";

const STRONG_MOVIE_TOKENS = new Set([
  "movie",
  "film",
  "pelicula",
  "stampede",
  "special",
  "specials",
  "especial",
  "especiales",
  "ova",
  "oad"
]);
const STRONG_SERIES_TOKENS = new Set(["season", "temporada"]);
const MIN_ACCEPTED_CANDIDATE_SCORE = 120;
const MIN_SINGLE_RESULT_SCORE = 60;
const GENERIC_SERIES_TOKENS = new Set(["tv", "anime"]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function countMatchingTokens(leftTokens, rightTokenSet) {
  return leftTokens.reduce((count, token) => count + (rightTokenSet.has(token) ? 1 : 0), 0);
}

function countStrongExtraTokens(extraTokens, type) {
  const strongTokens = type === "series" ? STRONG_MOVIE_TOKENS : STRONG_SERIES_TOKENS;
  return extraTokens.reduce((count, token) => count + (strongTokens.has(token) ? 1 : 0), 0);
}

function findCandidateRejectionReason(candidate, term, type) {
  if (!candidate?.title || !term) {
    return "No candidate matched search term";
  }

  const normalizedTerm = normalizeText(term);
  const candidateTitle = normalizeText(candidate.title);
  const termTokens = tokenize(term);
  const termTokenSet = new Set(termTokens);
  const candidateTokens = tokenize(candidate.title);
  const extraTokens = candidateTokens.filter((token) => !termTokenSet.has(token));
  const nonGenericExtraTokens = extraTokens.filter((token) => !GENERIC_SERIES_TOKENS.has(token));

  if (type === "series" && candidate.type && candidate.type !== "series") {
    return "Candidate type does not match requested series";
  }

  if (
    type === "series"
    && normalizedTerm
    && candidateTitle !== normalizedTerm
    && termTokens.length <= 3
    && nonGenericExtraTokens.length >= 2
  ) {
    return "Candidate looks like a saga, arc or spin-off instead of the base series";
  }

  return null;
}

function scoreCandidateMatch(candidate, term, type) {
  if (!candidate?.title || !term) {
    return Number.NEGATIVE_INFINITY;
  }

  const candidateTitle = normalizeText(candidate.title);
  const normalizedTerm = normalizeText(term);
  const candidateTokens = tokenize(candidate.title);
  const termTokens = tokenize(term);
  const candidateTokenSet = new Set(candidateTokens);
  const termTokenSet = new Set(termTokens);
  const matchingTokens = countMatchingTokens(termTokens, candidateTokenSet);
  const extraTokens = candidateTokens.filter((token) => !termTokenSet.has(token));
  const matchingRatio = termTokens.length > 0 ? matchingTokens / termTokens.length : 0;
  let score = 0;

  if (candidateTitle === normalizedTerm) {
    score += 1000;
  }

  if (candidateTitle.includes(normalizedTerm) || normalizedTerm.includes(candidateTitle)) {
    score += 250;
  }

  if (candidateTitle.startsWith(normalizedTerm)) {
    score += 120;
  }

  score += Math.round(matchingRatio * 320);

  if (candidate.type === type) {
    score += 140;
  } else if (candidate.type) {
    score -= 320;
  }

  score -= extraTokens.length * 22;
  score -= countStrongExtraTokens(extraTokens, type) * 180;
  score -= Math.abs(candidateTitle.length - normalizedTerm.length);
  return score;
}

function canAcceptSingleProviderResult(candidate, score, rejectionReason, type) {
  if (!candidate || !Number.isFinite(score) || score < MIN_SINGLE_RESULT_SCORE || rejectionReason) {
    return false;
  }

  if (type === "series" && candidate.type && candidate.type !== "series") {
    return false;
  }

  if (type === "movie" && candidate.type && candidate.type !== "movie") {
    return false;
  }

  return true;
}

function canAcceptDominantCandidate(bestCandidate, secondScore, rejectionReason, type) {
  if (!bestCandidate || !Number.isFinite(bestCandidate.score) || bestCandidate.score < MIN_SINGLE_RESULT_SCORE || rejectionReason) {
    return false;
  }

  if (type === "series" && bestCandidate.candidate?.type && bestCandidate.candidate.type !== "series") {
    return false;
  }

  if (type === "movie" && bestCandidate.candidate?.type && bestCandidate.candidate.type !== "movie") {
    return false;
  }

  const runnerUpScore = Number.isFinite(secondScore) ? secondScore : Number.NEGATIVE_INFINITY;
  return bestCandidate.score - runnerUpScore >= 60;
}

function evaluateCandidates(providerId, results, term, type) {
  const candidates = Array.isArray(results) ? results : [];
  const scoredCandidates = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidateMatch(candidate, term, type)
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score);

  const preferredCandidate = pickCandidateForProvider(providerId, candidates, term, type);
  if (preferredCandidate) {
    const preferredScore = scoreCandidateMatch(preferredCandidate, term, type);
    const bestCurrentScore = scoredCandidates[0]?.score ?? Number.NEGATIVE_INFINITY;
    const preferredRejectionReason = findCandidateRejectionReason(preferredCandidate, term, type);

    if (
      Number.isFinite(preferredScore)
      && preferredScore >= MIN_ACCEPTED_CANDIDATE_SCORE
      && !preferredRejectionReason
      && preferredScore >= bestCurrentScore - 20
    ) {
      return {
        pickedCandidate: preferredCandidate,
        score: preferredScore,
        accepted: true,
        rejectionReason: null,
        topCandidates: scoredCandidates.slice(0, 3).map((item) => ({
          slug: item.candidate.slug,
          title: item.candidate.title,
          type: item.candidate.type,
          score: item.score
        }))
      };
    }

    if (
      candidates.length === 1
      && canAcceptSingleProviderResult(preferredCandidate, preferredScore, preferredRejectionReason, type)
    ) {
      return {
        pickedCandidate: preferredCandidate,
        score: preferredScore,
        accepted: true,
        rejectionReason: null,
        topCandidates: scoredCandidates.slice(0, 3).map((item) => ({
          slug: item.candidate.slug,
          title: item.candidate.title,
          type: item.candidate.type,
          score: item.score
        }))
      };
    }
  }

  const bestCandidate = scoredCandidates[0];
  const secondScore = scoredCandidates[1]?.score ?? Number.NEGATIVE_INFINITY;
  const bestCandidateRejectionReason = bestCandidate
    ? findCandidateRejectionReason(bestCandidate.candidate, term, type)
    : null;

  if (canAcceptDominantCandidate(bestCandidate, secondScore, bestCandidateRejectionReason, type)) {
    return {
      pickedCandidate: bestCandidate.candidate,
      score: bestCandidate.score,
      accepted: true,
      rejectionReason: null,
      topCandidates: scoredCandidates.slice(0, 3).map((item) => ({
        slug: item.candidate.slug,
        title: item.candidate.title,
        type: item.candidate.type,
        score: item.score
      }))
    };
  }

  if (!bestCandidate || bestCandidate.score < MIN_ACCEPTED_CANDIDATE_SCORE || bestCandidateRejectionReason) {
    return {
      pickedCandidate: null,
      score: bestCandidate?.score ?? Number.NEGATIVE_INFINITY,
      accepted: false,
      rejectionReason: bestCandidate
        ? (bestCandidateRejectionReason || "Best candidate score below acceptance threshold")
        : "No candidate matched search term",
      topCandidates: scoredCandidates.slice(0, 3).map((item) => ({
        slug: item.candidate.slug,
        title: item.candidate.title,
        type: item.candidate.type,
        score: item.score
      }))
    };
  }

  return {
    pickedCandidate: bestCandidate.candidate,
    score: bestCandidate.score,
    accepted: true,
    rejectionReason: null,
    topCandidates: scoredCandidates.slice(0, 3).map((item) => ({
      slug: item.candidate.slug,
      title: item.candidate.title,
      type: item.candidate.type,
      score: item.score
    }))
  };
}

async function resolveCandidateForProvider(provider, type, resolvedMetadata) {
  const searchTerm = buildSearchTerm(resolvedMetadata);
  const searchTerms = buildSearchTerms(resolvedMetadata);
  const requestedSeason = Number.parseInt(resolvedMetadata?.season, 10);
  let bestCandidate = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const attempts = [];

  for (const term of searchTerms) {
    const results = await provider.search({ query: term, type }).catch(() => []);
    const evaluation = evaluateCandidates(provider.id, results, term, type);
    const pickedCandidate = evaluation.pickedCandidate;
    const score = evaluation.score;

    attempts.push({
      term,
      resultCount: Array.isArray(results) ? results.length : 0,
      accepted: evaluation.accepted,
      score,
      rejectionReason: evaluation.rejectionReason,
      topCandidates: evaluation.topCandidates,
      pickedCandidate: pickedCandidate
        ? {
            slug: pickedCandidate.slug,
            title: pickedCandidate.title,
            type: pickedCandidate.type
          }
        : null
    });

    if (pickedCandidate && score > bestScore) {
      bestCandidate = pickedCandidate;
      bestScore = score;
    }
  }

  if (provider.id === "henaojara" && Number.isInteger(requestedSeason) && requestedSeason > 1) {
    const seasonAwareAttempts = attempts.filter((attempt) => {
      const normalizedTerm = normalizeText(attempt.term);
      return normalizedTerm.includes(` ${requestedSeason}`)
        || normalizedTerm.includes(`season ${requestedSeason}`)
        || normalizedTerm.includes(`temporada ${requestedSeason}`);
    });

    const acceptedSeasonAware = seasonAwareAttempts
      .filter((attempt) => attempt.accepted && attempt.pickedCandidate)
      .sort((left, right) => (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY));

    if (acceptedSeasonAware[0]?.pickedCandidate) {
      bestCandidate = acceptedSeasonAware[0].pickedCandidate;
      bestScore = acceptedSeasonAware[0].score ?? bestScore;
    }
  }

  return {
    searchTerm,
    searchTerms,
    bestCandidate,
    attempts
  };
}

async function resolveProviderCandidates(type, resolvedMetadata) {
  const searchTerm = buildSearchTerm(resolvedMetadata);
  const searchTerms = buildSearchTerms(resolvedMetadata);
  const entries = await Promise.all(getOrderedProviders().map(async (provider) => {
    const resolved = await resolveCandidateForProvider(provider, type, resolvedMetadata);
    return [
      provider.id,
      resolved.bestCandidate
    ];
  }));

  return {
    searchTerm,
    searchTerms,
    candidates: Object.fromEntries(entries)
  };
}

async function resolveProviderCandidatesDetailed(type, resolvedMetadata) {
  const searchTerm = buildSearchTerm(resolvedMetadata);
  const searchTerms = buildSearchTerms(resolvedMetadata);
  const details = await Promise.all(getOrderedProviders().map(async (provider) => {
    const resolved = await resolveCandidateForProvider(provider, type, resolvedMetadata);
    const picked = resolved.bestCandidate;
    const firstAttempt = resolved.attempts[0];

    return {
      providerId: provider.id,
      searchTerm,
      searchTerms,
      resultCount: firstAttempt?.resultCount || 0,
      attempts: resolved.attempts,
      pickedCandidate: picked
        ? {
            slug: picked.slug,
            title: picked.title,
            type: picked.type
          }
        : null
    };
  }));

  return {
    searchTerm,
    searchTerms,
    candidates: Object.fromEntries(details.map((item) => [item.providerId, item.pickedCandidate])),
    details
  };
}

async function collectStreamGroups(candidates, episode) {
  const settled = await Promise.allSettled(
    getOrderedProviders().map((provider) => {
      const candidate = candidates[provider.id];
      if (!candidate?.slug) {
        return Promise.resolve([]);
      }

      return provider.getStreams({ slug: candidate.slug, episode });
    })
  );

  return getOrderedProviders().map((provider, index) => {
    const item = settled[index];
    return {
      providerId: provider.id,
      ok: item?.status === "fulfilled",
      streams: item?.status === "fulfilled" ? item.value : [],
      error: item?.status === "rejected" ? (item.reason?.message || String(item.reason)) : null
    };
  });
}

function getExternalMetaSource(candidates) {
  const providerOrder = ["animeflv", "animeav1", "henaojara", "tioanime"];
  const providerId = providerOrder.find((id) => candidates[id]?.slug) || "animeflv";
  const selected = candidates[providerId];
  return {
    providerId,
    slug: selected?.slug || null,
    candidate: selected || null
  };
}

async function getExternalMetaFromCandidates(candidates) {
  const metaSource = getExternalMetaSource(candidates);

  if (!metaSource.slug) {
    throw new Error("No provider candidate");
  }

  const meta = await getProviderById(metaSource.providerId).getMeta({ slug: metaSource.slug });
  return {
    meta,
    metaSource
  };
}

export {
  collectStreamGroups,
  getExternalMetaFromCandidates,
  getExternalMetaSource,
  resolveProviderCandidates,
  resolveProviderCandidatesDetailed
};
