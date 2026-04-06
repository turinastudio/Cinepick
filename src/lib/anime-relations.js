import { fetchJson } from "./webstreamer/http.js";

const RELATIONS_BASE_URL = "https://relations.yuna.moe/api/v2";
const SUPPORTED_ANIME_ID_PREFIXES = new Set(["tt", "tmdb", "mal", "anilist", "kitsu", "anidb"]);

export function isSupportedAnimeExternalId(externalId) {
  const raw = String(externalId || "").trim();
  if (!raw) {
    return false;
  }

  if (raw.startsWith("tt")) {
    return true;
  }

  const prefix = raw.split(":")[0].toLowerCase();
  return SUPPORTED_ANIME_ID_PREFIXES.has(prefix);
}

export function parseAnimeExternalId(type, externalId) {
  const raw = String(externalId || "").trim();
  if (!raw) {
    return null;
  }

  if (raw.startsWith("tt")) {
    const [baseId, seasonValue, episodeValue] = raw.split(":");
    return {
      kind: "imdb",
      baseId,
      season: type === "series" ? Number.parseInt(seasonValue || "0", 10) || 1 : null,
      episode: type === "series" ? Number.parseInt(episodeValue || "0", 10) || null : null
    };
  }

  if (raw.startsWith("tmdb:")) {
    const [, baseId, seasonValue, episodeValue] = raw.split(":");
    return {
      kind: "tmdb",
      baseId: String(baseId || ""),
      season: type === "series" ? Number.parseInt(seasonValue || "0", 10) || 1 : null,
      episode: type === "series" ? Number.parseInt(episodeValue || "0", 10) || null : null
    };
  }

  const [prefix, baseId, episodeValue] = raw.split(":");
  if (!SUPPORTED_ANIME_ID_PREFIXES.has(String(prefix || "").toLowerCase())) {
    return null;
  }

  return {
    kind: String(prefix || "").toLowerCase(),
    baseId: String(baseId || ""),
    season: type === "series" ? 1 : null,
    episode: type === "series" ? Number.parseInt(episodeValue || "0", 10) || null : null
  };
}

export async function resolveAnimeImdbId(externalId) {
  const raw = String(externalId || "").trim();
  if (raw.startsWith("tt")) {
    return raw.split(":")[0];
  }

  const parsed = parseAnimeExternalId("series", raw) || parseAnimeExternalId("movie", raw);
  if (!parsed) {
    return null;
  }

  if (parsed.kind === "tmdb") {
    return null;
  }

  const source = parsed.kind === "mal" ? "myanimelist" : parsed.kind;
  const payload = await fetchJson(
    `${RELATIONS_BASE_URL}/ids?source=${encodeURIComponent(source)}&id=${encodeURIComponent(parsed.baseId)}&include=imdb`
  ).catch(() => null);

  const imdbId = String(payload?.imdb || "").trim();
  return imdbId || null;
}
