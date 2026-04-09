import axios from "axios";
import { buildStream } from "../../../lib/extractors.js";
import { scoreAndSelectStreams } from "../scoring.js";
import { fetchTmdbMediaFromImdb, basicTitleSimilarity, normalizeMediaTitle } from "../../../lib/tmdb.js";
import { parseExternalStremioId } from "../../../lib/webstreamer/common.js";
import { Provider } from "./base.js";

const TMDB_API_KEY = process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c";
const NETMIRROR_BASE = process.env.NETMIRROR_BASE_URL || "https://net22.cc";
const NETMIRROR_PLAY = process.env.NETMIRROR_PLAY_URL || "https://net52.cc";
const OTT_MAP = { netflix: "nf", primevideo: "pv", disney: "hs" };
const BASE_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.5",
  Connection: "keep-alive"
};

let cachedCookie = "";
let cachedCookieAt = 0;
const COOKIE_EXPIRY_MS = 54_000_000;

function getUnixTime() {
  return Math.floor(Date.now() / 1000);
}

function normalizeQuality(value, fallback = "HD") {
  const text = String(value || "");
  const match = text.match(/(\d{3,4})p/i);
  if (match) return `${match[1]}p`;
  const lower = text.toLowerCase();
  if (lower.includes("full hd")) return "1080p";
  if (lower.includes("hd")) return "720p";
  if (lower.includes("4k")) return "2160p";
  return fallback;
}

