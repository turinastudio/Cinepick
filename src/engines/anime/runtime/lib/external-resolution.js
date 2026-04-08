const fuzzysort = require("fuzzysort");
const { getExternalIdDetails } = require("./ids");
const { getCinemetaMeta, getImdbIdFromTmdbId, getTmdbMeta, hasTmdbCredentials } = require("./metadata");
const { getImdbIdFromAnimeId } = require("./relations");

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

function pickHenaojaraCandidate(results, searchTerm, type) {
  const target = normalizeText(searchTerm);
  const targetWords = new Set(target.split(" ").filter(Boolean));
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
      let score = 0;

      if (title === target) score += 1200;
      if (title.startsWith(target)) score += 180;
      if (combined.includes(target)) score += 120;
      score += overlap * 90;
      if (candidate?.type === type) score += 160;
      else if (candidate?.type) score -= 220;
      score -= extraWords.length * 14;
      if (hasSpecialPenalty) score -= 260;

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

module.exports = {
  buildSearchTerm,
  buildSearchTerms,
  pickCandidateForProvider,
  resolveExternalMetadata
};
