import { fetchJson } from "./webstreamer/http.js";
import { tmdbCache } from "../shared/cache.js";

const DEFAULT_TMDB_API_KEY = (function() {
  const key = String(process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c").trim();
  return key;
})();

export async function fetchTmdbMediaFromImdb(type, imdbId, apiKey = DEFAULT_TMDB_API_KEY) {
  if (!imdbId || !String(imdbId).startsWith("tt")) {
    return null;
  }

  const mediaType = type === "series" ? "tv" : "movie";
  const findCacheKey = `tmdb:find:${imdbId}`;
  const findPayload = await tmdbCache.getOrSet(findCacheKey, async () => {
    return fetchJson(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=${apiKey}&external_source=imdb_id&language=es-ES`
    ).catch(() => null);
  });

  if (!findPayload) {
    return null;
  }

  const results = mediaType === "tv" ? findPayload.tv_results : findPayload.movie_results;
  const item = Array.isArray(results) ? results[0] : null;
  if (!item?.id) {
    return null;
  }

  const values = [
    item.title,
    item.name,
    item.original_title,
    item.original_name
  ];

  let localizedTitle = item.title || item.name || "";
  let originalTitle = item.original_title || item.original_name || localizedTitle;
  let releaseDate = item.release_date || item.first_air_date || "";

  // Fetch all 3 languages in parallel instead of sequentially.
  const languages = ["es-MX", "es-ES", "en-US"];
  const detailsResults = await Promise.all(
    languages.map((language) => {
      const detailCacheKey = `tmdb:details:${mediaType}:${item.id}:${language}`;
      return tmdbCache.getOrSet(detailCacheKey, async () => {
        return fetchJson(
          `https://api.themoviedb.org/3/${mediaType}/${item.id}?api_key=${apiKey}&language=${language}`
        ).catch(() => null);
      });
    })
  );

  for (const details of detailsResults) {
    if (!details) {
      continue;
    }

    values.push(
      details.title,
      details.name,
      details.original_title,
      details.original_name
    );

    if (!localizedTitle) {
      localizedTitle = details.title || details.name || localizedTitle;
    }

    if (!originalTitle) {
      originalTitle = details.original_title || details.original_name || originalTitle;
    }

    if (!releaseDate) {
      releaseDate = details.release_date || details.first_air_date || releaseDate;
    }
  }

  const titles = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  const year = String(releaseDate || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";

  return {
    tmdbId: Number(item.id),
    mediaType,
    title: localizedTitle || originalTitle || titles[0] || "",
    originalTitle: originalTitle || localizedTitle || titles[0] || "",
    year,
    titles
  };
}

export async function fetchTmdbEpisodeName(tmdbId, season, episode, apiKey = DEFAULT_TMDB_API_KEY) {
  if (!tmdbId || !season || !episode) {
    return null;
  }

  const cacheKey = `tmdb:episode:${tmdbId}:${season}:${episode}`;
  const languages = ["es-MX", "es-ES", "en-US"];

  for (const language of languages) {
    const data = await tmdbCache.getOrSet(`${cacheKey}:${language}`, async () => {
      return fetchJson(
        `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${apiKey}&language=${language}`
      ).catch(() => null);
    });

    if (data?.name && !/^episodio\s+\d+$/i.test(data.name) && !/^episode\s+\d+$/i.test(data.name)) {
      return data.name;
    }
  }

  return null;
}

export function normalizeMediaTitle(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function basicTitleSimilarity(left, right) {
  const a = normalizeMediaTitle(left);
  const b = normalizeMediaTitle(right);

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (a.includes(b) || b.includes(a)) {
    return 0.9;
  }

  const aWords = a.split(/\s+/).filter(Boolean);
  const bWords = b.split(/\s+/).filter(Boolean);
  const overlap = bWords.filter((word) => aWords.includes(word)).length;

  if (!overlap) {
    return 0;
  }

  return overlap / Math.max(aWords.length, bWords.length);
}
