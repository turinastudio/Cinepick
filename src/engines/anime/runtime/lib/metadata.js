import { fetchJson } from "../../../../shared/fetch.cjs";

const DEFAULT_TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

function hasTmdbCredentials() {
  return Boolean(
    String(process.env.TMDB_API_READ_TOKEN || "").trim()
    || String(process.env.TMDB_API_KEY || DEFAULT_TMDB_API_KEY).trim()
  );
}

function getTmdbAuthToken() {
  const readToken = String(process.env.TMDB_API_READ_TOKEN || "").trim();
  if (readToken) {
    return { Authorization: `Bearer ${readToken}` };
  }

  const apiKey = String(process.env.TMDB_API_KEY || "").trim();
  if (apiKey) {
    return null;
  }

  return null;
}

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const CINEMETA_BASE = "https://v3-cinemeta.strem.io";

class Metadata {
  constructor(imdbId, tmdbId, type, title, summary, releaseDate, adult, originalTitle = undefined, aliases = []) {
    this.imdbID = imdbId;
    this.tmdbID = tmdbId;
    this.type = type;
    this.title = title;
    this.summary = summary;
    this.adult = adult;
    this.originalTitle = originalTitle || title;
    this.aliases = Array.isArray(aliases) ? aliases.filter(Boolean) : [];

    if (typeof releaseDate === "string") {
      this.releaseDate = new Date(releaseDate);
    } else if (releaseDate instanceof Date) {
      this.releaseDate = releaseDate;
    }
  }
}

