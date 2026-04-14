import crypto from "node:crypto";
import { buildStremioId } from "../../../lib/ids.js";
import { buildStream, resolveExtractorStream } from "../../../lib/extractors.js";
import { fetchJson, fetchText } from "../../../lib/webstreamer/http.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

const TMDB_API_KEY = process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const DECRYPT_KEY = "Ak7qrvvH4WKYxV2OgaeHAEg2a5eh16vE";

// Language code mapping (TMDB -> human readable)
const LANGUAGE_MAP = {
  "es": "LAT", "es-MX": "LAT", "es-ES": "CAST", "en": "SUB", "en-US": "SUB",
  "fr": "SUB", "de": "SUB", "it": "SUB", "pt": "SUB", "pt-BR": "SUB",
  "ja": "SUB", "ko": "SUB", "zh": "SUB", "ru": "SUB", "ar": "SUB",
  "hi": "SUB", "tr": "SUB", "pl": "SUB", "nl": "SUB", "sv": "SUB"
};

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

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * AES-CBC decrypt (matches the Kotlin implementation)
 */
function decryptLink(encryptedB64) {
  try {
    const encryptedData = Buffer.from(encryptedB64, "base64");
    const iv = encryptedData.subarray(0, 16);
    const ciphertext = encryptedData.subarray(16);
    const keyBytes = Buffer.from(DECRYPT_KEY, "utf8");
    const decipher = crypto.createDecipheriv("aes-256-cbc", keyBytes, iv);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}

export class PelisplushdProvider extends WebstreamBaseProvider {
  constructor() {
    super({
      id: "pelisplushd",
      name: "Pelisplushd",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.PELISPLUSHDBASE_URL || "https://embed69.org";
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
        description: cleanText(data.overview || ""),
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

    // Get TMDB ID from IMDB ID via TMDB find API
    const findUrl = `${TMDB_BASE}/find/${baseId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    let tmdbId;
    try {
      const findData = await fetchJson(findUrl);
      const results = type === "series" ? findData.tv_results : findData.movie_results;
      tmdbId = results?.[0]?.id;
    } catch {
      return [];
    }

    if (!tmdbId) return [];

    // Build iframe URL
    let iframeUrl;
    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const ep = String(parsedExternal.episode).padStart(2, "0");
      iframeUrl = `${this.baseUrl}/f/${baseId}-${parsedExternal.season}x${ep}`;
    } else {
      iframeUrl = `${this.baseUrl}/f/${baseId}`;
    }

    // Fetch the iframe page and extract dataLink JSON
    const pageHtml = await fetchText(iframeUrl).catch(() => "");
    if (!pageHtml) return [];

    const dataLinkMatch = pageHtml.match(/dataLink\s*=\s*(\[.+?\]);?\s*(?:<|<\/)/s)
      || pageHtml.match(/dataLink\s*=\s*(\[.+?\])/s);

    if (!dataLinkMatch) return [];

    let languageLinks;
    try {
      languageLinks = JSON.parse(dataLinkMatch[1]);
    } catch {
      return [];
    }

    if (!Array.isArray(languageLinks)) return [];

    // Decrypt links for each language
    const allStreams = [];

    for (const langObj of languageLinks) {
      const language = langObj.video_language || "Unknown";
      const sortedEmbeds = langObj.sortedEmbeds || [];
      const linkUrls = sortedEmbeds.map(e => e.link).filter(Boolean);

      if (linkUrls.length === 0) continue;

      // Try to decrypt links via API
      let decryptedLinks = [];
      try {
        const decryptBody = JSON.stringify({ links: linkUrls });
        const decryptRes = await fetch(`${this.baseUrl}/api/decrypt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: decryptBody
        });
        const decryptData = await decryptRes.json();
        if (decryptData.success && Array.isArray(decryptData.links)) {
          decryptedLinks = decryptData.links.map(l => l.link).filter(Boolean);
        }
      } catch {
        // Fallback: try to decrypt locally
        decryptedLinks = linkUrls.map(link => {
          const decrypted = decryptLink(link);
          return decrypted || link;
        });
      }

      // Resolve each decrypted link through our extractors
      for (const link of decryptedLinks) {
        const streams = await resolveExtractorStream(link, `${language} ${type === "series" ? "S' + parsedExternal.season + 'E' + parsedExternal.episode : ""}`, true).catch(() => []);
        for (const stream of streams) {
          allStreams.push({
            ...stream,
            title: `${language}\n${stream.title || ""}`
          });
        }
      }
    }

    return allStreams;
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

    // Build iframe URL
    let iframeUrl;
    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const ep = String(parsedExternal.episode).padStart(2, "0");
      iframeUrl = `${this.baseUrl}/f/${baseId}-${parsedExternal.season}x${ep}`;
    } else {
      iframeUrl = `${this.baseUrl}/f/${baseId}`;
    }
    debug.iframeUrl = iframeUrl;

    // Fetch page
    const pageHtml = await fetchText(iframeUrl).catch(() => "");
    if (!pageHtml) {
      debug.status = "page_not_found";
      return debug;
    }

    // Extract dataLink
    const dataLinkMatch = pageHtml.match(/dataLink\s*=\s*(\[.+?\]);?\s*(?:<|<\/)/s)
      || pageHtml.match(/dataLink\s*=\s*(\[.+?\])/s);

    if (!dataLinkMatch) {
      debug.status = "no_dataLink";
      return debug;
    }

    let languageLinks;
    try {
      languageLinks = JSON.parse(dataLinkMatch[1]);
    } catch {
      debug.status = "invalid_dataLink";
      return debug;
    }

    debug.languageCount = languageLinks.length;
    debug.languageSample = languageLinks.slice(0, 3).map(l => ({
      language: l.video_language,
      embedCount: l.sortedEmbeds?.length || 0
    }));

    // Try to get streams
    const streams = await this.getStreamsFromExternalId({ type, externalId });
    debug.streamCount = streams.length;
    debug.streams = streams.slice(0, 5);
    debug.status = streams.length > 0 ? "ok" : "no_streams";

    return debug;
  }
}
