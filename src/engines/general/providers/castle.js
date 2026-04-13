import { buildStream } from "../../../lib/extractors.js";
import { scoreAndSelectStreams } from "../scoring.js";
import { fetchJson as sharedFetchJson, fetchWithRetry as sharedFetchWithRetry } from "../../../shared/fetch.js";
import { fetchTmdbMediaFromImdb, basicTitleSimilarity } from "../../../lib/tmdb.js";
import { parseExternalStremioId } from "../../../lib/webstreamer/common.js";
import { Provider } from "./base.js";

const TMDB_API_KEY = process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c";
const CASTLE_BASE = process.env.CASTLE_BASE_URL || "https://api.fstcy.com";
const CASTLE_DECRYPT_URL = process.env.CASTLE_DECRYPT_URL || "https://aesdec.nuvioapp.space/decrypt-castle";
const PKG = "com.external.castle";
const CHANNEL = "IndiaA";
const CLIENT = "1";
const LANG = "en-US";
const API_HEADERS = {
  "User-Agent": "okhttp/4.9.3",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "Keep-Alive",
  Referer: CASTLE_BASE
};
const PLAYBACK_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  Accept: "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "identity",
  Connection: "keep-alive",
  "Sec-Fetch-Dest": "video",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "cross-site",
  DNT: "1"
};

function extractDataBlock(obj) {
  if (obj && obj.data && typeof obj.data === "object") return obj.data;
  return obj || {};
}

function normalizeQuality(resolution) {
  return ({ 1: "480p", 2: "720p", 3: "1080p" }[resolution]) || `${resolution}p`;
}

function isSpanishLanguage(track) {
  const text = `${track?.languageName || ""} ${track?.abbreviate || ""}`.toLowerCase();
  return /spanish|espa(?:n|ñ)ol|castellano|latino|\bes\b|\bspa\b|\blat\b/.test(text);
}

function toLanguageTag(track) {
  const text = `${track?.languageName || ""} ${track?.abbreviate || ""}`.toLowerCase();
  if (/latino|\blat\b/.test(text)) return "[LAT]";
  if (/spanish|espa(?:n|ñ)ol|castellano|\bes\b|\bspa\b/.test(text)) return "[CAST]";
  return "[MULTI]";
}

export class CastleProvider extends Provider {
  constructor() {
    super({
      id: "castle",
      name: "Castle",
      supportedTypes: ["movie", "series"]
    });
  }

  async getStreamsFromExternalId({ type, externalId }) {
    const debug = await this.collectDebug({ type, externalId, includeStreams: true });
    return debug.streams || [];
  }

  async debugStreamsFromExternalId({ type, externalId }) {
    return this.collectDebug({ type, externalId, includeStreams: true });
  }

  async collectDebug({ type, externalId, includeStreams }) {
    const debug = {
      provider: this.id,
      type,
      externalId,
      supported: externalId?.startsWith("tt") || false
    };
    if (!debug.supported) return debug;

    const parsedExternal = parseExternalStremioId(type, externalId);
    debug.parsedExternal = parsedExternal;

    const tmdbInfo = await fetchTmdbMediaFromImdb(type, parsedExternal.baseId, TMDB_API_KEY).catch(() => null);
    debug.tmdbInfo = tmdbInfo ? {
      tmdbId: tmdbInfo.tmdbId,
      title: tmdbInfo.title,
      originalTitle: tmdbInfo.originalTitle,
      year: tmdbInfo.year,
      titles: tmdbInfo.titles
    } : null;
    if (!tmdbInfo?.tmdbId) {
      debug.status = "missing_tmdb_info";
      return debug;
    }

    const securityKey = await this.getSecurityKey().catch(() => null);
    if (!securityKey) {
      debug.status = "missing_security_key";
      return debug;
    }

    const movieId = await this.findCastleMovieId(securityKey, tmdbInfo).catch(() => null);
    debug.bestMatch = movieId ? { movieId } : null;
    if (!movieId) {
      debug.status = "no_best_match";
      return debug;
    }

    let details = await this.getDetails(securityKey, movieId).catch(() => null);
    let currentMovieId = movieId;
    if (!details) {
      debug.status = "missing_details";
      return debug;
    }

    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const data = extractDataBlock(details);
      const season = Array.isArray(data.seasons) ? data.seasons.find((item) => Number(item.number) === Number(parsedExternal.season)) : null;
      if (season?.movieId && String(season.movieId) !== String(movieId)) {
        details = await this.getDetails(securityKey, String(season.movieId)).catch(() => details);
        currentMovieId = String(season.movieId);
      }
    }