function uniqueValues(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

async function fetchTmdbFindResults(imdbId, lang = undefined) {
  const apiKey = String(process.env.TMDB_API_KEY || DEFAULT_TMDB_API_KEY).trim();
  const headers = getTmdbAuthToken();
  const url = lang === undefined
    ? `${TMDB_API_BASE}/find/${imdbId}?external_source=imdb_id${apiKey ? `&api_key=${apiKey}` : ""}`
    : `${TMDB_API_BASE}/find/${imdbId}?external_source=imdb_id&language=${lang}${apiKey ? `&api_key=${apiKey}` : ""}`;

  return fetchJson(url, headers ? { headers } : {});
}

async function fetchTmdbAlternativeTitles(tmdbId, mediaType) {
  const apiKey = String(process.env.TMDB_API_KEY || DEFAULT_TMDB_API_KEY).trim();
  const headers = getTmdbAuthToken();
  const endpoint = mediaType === "tv" ? "alternative_titles" : "alternative_titles";
  const url = `${TMDB_API_BASE}/${mediaType}/${tmdbId}/${endpoint}${apiKey ? `?api_key=${apiKey}` : ""}`;
  const data = await fetchJson(url, headers ? { headers } : {}).catch(() => null);
  if (!data) {
    return [];
  }

  const items = Array.isArray(data.results) ? data.results : Array.isArray(data.titles) ? data.titles : [];
  return items
    .map((item) => item?.title || item?.name || item?.iso_3166_1 || null)
    .filter(Boolean);
}

async function fetchTmdbTranslations(tmdbId, mediaType) {
  const apiKey = String(process.env.TMDB_API_KEY || DEFAULT_TMDB_API_KEY).trim();
  const headers = getTmdbAuthToken();
  const url = `${TMDB_API_BASE}/${mediaType}/${tmdbId}/translations${apiKey ? `?api_key=${apiKey}` : ""}`;
  const data = await fetchJson(url, headers ? { headers } : {}).catch(() => null);
  if (!data || !Array.isArray(data.translations)) {
    return [];
  }

  return data.translations
    .flatMap((item) => [
      item?.data?.title,
      item?.data?.name,
      item?.data?.overview ? null : null
    ])
    .filter(Boolean);
}

async function enrichTmdbMetadata(metadata, mediaType, tmdbId, imdbId) {
  const [localized, altTitles, translations] = await Promise.all([
    fetchTmdbFindResults(imdbId, "en-US").catch(() => null),
    fetchTmdbAlternativeTitles(tmdbId, mediaType).catch(() => []),
    fetchTmdbTranslations(tmdbId, mediaType).catch(() => [])
  ]);

  const localizedResults = mediaType === "tv" ? localized?.tv_results : localized?.movie_results;
  const localizedItem = Array.isArray(localizedResults) ? localizedResults[0] : null;
  const aliases = uniqueValues([
    metadata.title,
    metadata.originalTitle,
    localizedItem?.name,
    localizedItem?.title,
    localizedItem?.original_name,
    localizedItem?.original_title,
    ...altTitles,
    ...translations,
    ...(Array.isArray(metadata.aliases) ? metadata.aliases : [])
  ]);

  metadata.originalTitle = uniqueValues([
    metadata.originalTitle,
    localizedItem?.original_name,
    localizedItem?.original_title
  ])[0] || metadata.originalTitle;
  metadata.aliases = aliases.filter((value) => value.toLowerCase() !== String(metadata.title || "").toLowerCase());
  return metadata;
}

function parseTmdbMeta(resultsArray, imdbId) {
  const firstItem = resultsArray[0];
  const releaseDate = firstItem.release_date || firstItem.first_air_date;
  const title = firstItem.title || firstItem.name;
  const originalTitle = firstItem.original_title || firstItem.original_name || title;
  return new Metadata(imdbId, firstItem.id, firstItem.media_type, title, firstItem.overview, releaseDate, firstItem.adult, originalTitle, []);
}

function parseCinemetaMeta(meta) {
  const aliases = []
    .concat(Array.isArray(meta?.aliases) ? meta.aliases : [])
    .concat(Array.isArray(meta?.alternativeTitles) ? meta.alternativeTitles : []);
  return new Metadata(meta.id, meta.moviedb_id, meta.type, meta.name, meta.description, meta.released || meta.releaseInfo, undefined, meta.name, aliases);
}

async function getTmdbMeta(imdbId, lang = undefined) {
  const data = await fetchTmdbFindResults(imdbId, lang);
  if (!data) {
    throw new Error("Invalid response!");
  }

  if (data.movie_results?.length > 0) {
    const metadata = parseTmdbMeta(data.movie_results, imdbId);
    return enrichTmdbMetadata(metadata, "movie", String(data.movie_results[0].id), imdbId);
  }

  if (data.tv_results?.length > 0) {
    const metadata = parseTmdbMeta(data.tv_results, imdbId);
    return enrichTmdbMetadata(metadata, "tv", String(data.tv_results[0].id), imdbId);
  }

  throw new Error("No results found!");
}

async function getImdbIdFromTmdbId(tmdbId, mediaType) {
  const normalizedType = mediaType === "series" ? "tv" : mediaType;
  const apiKey = String(process.env.TMDB_API_KEY || "").trim();
  const headers = getTmdbAuthToken();
  const url = `${TMDB_API_BASE}/${normalizedType}/${tmdbId}/external_ids${apiKey ? `?api_key=${apiKey}` : ""}`;
  const data = await fetchJson(url, headers ? { headers } : {});

  if (!data) {
    throw new Error("Invalid response!");
  }

  if (data.imdb_id === undefined) {
    throw new Error("No IMDB ID found!");
  }

  return data.imdb_id;
}

async function getCinemetaMeta(imdbId, type = "movie") {
  const url = `${CINEMETA_BASE}/meta/${type}/${imdbId}.json`;
  const data = await fetchJson(url);

  if (data?.meta === undefined) {
    throw new Error("Invalid response!");
  }

  return parseCinemetaMeta(data.meta);
}

export {
  Metadata,
  getCinemetaMeta,
  getImdbIdFromTmdbId,
  getTmdbMeta,
  hasTmdbCredentials
};