function extractYear(value) {
  return String(value || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
}

function calculateSimilarity(candidateTitle, queryTitle) {
  const candidate = normalizeMediaTitle(candidateTitle);
  const query = normalizeMediaTitle(queryTitle);

  if (!candidate || !query) {
    return 0;
  }

  if (candidate === query) {
    return 1;
  }

  const candidateWords = candidate.split(/\s+/).filter(Boolean);
  const queryWords = query.split(/\s+/).filter(Boolean);

  if (queryWords.length <= candidateWords.length) {
    const exactMatches = queryWords.filter((word) => candidateWords.includes(word)).length;
    if (exactMatches === queryWords.length) {
      return 0.95 * (exactMatches / candidateWords.length);
    }
  }

  if (candidate.startsWith(query) || query.startsWith(candidate)) {
    return 0.9;
  }

  return basicTitleSimilarity(candidateTitle, queryTitle);
}

function buildCookieString(cookie, ott) {
  return [`t_hash_t=${cookie}`, `ott=${ott}`, "hd=on", "user_token=233123f803cf02184bf6c67e149cdd50"].join("; ");
}

function normalizeLanguageLabel(value) {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();

  if (!text) return "";
  if (/\b(latino|latam|es-la|spa-la)\b/i.test(lower)) return "Latino";
  if (/\b(castellano|espanol|español|es-es|spa-es)\b/i.test(lower)) return "Castellano";
  if (/\bspanish\b/i.test(lower)) return "Spanish";
  if (/\benglish|ingl[eé]s|en-us|en-gb\b/i.test(lower)) return "English";
  return text;
}

function inferTrackTag(tracks) {
  const labels = tracks.map((track) => normalizeLanguageLabel(track.label || track.language || ""));
  const joined = labels.join(" ").toLowerCase();

  if (/\blatino\b/.test(joined)) return "LAT";
  if (/\bcastellano\b/.test(joined)) return "CAST";
  if (/\bspanish\b|\bespanol\b|\bespañol\b/.test(joined)) return "CAST";
  return "MULTI";
}

export class NetMirrorProvider extends Provider {
  constructor() {
    super({
      id: "netmirror",
      name: "NetMirror",
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

    const queryTitles = [...new Set([
      tmdbInfo.title,
      tmdbInfo.originalTitle,
      ...tmdbInfo.titles
    ].map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 8);
    const platforms = ["netflix", "primevideo", "disney"];
    const searchAttempts = [];
    let selected = null;

    for (const platform of platforms) {
      for (const title of queryTitles) {
        const queries = tmdbInfo.year ? [title, `${title} ${tmdbInfo.year}`] : [title];

        for (const query of queries) {
          const results = await this.searchContent(query, platform).catch(() => []);
          const candidate = this.pickSearchResult(results, tmdbInfo, title);
          searchAttempts.push({
            platform,
            query,
            count: results.length,
            topTitle: results[0]?.title || null,
            matchedTitle: candidate?.title || null,
            similarity: candidate?.similarity || 0
          });

          if (candidate) {
            selected = { platform, ...candidate };
            break;
          }
        }

        if (selected) {
          break;
        }
      }
      if (selected) break;
    }

    debug.searchAttempts = searchAttempts;
    debug.bestMatch = selected ? { platform: selected.platform, id: selected.id, title: selected.title } : null;

    if (!selected) {
      debug.status = "no_best_match";
      return debug;
    }

    const contentData = await this.loadContent(selected.id, selected.platform).catch(() => null);
    if (!contentData) {
      debug.status = "missing_content";
      return debug;
    }

    let targetContentId = String(selected.id);
    let episodeData = null;
    const availableEpisodes = Array.isArray(contentData.episodes) ? contentData.episodes.filter(Boolean) : [];
    const looksEpisodeBased = availableEpisodes.length > 0;

    if (type === "series" && parsedExternal.season && parsedExternal.episode && looksEpisodeBased) {
      episodeData = this.findEpisode(contentData.episodes || [], parsedExternal.season, parsedExternal.episode);
      debug.matchingEpisode = episodeData ? {
        id: episodeData.id,
        title: episodeData.t || "",
        season: parsedExternal.season,
        episode: parsedExternal.episode
      } : null;

      if (!episodeData?.id) {
        debug.status = "no_matching_episode";
        return debug;
      }

      targetContentId = String(episodeData.id);
    }

    const streamData = await this.getStreamingLinks(targetContentId, tmdbInfo.title, selected.platform).catch(() => null);
    const sources = Array.isArray(streamData?.sources) ? streamData.sources : [];
    const subtitles = Array.isArray(streamData?.subtitles) ? streamData.subtitles : [];
    const trackSummary = Array.isArray(streamData?.trackSummary) ? streamData.trackSummary : [];

    debug.playerCount = sources.length;
    debug.players = sources.map((source) => ({
      quality: normalizeQuality(source.quality || source.label || source.url, "HD"),
      pageUrl: source.url,
      platform: selected.platform
    }));
    debug.subtitleCount = subtitles.length;
    debug.subtitleLanguages = [...new Set(subtitles.map((item) => item.lang).filter(Boolean))];
    debug.trackSummary = trackSummary;

    const displayTitle = episodeData?.t
      ? `${tmdbInfo.title} - ${episodeData.t}`
      : `${tmdbInfo.title}${tmdbInfo.year ? ` (${tmdbInfo.year})` : ""}`;

    const streams = sources.map((source) => ({
      ...buildStream(
        "NetMirror",
        `[${inferTrackTag(trackSummary)}] ${normalizeQuality(source.quality || source.label || source.url, "HD")} ${selected.platform}`,
        source.url,
        {
          "User-Agent": "Mozilla/5.0 (Android) ExoPlayer",
          Accept: "*/*",
          "Accept-Encoding": "identity",
          Connection: "keep-alive",
          Cookie: "hd=on",
          Referer: `${NETMIRROR_PLAY}/`
        },
        true
      ),
      _displayTitle: displayTitle,
      subtitles,
      _providerId: this.id
    }));

    const selectedStreams = scoreAndSelectStreams(this.id, streams);
    debug.streamCount = selectedStreams.length;
    debug.streams = includeStreams ? selectedStreams : [];
    debug.status = selectedStreams.length > 0 ? "ok" : "no_streams";
    return debug;
  }

  pickSearchResult(results, tmdbInfo, preferredTitle) {
    const targetYear = extractYear(tmdbInfo.year);
    const comparisonTitles = [...new Set([
      preferredTitle,
      tmdbInfo.title,
      tmdbInfo.originalTitle,
      ...(tmdbInfo.titles || [])
    ].map((value) => String(value || "").trim()).filter(Boolean))];

    const ranked = results
      .map((item) => {
        const similarity = Math.max(...comparisonTitles.map((title) => calculateSimilarity(item.title, title)));
        const itemYear = extractYear(item.title);
        const yearPenalty = targetYear && itemYear && itemYear !== targetYear ? 0.15 : 0;

        return {
          ...item,
          similarity,
          itemYear,
          finalScore: similarity - yearPenalty
        };
      })
      .filter((item) => item.finalScore >= 0.55)
      .sort((a, b) => b.finalScore - a.finalScore);

    return ranked[0] || null;
  }

  async request(url, options = {}) {
    const response = await axios({
      url,
      method: options.method || "GET",
      headers: { ...BASE_HEADERS, ...(options.headers || {}) },
      data: options.body,
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status} para ${url}`);
    }

    return response;
  }

  async bypass() {
    const now = Date.now();
    if (cachedCookie && cachedCookieAt && now - cachedCookieAt < COOKIE_EXPIRY_MS) {
      return cachedCookie;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await this.request(`${NETMIRROR_PLAY}/tv/p.php`, { method: "POST" });
      const setCookie = response.headers["set-cookie"];
      const cookieText = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie || "");
      const cookieMatch = cookieText.match(/t_hash_t=([^;]+)/);
      const responseText = typeof response.data === "string" ? response.data : JSON.stringify(response.data);

      if (responseText.includes("\"r\":\"n\"") && cookieMatch?.[1]) {
        cachedCookie = cookieMatch[1];
        cachedCookieAt = Date.now();
        return cachedCookie;
      }
    }

    throw new Error("No se pudo obtener cookie de NetMirror");
  }

  async searchContent(query, platform) {
    const ott = OTT_MAP[platform] || "nf";
    const cookie = await this.bypass();
    const searchEndpoints = {
      netflix: `${NETMIRROR_BASE}/search.php`,
      primevideo: `${NETMIRROR_BASE}/pv/search.php`,
      disney: `${NETMIRROR_BASE}/mobile/hs/search.php`
    };
    const response = await this.request(
      `${searchEndpoints[platform]}?s=${encodeURIComponent(query)}&t=${getUnixTime()}`,
      {
        headers: {
          Cookie: buildCookieString(cookie, ott),
          Referer: `${NETMIRROR_BASE}/tv/home`
        }
      }
    );
    const payload = typeof response.data === "object" ? response.data : JSON.parse(String(response.data || "{}"));
    return (Array.isArray(payload.searchResult) ? payload.searchResult : []).map((item) => ({
      id: item.id,
      title: item.t
    }));
  }

  async loadContent(contentId, platform) {
    const ott = OTT_MAP[platform] || "nf";
    const cookie = await this.bypass();
    const endpoints = {
      netflix: `${NETMIRROR_BASE}/post.php`,
      primevideo: `${NETMIRROR_BASE}/pv/post.php`,
      disney: `${NETMIRROR_BASE}/mobile/hs/post.php`
    };
    const response = await this.request(
      `${endpoints[platform]}?id=${contentId}&t=${getUnixTime()}`,
      {
        headers: {
          Cookie: buildCookieString(cookie, ott),
          Referer: `${NETMIRROR_BASE}/tv/home`
        }
      }
    );
    const payload = typeof response.data === "object" ? response.data : JSON.parse(String(response.data || "{}"));
    let episodes = Array.isArray(payload.episodes) ? payload.episodes.filter(Boolean) : [];

    if (payload.nextPageShow === 1 && payload.nextPageSeason) {
      episodes = episodes.concat(await this.getEpisodesFromSeason(contentId, payload.nextPageSeason, platform, 2).catch(() => []));
    }
    if (Array.isArray(payload.season) && payload.season.length > 1) {
      for (const season of payload.season.slice(0, -1)) {
        episodes = episodes.concat(await this.getEpisodesFromSeason(contentId, season.id, platform, 1).catch(() => []));
      }
    }

    return { ...payload, episodes };
  }

  async getEpisodesFromSeason(seriesId, seasonId, platform, page = 1) {
    const ott = OTT_MAP[platform] || "nf";
    const cookie = await this.bypass();
    const endpoints = {
      netflix: `${NETMIRROR_BASE}/episodes.php`,
      primevideo: `${NETMIRROR_BASE}/pv/episodes.php`,
      disney: `${NETMIRROR_BASE}/mobile/hs/episodes.php`
    };
    const collected = [];
    let currentPage = page;

    while (true) {
      const response = await this.request(
        `${endpoints[platform]}?s=${seasonId}&series=${seriesId}&t=${getUnixTime()}&page=${currentPage}`,
        {
          headers: {
            Cookie: buildCookieString(cookie, ott),
            Referer: `${NETMIRROR_BASE}/tv/home`
          }
        }
      );
      const payload = typeof response.data === "object" ? response.data : JSON.parse(String(response.data || "{}"));
      if (Array.isArray(payload.episodes)) {
        collected.push(...payload.episodes.filter(Boolean));
      }
      if (payload.nextPageShow === 0) break;
      currentPage += 1;
    }

    return collected;
  }

  findEpisode(episodes, season, episode) {
    return episodes.find((item) => {
      let seasonValue = null;
      let episodeValue = null;
      if (item.s && item.ep) {
        seasonValue = Number(String(item.s).replace(/^S/i, ""));
        episodeValue = Number(String(item.ep).replace(/^E/i, ""));
      } else if (item.season && item.episode) {
        seasonValue = Number(item.season);
        episodeValue = Number(item.episode);
      } else if (item.season_number && item.episode_number) {
        seasonValue = Number(item.season_number);
        episodeValue = Number(item.episode_number);
      }
      return seasonValue === Number(season) && episodeValue === Number(episode);
    }) || null;
  }

  async getVideoToken(id, cookie, ott) {
    const cookieString = buildCookieString(cookie, ott);
    const playResponse = await this.request(`${NETMIRROR_BASE}/play.php`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: `${NETMIRROR_BASE}/`,
        Cookie: cookieString
      },
      body: `id=${id}`
    });
    const playData = typeof playResponse.data === "object" ? playResponse.data : JSON.parse(String(playResponse.data || "{}"));
    const secondResponse = await this.request(`${NETMIRROR_PLAY}/play.php?id=${id}&${playData.h}`, {
      headers: {
        Referer: `${NETMIRROR_BASE}/`,
        Cookie: cookieString
      }
    });
    const html = typeof secondResponse.data === "string" ? secondResponse.data : String(secondResponse.data || "");
    return html.match(/data-h="([^"]+)"/i)?.[1] || "";
  }

  async getStreamingLinks(contentId, title, platform) {
    const ott = OTT_MAP[platform] || "nf";
    const cookie = await this.bypass();
    const token = await this.getVideoToken(contentId, cookie, ott);
    const cookieString = buildCookieString(cookie, ott);
    const playlistEndpoints = {
      netflix: `${NETMIRROR_PLAY}/playlist.php`,
      primevideo: `${NETMIRROR_PLAY}/pv/playlist.php`,
      disney: `${NETMIRROR_PLAY}/mobile/hs/playlist.php`
    };
    const response = await this.request(
      `${playlistEndpoints[platform]}?id=${contentId}&t=${encodeURIComponent(title)}&tm=${getUnixTime()}&h=${token}`,
      {
        headers: {
          Cookie: cookieString,
          Referer: `${NETMIRROR_PLAY}/`
        }
      }
    );
    const payload = typeof response.data === "object" ? response.data : JSON.parse(String(response.data || "[]"));
    const playlist = Array.isArray(payload) ? payload : [];
    const sources = [];
    const subtitles = [];
    const trackSummary = [];

    for (const item of playlist) {
      if (Array.isArray(item.tracks)) {
        for (const track of item.tracks) {
          const label = normalizeLanguageLabel(track.label || track.language || "");
          trackSummary.push({
            kind: String(track.kind || "").trim() || "unknown",
            label,
            file: String(track.file || "").trim() || null
          });

          if (String(track.kind || "").toLowerCase() !== "captions") {
            continue;
          }

          let fullSubUrl = String(track.file || "");
          if (fullSubUrl.startsWith("/") && !fullSubUrl.startsWith("//")) {
            fullSubUrl = `${NETMIRROR_PLAY}${fullSubUrl}`;
          } else if (fullSubUrl.startsWith("//")) {
            fullSubUrl = `https:${fullSubUrl}`;
          }

          if (fullSubUrl.startsWith("http")) {
            subtitles.push({
              id: `${platform}-${label || "sub"}-${subtitles.length + 1}`,
              url: fullSubUrl,
              lang: label || "Unknown"
            });
          }
        }
      }

      if (!Array.isArray(item.sources)) continue;
      for (const source of item.sources) {
        let fullUrl = String(source.file || "").replace("/tv/", "/");
        if (!fullUrl.startsWith("http")) {
          if (!fullUrl.startsWith("/")) fullUrl = `/${fullUrl}`;
          fullUrl = `${NETMIRROR_PLAY}${fullUrl}`;
        }
        sources.push({ url: fullUrl, quality: source.label || source.quality || "" });
      }
    }

    return {
      sources,
      subtitles,
      trackSummary
    };
  }
}