    const detailsData = extractDataBlock(details);
    const episodes = Array.isArray(detailsData.episodes) ? detailsData.episodes : [];
    let episodeId = null;

    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const episode = episodes.find((item) => Number(item.number) === Number(parsedExternal.episode));
      if (!episode?.id) {
        debug.status = "no_matching_episode";
        return debug;
      }
      episodeId = String(episode.id);
      debug.matchingEpisode = {
        id: episodeId,
        title: episode.title || "",
        season: parsedExternal.season,
        episode: parsedExternal.episode
      };
    } else if (episodes[0]?.id) {
      episodeId = String(episodes[0].id);
    }

    if (!episodeId) {
      debug.status = "missing_episode_id";
      return debug;
    }

    const episode = episodes.find((item) => String(item.id) === String(episodeId)) || null;
    const tracks = Array.isArray(episode?.tracks) ? episode.tracks : [];
    const preferredTracks = tracks.filter(isSpanishLanguage);
    const trackSet = preferredTracks.length > 0 ? preferredTracks : tracks;

    debug.playerCount = trackSet.length;
    debug.players = trackSet.map((track) => ({
      language: track.languageName || track.abbreviate || "",
      languageId: track.languageId || null
    }));

    const resolution = 2;
    const streams = [];

    if (trackSet.length > 0) {
      for (const track of trackSet) {
        if (!track.existIndividualVideo || !track.languageId) continue;
        const videoData = await this.getVideoV1(securityKey, currentMovieId, episodeId, track.languageId, resolution).catch(() => null);
        if (!videoData) continue;
        streams.push(...this.processVideoResponse(videoData, tmdbInfo, parsedExternal, resolution, toLanguageTag(track)));
      }
    }

    if (streams.length === 0) {
      const videoData = await this.getVideo2(securityKey, currentMovieId, episodeId, resolution).catch(() => null);
      if (videoData) streams.push(...this.processVideoResponse(videoData, tmdbInfo, parsedExternal, resolution, "[MULTI]"));
    }

    const selectedStreams = scoreAndSelectStreams(this.id, streams);
    debug.streamCount = selectedStreams.length;
    debug.streams = includeStreams ? selectedStreams : [];
    debug.status = selectedStreams.length > 0 ? "ok" : "no_streams";
    return debug;
  }

  processVideoResponse(videoData, tmdbInfo, parsedExternal, resolution, languageTag) {
    const streams = [];
    const data = extractDataBlock(videoData);
    const videoUrl = data.videoUrl;
    if (!videoUrl) return streams;
    const displayTitle = parsedExternal.season && parsedExternal.episode
      ? `${tmdbInfo.title} S${String(parsedExternal.season).padStart(2, "0")}E${String(parsedExternal.episode).padStart(2, "0")}`
      : `${tmdbInfo.title}${tmdbInfo.year ? ` (${tmdbInfo.year})` : ""}`;

    const add = (url, quality) => {
      streams.push({
        ...buildStream("Castle", `${languageTag} ${quality} castle`, url, PLAYBACK_HEADERS, true),
        _displayTitle: displayTitle,
        _providerId: this.id,
        description: parsedExternal.season && parsedExternal.episode
          ? `${tmdbInfo.title} S${String(parsedExternal.season).padStart(2, "0")}E${String(parsedExternal.episode).padStart(2, "0")}`
          : `${tmdbInfo.title}${tmdbInfo.year ? ` (${tmdbInfo.year})` : ""}`
      });
    };

    if (Array.isArray(data.videos) && data.videos.length > 0) {
      for (const video of data.videos) {
        add(video.url || videoUrl, String(video.resolutionDescription || video.resolution || normalizeQuality(resolution)).replace(/^(SD|HD|FHD)\s+/i, ""));
      }
    } else {
      add(videoUrl, normalizeQuality(resolution));
    }

    return streams;
  }

  async request(url, options = {}) {
    const response = await sharedFetchWithRetry(url, {
      method: options.method || "GET",
      headers: { ...API_HEADERS, ...(options.headers || {}) },
      body: options.body
    });
    return response;
  }

  async extractCipherFromResponse(response) {
    const text = (await response.text()).trim();
    if (!text) throw new Error("Empty response");
    try {
      const json = JSON.parse(text);
      if (json?.data && typeof json.data === "string") return json.data.trim();
    } catch {}
    return text;
  }

  async decryptCastle(encryptedB64, securityKeyB64) {
    try {
      const payload = await sharedFetchJson(CASTLE_DECRYPT_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ encryptedData: encryptedB64, securityKey: securityKeyB64 })
      });
      if (payload.error) throw new Error(payload.error);
      return payload.decrypted;
    } catch (err) {
      console.error(`[castle] Decryption service failed: ${err.message}`);
      return null;
    }
  }

  async getSecurityKey() {
    const response = await this.request(`${CASTLE_BASE}/v0.1/system/getSecurityKey/1?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}`);
    const data = await response.json();
    return data.code === 200 ? data.data : null;
  }

  async searchCastle(securityKey, keyword) {
    const params = new URLSearchParams({
      channel: CHANNEL,
      clientType: CLIENT,
      keyword,
      lang: LANG,
      mode: "1",
      packageName: PKG,
      page: "1",
      size: "30"
    });
    const response = await this.request(`${CASTLE_BASE}/film-api/v1.1.0/movie/searchByKeyword?${params.toString()}`);
    const cipher = await this.extractCipherFromResponse(response);
    return JSON.parse(await this.decryptCastle(cipher, securityKey));
  }

  async getDetails(securityKey, movieId) {
    const response = await this.request(`${CASTLE_BASE}/film-api/v1.1/movie?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}&movieId=${movieId}&packageName=${PKG}`);
    const cipher = await this.extractCipherFromResponse(response);
    return JSON.parse(await this.decryptCastle(cipher, securityKey));
  }

  async getVideo2(securityKey, movieId, episodeId, resolution = 2) {
    const response = await this.request(`${CASTLE_BASE}/film-api/v2.0.1/movie/getVideo2?clientType=${CLIENT}&packageName=${PKG}&channel=${CHANNEL}&lang=${LANG}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "1",
        appMarket: "GuanWang",
        clientType: "1",
        woolUser: "false",
        apkSignKey: "ED0955EB04E67A1D9F3305B95454FED485261475",
        androidVersion: "13",
        movieId,
        episodeId,
        isNewUser: "true",
        resolution: String(resolution),
        packageName: PKG
      })
    });
    const cipher = await this.extractCipherFromResponse(response);
    return JSON.parse(await this.decryptCastle(cipher, securityKey));
  }

  async getVideoV1(securityKey, movieId, episodeId, languageId, resolution = 2) {
    const params = new URLSearchParams({
      apkSignKey: "ED0955EB04E67A1D9F3305B95454FED485261475",
      channel: CHANNEL,
      clientType: CLIENT,
      episodeId: String(episodeId),
      lang: LANG,
      languageId: String(languageId),
      mode: "1",
      movieId: String(movieId),
      packageName: PKG,
      resolution: String(resolution)
    });
    const response = await this.request(`${CASTLE_BASE}/film-api/v1.9.1/movie/getVideo?${params.toString()}`);
    const cipher = await this.extractCipherFromResponse(response);
    return JSON.parse(await this.decryptCastle(cipher, securityKey));
  }

  async findCastleMovieId(securityKey, tmdbInfo) {
    const queries = [...new Set([
      tmdbInfo.year ? `${tmdbInfo.title} ${tmdbInfo.year}` : tmdbInfo.title,
      tmdbInfo.title,
      tmdbInfo.originalTitle,
      ...tmdbInfo.titles
    ].filter(Boolean))];

    const ranked = [];
    for (const query of queries.slice(0, 5)) {
      const result = await this.searchCastle(securityKey, query).catch(() => null);
      const rows = Array.isArray(extractDataBlock(result).rows) ? extractDataBlock(result).rows : [];
      for (const item of rows) {
        const title = item.title || item.name || "";
        const similarity = Math.max(...tmdbInfo.titles.map((candidate) => basicTitleSimilarity(title, candidate)));
        if (similarity >= 0.55) {
          ranked.push({
            id: String(item.id || item.redirectId || item.redirectIdStr || ""),
            similarity
          });
        }
      }
    }
    ranked.sort((a, b) => b.similarity - a.similarity);
    return ranked[0]?.id || null;
  }
}

