import cheerio from "cheerio-without-node-native";
import {
  findBestAnimeMappingByTitle,
  findBestOtakuMappingByTitle,
  getAnimeMappingByImdbId,
  getAnimeMappingTitles,
  getOtakuMappingByImdbId,
  getOtakuMappingByTmdbId,
  getOtakuMappingTitles,
  hasOtakuDub
} from "../lib/anime-mappings.js";
import { buildStream, resolveExtractorStream } from "../lib/extractors.js";
import { buildStremioId } from "../lib/ids.js";
import { basicTitleSimilarity, normalizeMediaTitle } from "../lib/tmdb.js";
import { absoluteUrl, mapSearchItem, stripTags } from "../lib/webstreamer/common.js";
import { fetchJson, fetchText } from "../lib/webstreamer/http.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

function cleanText(value) {
  return stripTags(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAnimeTitle(value) {
  return normalizeMediaTitle(String(value || ""))
    .replace(/\b(tv|anime|movie|pelicula|ova|special)\b/g, " ")
    .replace(/\bseason\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeServerName(value) {
  const text = cleanText(value);
  const lower = text.toLowerCase();
  if (lower === "sw") return "StreamWish";
  if (lower === "stape") return "StreamTape";
  if (lower === "yu") return "YourUpload";
  if (lower === "okru") return "Okru";
  if (lower === "netu") return "Netu";
  if (lower === "maru") return "Mail.ru";
  if (lower === "fembed") return "Fembed";
  if (lower === "mega") return "Mega";
  return text || "Server";
}

function buildLanguageTag(kind) {
  return kind === "DUB" ? "LAT DUB" : "LAT SUB";
}

function buildEpisodeLabel(number) {
  const numeric = Number.parseFloat(String(number || "").replace(",", "."));
  if (Number.isFinite(numeric) && Number.isInteger(numeric)) {
    return String(numeric);
  }
  return String(number || "").trim();
}

async function fetchAniListAliases(title, year) {
  const queryTitle = String(title || "").trim();
  if (!queryTitle) return [];

  const payload = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      query: `
        query ($search: String) {
          Page(page: 1, perPage: 5) {
            media(search: $search, type: ANIME) {
              seasonYear
              title {
                romaji
                english
                native
              }
              synonyms
            }
          }
        }
      `,
      variables: { search: queryTitle }
    })
  }).then((response) => (response.ok ? response.json() : null)).catch(() => null);

  const media = payload?.data?.Page?.media;
  if (!Array.isArray(media)) return [];

  const values = [];
  for (const item of media) {
    const seasonYear = String(item?.seasonYear || "");
    if (year && seasonYear && seasonYear !== String(year)) {
      continue;
    }

    values.push(
      item?.title?.romaji,
      item?.title?.english,
      item?.title?.native,
      ...(Array.isArray(item?.synonyms) ? item.synonyms : [])
    );
  }

  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

async function fetchJikanAliases(title) {
  const queryTitle = String(title || "").trim();
  if (!queryTitle) return [];

  const payload = await fetchJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(queryTitle)}&limit=5`).catch(() => null);
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const values = [];

  for (const item of data) {
    values.push(
      item?.title,
      item?.title_english,
      item?.title_japanese,
      ...(Array.isArray(item?.titles) ? item.titles.map((entry) => entry?.title) : [])
    );
  }

  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export class AnimeFlvProvider extends WebstreamBaseProvider {
  constructor() {
    super({
      id: "animeflv",
      name: "AnimeFLV",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.ANIMEFLV_BASE_URL || "https://www3.animeflv.net";
  }

  buildSearchQueries(externalMeta, extraTitles = []) {
    const baseQueries = super.buildSearchQueries(externalMeta, extraTitles);
    const expanded = new Set(baseQueries);

    for (const value of baseQueries) {
      const cleaned = String(value || "")
        .replace(/[!?:]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned) {
        expanded.add(cleaned);
      }
    }

    return [...expanded].slice(0, 6);
  }

  async searchWithFallbackQueries({ type, externalMeta }) {
    const mapping = await this.findAnimeMapping(externalMeta);
    externalMeta._animeMapping = mapping;
    const otakuMapping = this.findOtakuMapping(externalMeta, mapping);
    externalMeta._otakuMapping = otakuMapping;
    const mappingTitles = getAnimeMappingTitles(mapping);
    const otakuTitles = getOtakuMappingTitles(otakuMapping);
    const fallbackTitles = mappingTitles.length > 0
      ? []
      : externalMeta?.id?.startsWith("tmdb:")
        ? (await this.fetchAnimeSearchTitles(externalMeta).catch(() => []))
        : [];

    externalMeta._searchTitles = [...new Set([...mappingTitles, ...otakuTitles, ...fallbackTitles])];
    const items = [];

    for (const query of this.buildSearchQueries(externalMeta, externalMeta._searchTitles)) {
      const results = await this.search({ type, query }).catch(() => []);
      if (results.length > 0) {
        items.push(...results);
      }
    }

    return this.dedupeById(items);
  }

  async search({ type, query }) {
    if (!query?.trim()) {
      return [];
    }

    const html = await fetchText(`${this.baseUrl}/browse?q=${encodeURIComponent(query.trim())}`).catch(() => "");
    return this.extractSearchItems(html, type);
  }

  async getMeta({ type, slug }) {
    const path = this.decodePathToken(slug);
    const pageUrl = absoluteUrl(path, this.baseUrl);
    const html = await fetchText(pageUrl).catch(() => "");
    const videos = type === "series" ? this.buildEpisodeVideos(pageUrl, html) : [];

    return {
      id: buildStremioId(this.id, type, slug),
      type,
      name: this.extractTitle(html) || this.unslugify(path),
      poster: this.extractPoster(html),
      background: this.extractPoster(html),
      description: this.extractDescription(html),
      genres: this.extractGenres(html),
      cast: [],
      videos
    };
  }

  async getStreams({ type, slug }) {
    const path = this.decodePathToken(slug);
    let pageUrl = absoluteUrl(path, this.baseUrl);
    let html = await fetchText(pageUrl).catch(() => "");

    if (!html) {
      return [];
    }

    const playback = await this.resolvePlaybackPage(type, pageUrl, html);
    pageUrl = playback.pageUrl;
    html = playback.html;

    this._currentOtakuMapping = null;
    const streams = await this.extractStreamsFromPage(pageUrl, html);
    return this.sortStreams(streams);
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
      supported: externalId?.startsWith("tt") || externalId?.startsWith("tmdb:") || false
    };

    if (!debug.supported) {
      return debug;
    }

    const parsedExternal = externalId.startsWith("tmdb:")
      ? {
          baseId: externalId.replace(/^tmdb:/, "").split(":")[0],
          season: type === "series" ? Number.parseInt(externalId.split(":")[1] || "0", 10) || null : null,
          episode: type === "series" ? Number.parseInt(externalId.split(":")[2] || "0", 10) || null : null
        }
      : this.parseExternalStremioId(type, externalId);
    debug.parsedExternal = parsedExternal;

    const externalMeta = externalId.startsWith("tmdb:")
      ? await this.buildMetaFromTmdb(type, parsedExternal.baseId)
      : await this.fetchCinemetaMeta(type, parsedExternal.baseId);
    debug.externalMeta = externalMeta
      ? {
          id: externalMeta.id,
          name: externalMeta.name,
          releaseInfo: externalMeta.releaseInfo || externalMeta.year || "",
          type: externalMeta.type
        }
      : null;

    if (!externalMeta?.name) {
      debug.status = "missing_external_meta";
      return debug;
    }

    const candidates = await this.searchWithFallbackQueries({ type, externalMeta });
    debug.dubHint = hasOtakuDub(externalMeta?._otakuMapping);
    debug.queries = this.buildSearchQueries(externalMeta, externalMeta?._searchTitles || []);
    debug.candidates = candidates.map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      name: candidate.name,
      releaseInfo: candidate.releaseInfo || ""
    }));

    if (!candidates.length) {
      debug.status = "no_candidates";
      return debug;
    }

    const bestMatch = this.pickBestCandidate(candidates, externalMeta);
    debug.bestMatch = bestMatch
      ? {
          id: bestMatch.id,
          type: bestMatch.type,
          name: bestMatch.name,
          releaseInfo: bestMatch.releaseInfo || ""
        }
      : null;

    if (!bestMatch) {
      debug.status = "no_best_match";
      return debug;
    }

    const path = this.decodePathToken(bestMatch.id.split(":").slice(2).join(":"));
    let pageUrl = absoluteUrl(path, this.baseUrl);
    let html = await fetchText(pageUrl).catch(() => "");
    debug.targetUrl = pageUrl;

    if (!html) {
      debug.status = "missing_page";
      return debug;
    }

    if (type === "series" && parsedExternal.episode) {
      const episodeUrl = this.resolveEpisodeUrl(pageUrl, html, parsedExternal.episode);
      debug.episodeTargetUrl = episodeUrl || null;

      if (!episodeUrl) {
        debug.status = "no_matching_episode";
        return debug;
      }

      pageUrl = episodeUrl;
      html = await fetchText(pageUrl).catch(() => "");
      debug.targetUrl = pageUrl;

      if (!html) {
        debug.status = "missing_episode_page";
        return debug;
      }
    } else {
      const playback = await this.resolvePlaybackPage(type, pageUrl, html);
      pageUrl = playback.pageUrl;
      html = playback.html;
      debug.targetUrl = pageUrl;
    }

    const rawPlayers = this.extractRawPlayers(html, pageUrl);
    debug.playerCount = rawPlayers.length;
    debug.players = rawPlayers.map((player) => ({
      language: player.language,
      server: player.server,
      pageUrl: player.url
    }));

    this._currentOtakuMapping = externalMeta?._otakuMapping || null;
    const streams = await this.extractStreamsFromPage(pageUrl, html);
    this._currentOtakuMapping = null;
    debug.streamCount = streams.length;
    debug.streams = includeStreams ? streams : [];
    debug.status = streams.length > 0 ? "ok" : "no_streams";
    return debug;
  }

  buildEpisodeVideos(pageUrl, html) {
    const episodes = this.extractEpisodeEntries(html);
    return episodes.map((item) => ({
      id: buildStremioId(this.id, "series", this.encodePathToken(item.path)),
      title: `Episodio ${buildEpisodeLabel(item.number)}`,
      season: 1,
      episode: Number.parseInt(String(item.number), 10) || 0
    }));
  }

  resolveEpisodeUrl(pageUrl, html, targetEpisode) {
    const entries = this.extractEpisodeEntries(html);
    const exact = entries.find((item) => Number.parseFloat(String(item.number)) === Number(targetEpisode));
    return exact ? absoluteUrl(exact.path, this.baseUrl) : null;
  }

  async resolvePlaybackPage(type, pageUrl, html) {
    if (this.extractRawPlayers(html, pageUrl).length > 0) {
      return { pageUrl, html };
    }

    const entries = this.extractEpisodeEntries(html);
    if (!entries.length) {
      return { pageUrl, html };
    }

    const fallbackEntry = type === "movie"
      ? entries.find((item) => Number.parseFloat(String(item.number)) === 1) || entries[0]
      : null;

    if (!fallbackEntry) {
      return { pageUrl, html };
    }

    const fallbackUrl = absoluteUrl(fallbackEntry.path, this.baseUrl);
    const fallbackHtml = await fetchText(fallbackUrl).catch(() => "");
    if (!fallbackHtml) {
      return { pageUrl, html };
    }

    return {
      pageUrl: fallbackUrl,
      html: fallbackHtml
    };
  }

  extractEpisodeEntries(html) {
    const script = this.extractAnimeInfoScript(html);
    const animeInfoRaw = script.match(/var\s+anime_info\s*=\s*\[([^\]]+)\]/i)?.[1] || "";
    const episodeSection = script.match(/var\s+episodes\s*=\s*\[([\s\S]*?)\];/i)?.[1] || "";
    const animeInfoParts = animeInfoRaw.split(",").map((item) => item.trim().replace(/^"|"$/g, ""));
    const animeUri = animeInfoParts[2] || "";

    if (!animeUri || !episodeSection) {
      return [];
    }

    const episodes = [];
    const episodeRegex = /\[\s*([0-9]+(?:\.[0-9]+)?)\s*,/g;
    let match;
    while ((match = episodeRegex.exec(episodeSection))) {
      const number = match[1];
      episodes.push({
        number,
        path: `/ver/${animeUri}-${number}`
      });
    }

    return episodes.reverse();
  }

  async extractStreamsFromPage(pageUrl, html) {
    const previousOtakuMapping = this._currentOtakuMapping || null;
    const rawPlayers = this.extractRawPlayers(html, pageUrl);
    const groups = await Promise.all(
      rawPlayers.map((player) => this.resolvePlayer(player))
    );
    this._currentOtakuMapping = previousOtakuMapping;
    return groups.flat().filter(Boolean);
  }

  extractRawPlayers(html, referer) {
    const script = this.extractVideosScript(html);
    const rawJson = script.match(/var\s+videos\s*=\s*(\{[\s\S]*?\});/i)?.[1] || "";
    if (!rawJson) {
      return [];
    }

    const parsed = JSON.parse(rawJson);
    const players = [];
    const hasKnownDub = hasOtakuDub(this._currentOtakuMapping);

    for (const language of ["SUB"]) {
      const items = Array.isArray(parsed?.[language]) ? parsed[language] : [];
      for (const item of items) {
        const rawUrl = String(item?.url || item?.code || "").trim();
        if (!rawUrl) {
          continue;
        }

        players.push({
          language,
          server: normalizeServerName(item?.server || item?.title || ""),
          url: rawUrl,
          referer,
          hasKnownDub
        });
      }
    }

    return Array.from(new Map(players.map((item) => [`${item.language}:${item.server}:${item.url}`, item])).values());
  }

  async resolvePlayer(player) {
    const languageTag = player.language === "DUB" && player.hasKnownDub
      ? "LAT DUB"
      : buildLanguageTag(player.language);
    const label = `[${languageTag}] ${player.server || "Server"}`.trim();
    const normalizedUrl = this.normalizePlayerUrl(player.url);

    if (!normalizedUrl) {
      return [];
    }

    if (this.isDirectHls(player)) {
      return [
        buildStream(
          "AnimeFLV",
          `${label} HLS`.trim(),
          normalizedUrl,
          {
            Referer: `${this.baseUrl}/`
          },
          true
        )
      ];
    }

    const streams = await resolveExtractorStream(normalizedUrl, label, true).catch(() => []);
    return streams.map((stream) => ({
      ...stream,
      name: "AnimeFLV",
      subtitles: stream.subtitles || []
    }));
  }

  isDirectHls(player) {
    return /\.m3u8(\?|$)/i.test(player.url) || /\bHLS\b/i.test(player.server || "");
  }

  normalizePlayerUrl(url) {
    return String(url || "").trim();
  }

  extractSearchItems(html, type) {
    const $ = cheerio.load(String(html || ""));
    const items = [];
    $("div.Container ul.ListAnimes li article").each((_, element) => {
      const entry = $(element);
      const href = absoluteUrl(entry.find("div.Description a.Button").attr("href") || "", this.baseUrl);
      const title = cleanText(entry.find("a h3").text());
      if (!href || !title) {
        return;
      }

      const path = new URL(href).pathname;
      items.push(mapSearchItem(this.id, type, this.encodePathToken(path), title, ""));
    });

    return this.dedupeById(items);
  }

  pickBestCandidate(candidates, externalMeta) {
    const searchTitles = this.buildSearchQueries(externalMeta, externalMeta?._searchTitles || []);
    const mapping = externalMeta?._animeMapping || null;
    const otakuMapping = externalMeta?._otakuMapping || null;
    const mappingTitles = getAnimeMappingTitles(mapping).map((value) => normalizeAnimeTitle(value));
    const otakuTitles = getOtakuMappingTitles(otakuMapping).map((value) => normalizeAnimeTitle(value));
    let best = null;

    for (const candidate of candidates) {
      const candidateTitle = normalizeAnimeTitle(candidate.name);
      let score = 0;

      for (const target of searchTitles) {
        const normalizedTarget = normalizeAnimeTitle(target);
        if (!normalizedTarget || !candidateTitle) {
          continue;
        }

        let localScore = basicTitleSimilarity(candidateTitle, normalizedTarget);
        if (candidateTitle === normalizedTarget) {
          localScore = 1;
        } else if (candidateTitle.includes(normalizedTarget) || normalizedTarget.includes(candidateTitle)) {
          localScore = Math.max(localScore, 0.9);
        }
        score = Math.max(score, localScore);
      }

      for (const target of mappingTitles) {
        if (!target || !candidateTitle) continue;
        let localScore = basicTitleSimilarity(candidateTitle, target);
        if (candidateTitle === target) {
          localScore = 1.2;
        } else if (candidateTitle.includes(target) || target.includes(candidateTitle)) {
          localScore = Math.max(localScore, 1);
        }
        score = Math.max(score, localScore);
      }

      for (const target of otakuTitles) {
        if (!target || !candidateTitle) continue;
        let localScore = basicTitleSimilarity(candidateTitle, target);
        if (candidateTitle === target) {
          localScore = 1.15;
        } else if (candidateTitle.includes(target) || target.includes(candidateTitle)) {
          localScore = Math.max(localScore, 0.98);
        }
        score = Math.max(score, localScore);
      }

      if (!best || score > best.score) {
        best = { candidate, score };
      }
    }

    return best && best.score >= 0.6 ? best.candidate : null;
  }

  async buildMetaFromTmdb(type, tmdbId) {
    const mediaType = type === "series" ? "tv" : "movie";
    const payload = await fetchJson(
      `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${this.tmdbApiKey}&language=es-ES`
    ).catch(() => null);

    if (!payload) {
      return null;
    }

    return {
      id: `tmdb:${tmdbId}`,
      name: payload.name || payload.title || payload.original_name || payload.original_title || "",
      releaseInfo: String(payload.first_air_date || payload.release_date || "").match(/\b(19|20)\d{2}\b/)?.[0] || "",
      type
    };
  }

  async fetchAnimeSearchTitles(externalMeta) {
    const baseTitle = String(externalMeta?.name || "").trim();
    const year = String(externalMeta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
    const titles = [baseTitle];
    const mapping = await this.findAnimeMapping(externalMeta).catch(() => null);
    const otakuMapping = this.findOtakuMapping(externalMeta, mapping);
    const mappingTitles = getAnimeMappingTitles(mapping);
    const otakuTitles = getOtakuMappingTitles(otakuMapping);

    if (mappingTitles.length > 0 || otakuTitles.length > 0) {
      return [...new Set([baseTitle, ...mappingTitles, ...otakuTitles].map((value) => String(value || "").trim()).filter(Boolean))];
    }

    const mediaType = externalMeta.type === "series" ? "tv" : "movie";
    const mediaId = externalMeta.id.replace(/^tmdb:/, "").split(":")[0];
    const enDetails = await fetchJson(`https://api.themoviedb.org/3/${mediaType}/${mediaId}?api_key=${this.tmdbApiKey}&language=en-US`).catch(() => null);
    const jaDetails = await fetchJson(`https://api.themoviedb.org/3/${mediaType}/${mediaId}?api_key=${this.tmdbApiKey}&language=ja-JP`).catch(() => null);

    titles.push(
      enDetails?.name,
      enDetails?.title,
      enDetails?.original_name,
      enDetails?.original_title,
      jaDetails?.name,
      jaDetails?.title,
      jaDetails?.original_name,
      jaDetails?.original_title
    );

    const seedTitles = [...new Set(titles.map((value) => String(value || "").trim()).filter(Boolean))];
    const values = [...seedTitles];

    for (const title of seedTitles.slice(0, 2)) {
      const [aniListAliases, jikanAliases] = await Promise.all([
        fetchAniListAliases(title, year).catch(() => []),
        fetchJikanAliases(title).catch(() => [])
      ]);
      values.push(...aniListAliases, ...jikanAliases);
    }

    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  }

  async findAnimeMapping(externalMeta) {
    const imdbId = String(externalMeta?.id || "").startsWith("tt") ? externalMeta.id : "";
    const year = String(externalMeta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";

    const byImdb = imdbId ? getAnimeMappingByImdbId(imdbId) : null;
    if (byImdb) {
      return byImdb;
    }

    const titles = [externalMeta?.name, ...(Array.isArray(externalMeta?._searchTitles) ? externalMeta._searchTitles : [])]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    return findBestAnimeMappingByTitle(titles, year);
  }

  findOtakuMapping(externalMeta, animeMapping = null) {
    const rawId = String(externalMeta?.id || "");
    const imdbId = rawId.startsWith("tt") ? rawId : "";
    const tmdbId = rawId.startsWith("tmdb:") ? rawId.replace(/^tmdb:/, "").split(":")[0] : "";

    const byImdb = imdbId ? getOtakuMappingByImdbId(imdbId) : null;
    if (byImdb) {
      return byImdb;
    }

    const byTmdb = tmdbId ? getOtakuMappingByTmdbId(tmdbId) : null;
    if (byTmdb) {
      return byTmdb;
    }

    const titles = [
      externalMeta?.name,
      ...getAnimeMappingTitles(animeMapping),
      ...(Array.isArray(externalMeta?._searchTitles) ? externalMeta._searchTitles : [])
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    return findBestOtakuMappingByTitle(titles);
  }

  extractVideosScript(html) {
    return String(html || "").match(/<script[^>]*>[\s\S]*?var\s+videos\s*=\s*\{[\s\S]*?<\/script>/i)?.[0] || "";
  }

  extractAnimeInfoScript(html) {
    return String(html || "").match(/<script[^>]*>[\s\S]*?var\s+anime_info\s*=\s*\[[\s\S]*?var\s+episodes\s*=\s*\[[\s\S]*?<\/script>/i)?.[0] || "";
  }

  extractTitle(html) {
    const $ = cheerio.load(String(html || ""));
    return cleanText(
      $("h1.Title").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      ""
    );
  }

  extractPoster(html) {
    const $ = cheerio.load(String(html || ""));
    return absoluteUrl(
      $("div.AnimeCover div.Image figure img").attr("src") ||
      $("div.AnimeCover div.Image figure img").attr("data-cfsrc") ||
      $('meta[property="og:image"]').attr("content") ||
      "",
      this.baseUrl
    );
  }

  extractDescription(html) {
    const $ = cheerio.load(String(html || ""));
    return cleanText($("div.Description").first().text() || "");
  }

  extractGenres(html) {
    const $ = cheerio.load(String(html || ""));
    return Array.from(new Set($("nav.Nvgnrs a").map((_, el) => cleanText($(el).text())).get().filter(Boolean)));
  }

  encodePathToken(path) {
    return Buffer.from(String(path || ""), "utf-8").toString("base64url");
  }

  decodePathToken(value) {
    try {
      return Buffer.from(String(value || ""), "base64url").toString("utf-8");
    } catch {
      return String(value || "");
    }
  }

  unslugify(path) {
    return String(path || "")
      .split("/")
      .filter(Boolean)
      .pop()
      ?.split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "";
  }
}
