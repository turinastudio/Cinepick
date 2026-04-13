import fuzzysort from "fuzzysort";
import { getExternalIdDetails } from "./ids.js";
import { getCinemetaMeta, getImdbIdFromTmdbId, getTmdbMeta, hasTmdbCredentials } from "./metadata.js";
import { getImdbIdFromAnimeId } from "./relations.js";

async function resolveImdbId(type, videoId) {
  const details = getExternalIdDetails(videoId);

  if (!details) {
    throw new Error("Wrong ID format, check manifest for errors");
  }

  if (details.kind === "imdb") {
    return {
      imdbId: details.imdbId,
      season: details.season,
      episode: details.episode
    };
  }

  if (details.kind === "tmdb") {
    const imdbId = await getImdbIdFromTmdbId(details.tmdbId, type);
    return {
      imdbId,
      season: details.season,
      episode: details.episode
    };
  }

  const imdbId = await getImdbIdFromAnimeId(details.provider, details.providerId);
  return {
    imdbId,
    season: undefined,
    episode: details.episode
  };
}

async function resolveExternalMetadata(type, videoId) {
  const { imdbId, season, episode } = await resolveImdbId(type, videoId);
  if (!imdbId || imdbId === "null") {
    throw new Error("No IMDB ID");
  }

  const metadata = hasTmdbCredentials()
    ? await getTmdbMeta(imdbId).catch(() => getCinemetaMeta(imdbId, type))
    : await getCinemetaMeta(imdbId, type);

  return {
    metadata,
    season,
    episode
  };
}

function buildSearchTerm(resolvedMetadata) {
  return resolvedMetadata.season && Number.parseInt(resolvedMetadata.season, 10) !== 1
    ? `${resolvedMetadata.metadata.title} ${resolvedMetadata.season}`
    : resolvedMetadata.metadata.title;
}

function normalizeSearchVariant(value) {
  return String(value || "")
    .replace(/[.:!?,'"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchTerms(resolvedMetadata) {
  const metadata = resolvedMetadata?.metadata || {};
  const season = Number.parseInt(resolvedMetadata?.season, 10);
  const rawTerms = [
    metadata.title,
    metadata.originalTitle,
    ...(Array.isArray(metadata.aliases) ? metadata.aliases : [])
  ].filter(Boolean);

  const terms = [];
  const seen = new Set();

  function pushTerm(term) {
    const normalized = String(term || "").trim();
    if (!normalized) {
      return;
    }

    if (!seen.has(normalized.toLowerCase())) {
      seen.add(normalized.toLowerCase());
      terms.push(normalized);
    }
  }

  for (const term of rawTerms) {
    pushTerm(term);

    const variant = normalizeSearchVariant(term);
    if (variant.toLowerCase() !== String(term).trim().toLowerCase()) {
      pushTerm(variant);
    }

    if (Number.isInteger(season) && season > 1) {
      pushTerm(`${term} ${season}`);
      pushTerm(`${variant} ${season}`);
      pushTerm(`${term} season ${season}`);
      pushTerm(`${variant} season ${season}`);
    }
  }

  if (terms.length === 0 && metadata.title) {
    pushTerm(metadata.title);
  }

  return terms;
}

function pickAnimeFLVCandidate(results, searchTerm, type) {
  return fuzzysort.go(searchTerm, results, { key: "title", limit: 1, all: true })[0]?.obj
    || results.sort((a, b) => (a.type === type && b.type !== type ? -1 : 0))[0];
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRequestedSeason(searchTerm) {
  const normalized = normalizeText(searchTerm);
  const explicitSeasonMatch = normalized.match(/\bseason\s+(\d+)\b/);
  if (explicitSeasonMatch?.[1]) {
    return Number.parseInt(explicitSeasonMatch[1], 10);
  }

  const trailingNumberMatch = normalized.match(/(?:^|\s)(\d+)\s*$/);
  if (trailingNumberMatch?.[1]) {
    return Number.parseInt(trailingNumberMatch[1], 10);
  }

  return null;
}

function extractCandidateSeasonSignals(candidate) {
  const title = normalizeText(candidate?.title);
  const slug = normalizeText(String(candidate?.slug || "").replace(/-/g, " "));
  const combined = `${title} ${slug}`.trim();
  const signals = {
    combined,
    hasFinalSeason: /\bfinal\s+season\b/.test(combined),
    seasonNumber: null,
    hasAltVariantPenalty: /\b(hla|ona|memories|training|special|specials|ova|oad|movie|film|pelicula)\b/.test(combined)
  };

  const seasonPatterns = [
    /\b(\d+)(?:st|nd|rd|th)\s+season\b/,
    /\bseason\s+(\d+)\b/,
    /\btemporada\s+(\d+)\b/
  ];

  for (const pattern of seasonPatterns) {
    const match = combined.match(pattern);
    if (match?.[1]) {
      signals.seasonNumber = Number.parseInt(match[1], 10);
      break;
    }
  }

  return signals;
}

function pickHenaojaraCandidate(results, searchTerm, type) {
  const target = normalizeText(searchTerm);
  const targetWords = new Set(target.split(" ").filter(Boolean));
  const requestedSeason = extractRequestedSeason(searchTerm);
  const candidates = Array.isArray(results) ? results : [];
  const scored = candidates
    .map((candidate) => {
      const title = normalizeText(candidate?.title);
      const slug = normalizeText(String(candidate?.slug || "").replace(/-/g, " "));
      const combined = `${title} ${slug}`.trim();
      const words = combined.split(" ").filter(Boolean);
      const overlap = words.filter((word) => targetWords.has(word)).length;
      const extraWords = words.filter((word) => !targetWords.has(word));
      const hasSpecialPenalty = extraWords.some((word) =>
        ["special", "especial", "movie", "film", "pelicula", "latino", "ova", "oad", "stampede", "gold", "episode", "episodio"].includes(word)
      );
      const seasonSignals = extractCandidateSeasonSignals(candidate);
      let score = 0;

      if (title === target) score += 1200;
      if (title.startsWith(target)) score += 180;
      if (combined.includes(target)) score += 120;
      score += overlap * 90;
      if (candidate?.type === type) score += 160;
      else if (candidate?.type) score -= 220;
      score -= extraWords.length * 14;
      if (hasSpecialPenalty) score -= 260;

      if (requestedSeason) {
        if (seasonSignals.seasonNumber === requestedSeason) {
          score += 420;
        } else if (
          requestedSeason >= 8
          && seasonSignals.hasFinalSeason
        ) {
          score += 360;
        } else if (seasonSignals.seasonNumber && seasonSignals.seasonNumber !== requestedSeason) {
          score -= 320;
        }

        if (seasonSignals.hasAltVariantPenalty) {
          score -= 280;
        }
      }

      return { candidate, score };
    })
    .sort((left, right) => right.score - left.score);

  return scored[0]?.candidate || null;
}

function pickDefaultCandidate(results, searchTerm) {
  return fuzzysort.go(searchTerm, results, { key: "title", limit: 1, all: true })[0]?.obj || results[0];
}

function pickCandidateForProvider(providerId, results, searchTerm, type) {
  if (providerId === "animeflv") {
    return pickAnimeFLVCandidate(results, searchTerm, type);
  }

  if (providerId === "henaojara") {
    return pickHenaojaraCandidate(results, searchTerm, type);
  }

  return pickDefaultCandidate(results, searchTerm);
}

export {
  buildSearchTerm,
  buildSearchTerms,
  pickCandidateForProvider,
  resolveExternalMetadata
};
