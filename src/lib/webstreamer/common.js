import { buildStremioId } from "../ids.js";

export function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#8211;/gi, "-")
    .replace(/&#215;/gi, "x")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTitle(value) {
  return stripTags(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function tokenizeTitle(value) {
  return stripTags(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function buildSearchTerms(...values) {
  const terms = new Set();

  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) {
      continue;
    }

    terms.add(value);

    const stripped = value.replace(/^(the|a|an)\s+/i, "").trim();
    if (stripped && stripped !== value) {
      terms.add(stripped);
    }
  }

  return [...terms];
}

export function scoreSearchCandidate(targetTitle, rawTitle, expectedYear, matchedYear) {
  const targetNorm = normalizeTitle(targetTitle);
  const rawNorm = normalizeTitle(rawTitle);
  const targetTokens = tokenizeTitle(targetTitle);
  const rawTokens = tokenizeTitle(rawTitle);
  const expectedYearNumber = Number.parseInt(expectedYear, 10);
  const matchedYearNumber = Number.parseInt(matchedYear, 10);
  let score = 0;

  if (!targetNorm || !rawNorm) {
    return score;
  }

  if (rawNorm === targetNorm) {
    score += 10;
  } else if (rawNorm.includes(targetNorm) || targetNorm.includes(rawNorm)) {
    score += 5;
  }

  const overlappingTokens = targetTokens.filter((token) => rawTokens.includes(token)).length;
  score += Math.min(overlappingTokens, 4);

  if (targetTokens.length === 1 && rawTokens.length > 2 && overlappingTokens === 0) {
    score -= 6;
  }

  if (targetTokens.length > 1 && overlappingTokens === 0) {
    score -= 8;
  }

  if (Number.isFinite(expectedYearNumber) && Number.isFinite(matchedYearNumber)) {
    if (matchedYearNumber === expectedYearNumber) {
      score += 4;
    } else {
      score -= 3;
    }
  }

  return score;
}

export function absoluteUrl(rawUrl, origin) {
  if (!rawUrl) {
    return null;
  }

  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  if (/^\/\//.test(rawUrl)) {
    return `https:${rawUrl}`;
  }

  try {
    return new URL(rawUrl, origin).href;
  } catch {
    return null;
  }
}

export function dedupeByKey(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function buildEpisodeTag(season, episode) {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export function parseExternalStremioId(type, externalId) {
  const [baseId, seasonRaw, episodeRaw] = String(externalId || "").split(":");
  return {
    baseId,
    season: type === "series" && seasonRaw ? Number.parseInt(seasonRaw, 10) : null,
    episode: type === "series" && episodeRaw ? Number.parseInt(episodeRaw, 10) : null
  };
}

export function buildYearFromMeta(meta) {
  return String(meta?.releaseInfo || meta?.year || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
}

export function mapSearchItem(providerId, type, slug, name, releaseInfo = "", poster = null) {
  return {
    id: buildStremioId(providerId, type, slug),
    type,
    name: stripTags(name),
    poster,
    posterShape: "poster",
    description: "",
    genres: [],
    releaseInfo
  };
}
