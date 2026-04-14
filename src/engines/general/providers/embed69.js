import { parseStremioId } from "../../../lib/ids.js";
import { buildStream } from "../../../lib/extractors.js";
import { fetchJson, fetchText } from "../../../lib/webstreamer/http.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

const TMDB_API_KEY = process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const BASE_URL = process.env.EMBED69_BASE_URL || "https://embed69.org";

// Resolvers for known hosts
const RESOLVER_MAP = {
  "hglink.to": "streamwish",
  "streamwish.com": "streamwish",
  "streamwish.to": "streamwish",
  "wishembed.online": "streamwish",
  "filelions.com": "streamwish"
};

const LANG_PRIORITY = ["LAT", "ESP", "SUB"];

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Base64 decode (handles URL-safe base64)
 */
function b64decode(value) {
  if (!value) return "";
  let input = String(value).replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(input, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Decode JWT payload to extract the actual player URL
 */
function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    payload += "=".repeat((4 - payload.length % 4) % 4);
    return JSON.parse(b64decode(payload));
  } catch {
    return null;
  }
}

/**
 * Parse dataLink JSON from the HTML page
 */
function parseDataLink(html) {
  try {
    const match = html.match(/let\s+dataLink\s*=\s*(\[.+\]);/s)
      || html.match(/dataLink\s*=\s*(\[.+\]);?\s*<\//s);
    if (!match) return null;
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Get IMDB ID from TMDB ID via TMDB external_ids API
 */
async function getImdbId(tmdbId, mediaType) {
  const endpoint = mediaType === "movie"
    ? `${TMDB_BASE}/movie/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`
    : `${TMDB_BASE}/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;

  try {
    const data = await fetchJson(endpoint);
    return data.imdb_id || null;
  } catch {
    return null;
  }
}

/**
 * Build embed URL for a given IMDB ID
 */
function buildEmbedUrl(imdbId, mediaType, season, episode) {
  if (mediaType === "movie") {
    return `${BASE_URL}/f/${imdbId}`;
  }
  const e = String(episode).padStart(2, "0");
  return `${BASE_URL}/f/${imdbId}-${parseInt(season)}x${e}`;
}

/**
 * Get resolver name for a URL
 */
function getResolverName(url) {
  if (!url) return null;
  for (const [pattern, name] of Object.entries(RESOLVER_MAP)) {
    if (url.includes(pattern)) return name;
  }
  return null;
}

export class Embed69Provider extends WebstreamBaseProvider {
  constructor() {
    super({
      id: "embed69",
      name: "Embed69",
      supportedTypes: ["movie", "series"]
    });
  }

  /**
   * Search via TMDB API
   */
  async search({ type, query }) {
    if (!query?.trim()) return [];

    const mediaType = type === "series" ? "tv" : "movie";
    const url = `${TMDB_BASE}/search/${mediaType}?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query.trim())}&page=1`;

    try {
      const data = await fetchJson(url);
      return (data.results || []).map(item => ({
        id: buildStremioId(this.id, type, String(item.id)),
        type,
        name: item.title || item.name || "",
        releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4)
      })).filter(item => item.name);
    } catch {
      return [];
    }
  }

  /**
   * Get metadata via TMDB API
   */
  async getMeta({ type, slug }) {
    const tmdbId = slug;
    const mediaType = type === "series" ? "tv" : "movie";
    const url = `${TMDB_BASE}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,videos,external_ids`;

    try {
      const data = await fetchJson(url);
      return {
        id: buildStremioId(this.id, type, tmdbId),
        type,
        name: data.title || data.name || "",
        poster: data.poster_path ? `https://image.tmdb.org/t/p/original${data.poster_path}` : null,
        background: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
        description: String(data.overview || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
        releaseInfo: (data.release_date || data.first_air_date || "").substring(0, 4),
        genres: (data.genres || []).map(g => g.name),
        cast: (data.credits?.cast || []).slice(0, 10).map(c => c.name),
        imdbId: data.external_ids?.imdb_id
      };
    } catch {
      return null;
    }
  }

  /**
   * Main entry point: resolve streams from external ID
   */
  async getStreamsFromExternalId({ type, externalId }) {
    if (!externalId?.startsWith("tt")) return [];

    const parsedExternal = this.parseExternalStremioId(type, externalId);
    const baseId = parsedExternal.baseId;

    // Get TMDB ID from IMDB ID
    const mediaType = type === "series" ? "tv" : "movie";
    const findUrl = `${TMDB_BASE}/find/${baseId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    let tmdbId;
    try {
      const findData = await fetchJson(findUrl);
      const results = mediaType === "tv" ? findData.tv_results : findData.movie_results;
      tmdbId = results?.[0]?.id;
    } catch {
      return [];
    }

    if (!tmdbId) return [];

    // Get IMDB ID (for embed URL)
    const imdbId = await getImdbId(tmdbId, mediaType);
    if (!imdbId) return [];

    // Build embed URL
    const embedUrl = buildEmbedUrl(imdbId, mediaType, parsedExternal.season, parsedExternal.episode);

    // Fetch the embed page
    const pageHtml = await fetchText(embedUrl, {
      headers: {
        Referer: "https://sololatino.net/",
        Accept: "text/html,application/xhtml+xml"
      }
    }).catch(() => "");

    if (!pageHtml) return [];

    // Parse dataLink
    const dataLink = parseDataLink(pageHtml);
    if (!dataLink || !Array.isArray(dataLink) || dataLink.length === 0) return [];

    // Group by language
    const byLang = {};
    for (const section of dataLink) {
      byLang[section.video_language] = section;
    }

    // Resolve embeds for each language (in priority order)
    const allStreams = [];

    for (const lang of LANG_PRIORITY) {
      const section = byLang[lang];
      if (!section) continue;

      const embeds = [];
      for (const embed of section.sortedEmbeds || []) {
        if (embed.servername === "download") continue;

        // Decode JWT token to get actual player URL
        const payload = decodeJwtPayload(embed.link);
        if (!payload?.link) continue;

        const resolverName = getResolverName(payload.link);
        if (!resolverName) continue;

        embeds.push({
          url: payload.link,
          resolver: resolverName,
          lang,
          servername: embed.servername
        });
      }

      if (embeds.length === 0) continue;

      // Resolve all embeds through our extractor system
      for (const embed of embeds) {
        const streams = await this.resolveExtractorStream(embed.url, embed.lang).catch(() => []);
        for (const stream of streams) {
          const langLabel = embed.lang === "LAT" ? "Latino" : embed.lang === "ESP" ? "Español" : "Subtitulado";
          allStreams.push({
            ...stream,
            title: `${langLabel}\n${stream.title || ""}`
          });
        }
      }

      // If we found streams in a priority language, stop (prefer LAT over others)
      if (allStreams.length > 0) break;
    }

    return allStreams;
  }

  /**
   * Resolve a player URL through our extractor system
   */
  async resolveExtractorStream(url, lang) {
    const { resolveExtractorStream } = await import("../../../lib/extractors/registry.js");
    return resolveExtractorStream(url, lang, true);
  }

  /**
   * Debug endpoint
   */
  async debugStreamsFromExternalId({ type, externalId }) {
    const debug = {
      provider: this.id,
      type,
      externalId,
      supported: externalId?.startsWith("tt") || false
    };

    if (!debug.supported) return debug;

    const parsedExternal = this.parseExternalStremioId(type, externalId);
    debug.parsedExternal = parsedExternal;

    const baseId = parsedExternal.baseId;
    const mediaType = type === "series" ? "tv" : "movie";

    // Get TMDB info
    try {
      const findUrl = `${TMDB_BASE}/find/${baseId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
      const findData = await fetchJson(findUrl);
      const results = mediaType === "tv" ? findData.tv_results : findData.movie_results;
      debug.tmdbInfo = results?.[0] || null;
    } catch {
      debug.tmdbInfo = null;
    }

    const tmdbId = debug.tmdbInfo?.id;
    if (!tmdbId) {
      debug.status = "no_tmdb_match";
      return debug;
    }

    // Get IMDB ID
    const imdbId = await getImdbId(tmdbId, mediaType);
    debug.imdbId = imdbId;

    if (!imdbId) {
      debug.status = "no_imdb_id";
      return debug;
    }

    // Build embed URL
    const embedUrl = buildEmbedUrl(imdbId, mediaType, parsedExternal.season, parsedExternal.episode);
    debug.embedUrl = embedUrl;

    // Fetch page
    const pageHtml = await fetchText(embedUrl, {
      headers: { Referer: "https://sololatino.net/" }
    }).catch(() => "");

    if (!pageHtml) {
      debug.status = "page_not_found";
      return debug;
    }

    // Parse dataLink
    const dataLink = parseDataLink(pageHtml);
    if (!dataLink || !Array.isArray(dataLink)) {
      debug.status = "no_dataLink";
      return debug;
    }

    debug.languageCount = dataLink.length;
    debug.languageSample = dataLink.slice(0, 3).map(d => ({
      language: d.video_language,
      embedCount: d.sortedEmbeds?.length || 0
    }));

    // Try to get streams
    const streams = await this.getStreamsFromExternalId({ type, externalId });
    debug.streamCount = streams.length;
    debug.streams = streams.slice(0, 5);
    debug.status = streams.length > 0 ? "ok" : "no_streams";

    return debug;
  }
}
