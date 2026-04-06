import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import { normalizeMediaTitle } from "./tmdb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "..", "..", "Recursos", "animestream-addon", "data");
const CATALOG_GZ = path.join(DATA_DIR, "catalog.json.gz");
const CATALOG_JSON = path.join(DATA_DIR, "catalog.json");
const OTAKU_MAPPINGS_JSON = path.join(DATA_DIR, "otaku-mappings.json");

let animeCatalogCache = null;
let otakuMappingsCache = null;

function normalizeAnimeLookupTitle(value) {
  return normalizeMediaTitle(String(value || ""))
    .replace(/\b(tv|anime|movie|pelicula|film|ova|ona|special|season|part)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureCatalogLoaded() {
  if (animeCatalogCache) {
    return animeCatalogCache;
  }

  let raw = "";
  if (fs.existsSync(CATALOG_GZ)) {
    raw = zlib.gunzipSync(fs.readFileSync(CATALOG_GZ)).toString("utf8");
  } else if (fs.existsSync(CATALOG_JSON)) {
    raw = fs.readFileSync(CATALOG_JSON, "utf8");
  } else {
    animeCatalogCache = {
      byImdbId: new Map(),
      byNormalizedTitle: new Map(),
      catalog: []
    };
    return animeCatalogCache;
  }

  const parsed = JSON.parse(raw);
  const catalog = Array.isArray(parsed?.catalog) ? parsed.catalog : [];
  const byImdbId = new Map();
  const byNormalizedTitle = new Map();

  for (const item of catalog) {
    if (item?.imdb_id) {
      byImdbId.set(String(item.imdb_id), item);
    }

    const values = [
      item?.name,
      ...(Array.isArray(item?.synonyms) ? item.synonyms : [])
    ];

    for (const value of values) {
      const normalized = normalizeAnimeLookupTitle(value);
      if (!normalized) {
        continue;
      }

      if (!byNormalizedTitle.has(normalized)) {
        byNormalizedTitle.set(normalized, []);
      }
      byNormalizedTitle.get(normalized).push(item);
    }
  }

  animeCatalogCache = { catalog, byImdbId, byNormalizedTitle };
  return animeCatalogCache;
}

function ensureOtakuMappingsLoaded() {
  if (otakuMappingsCache) {
    return otakuMappingsCache;
  }

  if (!fs.existsSync(OTAKU_MAPPINGS_JSON)) {
    otakuMappingsCache = {
      byImdbId: new Map(),
      byTmdbId: new Map(),
      byNormalizedTitle: new Map(),
      entries: []
    };
    return otakuMappingsCache;
  }

  const parsed = JSON.parse(fs.readFileSync(OTAKU_MAPPINGS_JSON, "utf8"));
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const byImdbId = new Map();
  const byTmdbId = new Map();
  const byNormalizedTitle = new Map();

  for (const entry of entries) {
    if (entry?.imdb) {
      byImdbId.set(String(entry.imdb), entry);
    }

    if (entry?.tmdb) {
      byTmdbId.set(String(entry.tmdb), entry);
    }

    const values = [entry?.title, ...(Array.isArray(entry?.syn) ? entry.syn : [])];
    for (const value of values) {
      const normalized = normalizeAnimeLookupTitle(value);
      if (!normalized) {
        continue;
      }

      if (!byNormalizedTitle.has(normalized)) {
        byNormalizedTitle.set(normalized, []);
      }
      byNormalizedTitle.get(normalized).push(entry);
    }
  }

  otakuMappingsCache = { byImdbId, byTmdbId, byNormalizedTitle, entries };
  return otakuMappingsCache;
}

function scoreCatalogMatch(item, normalizedQueries, year) {
  const itemYear = String(item?.year || "");
  const values = [
    item?.name,
    ...(Array.isArray(item?.synonyms) ? item.synonyms : [])
  ];

  let score = 0;
  for (const value of values) {
    const normalizedValue = normalizeAnimeLookupTitle(value);
    if (!normalizedValue) {
      continue;
    }

    for (const query of normalizedQueries) {
      if (!query) {
        continue;
      }

      if (normalizedValue === query) {
        score = Math.max(score, 100);
      } else if (normalizedValue.includes(query) || query.includes(normalizedValue)) {
        score = Math.max(score, 85);
      } else {
        const queryWords = query.split(/\s+/).filter(Boolean);
        const valueWords = normalizedValue.split(/\s+/).filter(Boolean);
        const overlap = queryWords.filter((word) => valueWords.includes(word)).length;
        if (overlap > 0) {
          const localScore = Math.round((overlap / Math.max(queryWords.length, valueWords.length)) * 70);
          score = Math.max(score, localScore);
        }
      }
    }
  }

  if (year && itemYear) {
    score += itemYear === String(year) ? 12 : -6;
  }

  return score;
}

export function getAnimeMappingByImdbId(imdbId) {
  if (!imdbId) {
    return null;
  }

  const { byImdbId } = ensureCatalogLoaded();
  return byImdbId.get(String(imdbId)) || null;
}

export function getOtakuMappingByImdbId(imdbId) {
  if (!imdbId) {
    return null;
  }

  const { byImdbId } = ensureOtakuMappingsLoaded();
  return byImdbId.get(String(imdbId)) || null;
}

export function getOtakuMappingByTmdbId(tmdbId) {
  if (!tmdbId) {
    return null;
  }

  const { byTmdbId } = ensureOtakuMappingsLoaded();
  return byTmdbId.get(String(tmdbId)) || null;
}

export function findBestOtakuMappingByTitle(titles = []) {
  const queries = [...new Set(titles.map((value) => normalizeAnimeLookupTitle(value)).filter(Boolean))];
  if (!queries.length) {
    return null;
  }

  const { byNormalizedTitle, entries } = ensureOtakuMappingsLoaded();
  const candidates = new Map();

  for (const query of queries) {
    for (const entry of byNormalizedTitle.get(query) || []) {
      candidates.set(String(entry.imdb || entry.tmdb || entry.title), entry);
    }
  }

  if (!candidates.size) {
    for (const entry of entries) {
      const values = [entry?.title, ...(Array.isArray(entry?.syn) ? entry.syn : [])];
      const normalizedValues = values.map((value) => normalizeAnimeLookupTitle(value)).filter(Boolean);
      let score = 0;

      for (const normalizedValue of normalizedValues) {
        for (const query of queries) {
          if (normalizedValue === query) {
            score = Math.max(score, 100);
          } else if (normalizedValue.includes(query) || query.includes(normalizedValue)) {
            score = Math.max(score, 85);
          }
        }
      }

      if (score >= 85) {
        candidates.set(String(entry.imdb || entry.tmdb || entry.title), entry);
      }
    }
  }

  let best = null;
  for (const entry of candidates.values()) {
    const values = [entry?.title, ...(Array.isArray(entry?.syn) ? entry.syn : [])];
    let score = 0;
    for (const value of values) {
      const normalizedValue = normalizeAnimeLookupTitle(value);
      if (!normalizedValue) {
        continue;
      }

      for (const query of queries) {
        if (normalizedValue === query) {
          score = Math.max(score, 100);
        } else if (normalizedValue.includes(query) || query.includes(normalizedValue)) {
          score = Math.max(score, 85);
        }
      }
    }

    if (!best || score > best.score) {
      best = { entry, score };
    }
  }

  return best && best.score >= 85 ? best.entry : null;
}

export function findBestAnimeMappingByTitle(titles = [], year = "") {
  const queries = [...new Set(titles.map((value) => normalizeAnimeLookupTitle(value)).filter(Boolean))];
  if (!queries.length) {
    return null;
  }

  const { byNormalizedTitle, catalog } = ensureCatalogLoaded();
  const candidates = new Map();

  for (const query of queries) {
    const exactMatches = byNormalizedTitle.get(query) || [];
    for (const item of exactMatches) {
      candidates.set(item.id, item);
    }
  }

  if (!candidates.size) {
    for (const item of catalog) {
      const score = scoreCatalogMatch(item, queries, year);
      if (score >= 45) {
        candidates.set(item.id, item);
      }
    }
  }

  let best = null;
  for (const item of candidates.values()) {
    const score = scoreCatalogMatch(item, queries, year);
    if (!best || score > best.score) {
      best = { item, score };
    }
  }

  return best && best.score >= 45 ? best.item : null;
}

export function getAnimeMappingTitles(item) {
  if (!item) {
    return [];
  }

  return [...new Set(
    [item.name, ...(Array.isArray(item.synonyms) ? item.synonyms : [])]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

export function getOtakuMappingTitles(item) {
  if (!item) {
    return [];
  }

  return [...new Set(
    [item.title, ...(Array.isArray(item.syn) ? item.syn : [])]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

export function hasOtakuDub(item) {
  return Boolean(item?.dub);
}
