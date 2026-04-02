import { buildStremioId } from "../lib/ids.js";
import { buildStream, resolveExtractorStream } from "../lib/extractors.js";
import { markSourceFailure, markSourceSuccess } from "../lib/penalty-reliability.js";
import { analyzeScoredStreams, scoreAndSelectStreams } from "../lib/stream-scoring.js";
import { Provider } from "./base.js";

export class VerSeriesOnlineProvider extends Provider {
  constructor() {
    super({
      id: "verseriesonline",
      name: "VerSeriesOnline",
      supportedTypes: ["series"]
    });

    this.baseUrl = process.env.VERSERIESONLINE_BASE_URL || "https://www.verseriesonline.net";
  }

  async search({ type, query }) {
    if (type !== "series" || !query?.trim()) {
      return [];
    }

    const trimmedQuery = query.trim();
    const directMatch = this.mapDirectQuery(trimmedQuery);
    if (directMatch) {
      return [directMatch];
    }

    const slugMatch = await this.searchBySlug(trimmedQuery);
    if (slugMatch) {
      return [slugMatch];
    }

    const html = await this.fetchSearchHtml(trimmedQuery);
    const items = [];

    for (const match of html.matchAll(/<div[^>]*class="[^"]*\bshort\b[^"]*\bgridder-list\b[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi)) {
      const mapped = this.mapSearchBlock(match[0]);
      if (mapped) {
        items.push(mapped);
      }
    }

    return this.dedupeById(items);
  }

  async searchBySlug(query) {
    const candidates = this.buildSlugCandidates(query);

    for (const slug of candidates) {
      const url = `${this.baseUrl}/series/${slug}/`;

      try {
        const html = await this.fetchText(url);
        const title = this.cleanSeriesTitle(this.extractTitle(html));

        if (!title) {
          continue;
        }

        return {
          id: buildStremioId(this.id, "series", this.encodePathToken(`/series/${slug}/`)),
          type: "series",
          name: title,
          poster: this.toAbsoluteUrl(
            this.extractOgValue(html, "og:image")
            || this.extractFirstMatch(html, /<img[^>]+class="[^"]*\blazy-loaded\b[^"]*"[^>]+data-src="([^"]+)"/i)
          ),
          posterShape: "poster",
          description: "",
          genres: [],
          releaseInfo: ""
        };
      } catch {
        continue;
      }
    }

    return null;
  }

  mapDirectQuery(query) {
    const seriesPath = this.extractSeriesPath(query);
    if (!seriesPath) {
      return null;
    }

    const slug = this.pathToSlug(seriesPath);
    return {
      id: buildStremioId(this.id, "series", this.encodePathToken(seriesPath)),
      type: "series",
      name: this.unslugify(slug),
      poster: null,
      posterShape: "poster",
      description: "",
      genres: [],
      releaseInfo: ""
    };
  }

  buildSlugCandidates(query) {
    const normalized = String(query || "")
      .normalize("NFD")
      .replaceAll(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replaceAll(/[^a-z0-9\s-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const baseSlug = normalized.replace(/\s+/g, "-");
    const withoutArticles = normalized
      .replace(/\b(the|a|an)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s+/g, "-");

    return [...new Set([baseSlug, withoutArticles].filter((value) => value && value.length >= 2))];
  }

  async fetchSearchHtml(query) {
    const encoded = encodeURIComponent(String(query || "").trim());
    const candidates = [
      `${this.baseUrl}/recherche?q=${encoded}&page=1`,
      `${this.baseUrl}/recherche?q=${encoded}`,
      `${this.baseUrl}/search?q=${encoded}&page=1`,
      `${this.baseUrl}/search?q=${encoded}`,
      `${this.baseUrl}/?s=${encoded}`,
      `${this.baseUrl}/page/1/?s=${encoded}`,
      `${this.baseUrl}/series-online/?s=${encoded}`,
      `${this.baseUrl}/series-online/page/1`
    ];

    let lastError = null;

    for (const url of candidates) {
      try {
        const html = await this.fetchText(url);

        if (url.endsWith("/series-online/page/1")) {
          const normalizedQuery = this.normalizeTitle(query);
          const filtered = Array.from(
            html.matchAll(/<div[^>]*class="[^"]*\bshort\b[^"]*\bgridder-list\b[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi),
            (match) => match[0]
          ).filter((block) => this.normalizeTitle(this.mapSearchBlock(block)?.name || "").includes(normalizedQuery));

          if (filtered.length > 0) {
            return filtered.join("\n");
          }

          continue;
        }

        return html;
      } catch (error) {
        lastError = error;
      }
    }

    return "";
  }

  async getMeta({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const html = await this.fetchText(target.url);

    return {
      id: target.id,
      type: "series",
      name: this.cleanSeriesTitle(this.extractTitle(html) || this.unslugify(target.primarySlug)),
      poster: this.toAbsoluteUrl(
        this.extractOgValue(html, "og:image")
        || this.extractFirstMatch(html, /<img[^>]+class="[^"]*\blazy-loaded\b[^"]*"[^>]+data-src="([^"]+)"/i)
      ),
      background: this.toAbsoluteUrl(this.extractOgValue(html, "og:image")),
      description: this.extractDescription(html),
      genres: this.extractGenres(html),
      cast: [this.extractDirector(html)].filter(Boolean),
      videos: await this.buildEpisodeVideos(html, target.seriesPath || this.extractSeriesPath(target.url))
    };
  }

  async getStreams({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const page = await this.fetchTextResponse(target.url);
    const players = this.extractPlayerEntries(page.text)
      .filter((player) => this.isSourceEnabled(player.server));

    if (!players.length) {
      return [];
    }

    const cookieHeader = this.buildCookieHeader(page.response);
    const csrfToken = this.extractFirstMatch(page.text, /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i);

    const streamGroups = await Promise.all(
      players.map((player) => this.resolvePlayerStream({
        ...player,
        csrfToken,
        cookieHeader,
        referer: target.url
      }))
    );

    return this.sortStreams(streamGroups.flat().filter(Boolean));
  }

  async getStreamsFromExternalId({ type, externalId }) {
    if (type !== "series" || !externalId?.startsWith("tt")) {
      return [];
    }

    const parsedExternal = this.parseExternalStremioId(type, externalId);
    const externalMeta = await this.fetchCinemetaMeta(type, parsedExternal.baseId);

    if (!externalMeta?.name) {
      return [];
    }

    const candidates = await this.searchWithFallbackQueries({ type, externalMeta });
    if (!candidates.length) {
      return [];
    }

    const bestMatch = this.pickBestCandidate(candidates, externalMeta);
    if (!bestMatch) {
      return [];
    }

    let slug = bestMatch.id.split(":").slice(2).join(":");

    if (parsedExternal.season && parsedExternal.episode) {
      const seriesMeta = await this.getMeta({ type: "series", slug });
      const matchingVideo = this.findMatchingEpisodeVideo(seriesMeta.videos || [], parsedExternal);

      if (!matchingVideo?.id) {
        return [];
      }

      slug = matchingVideo.id.split(":").slice(2).join(":");
    }

    return this.getStreams({
      type: "series",
      slug
    });
  }

  async debugStreamsFromExternalId({ type, externalId }) {
    const debug = {
      provider: this.id,
      type,
      externalId,
      supported: type === "series" && externalId?.startsWith("tt")
    };

    if (!debug.supported) {
      return debug;
    }

    const parsedExternal = this.parseExternalStremioId(type, externalId);
    debug.parsedExternal = parsedExternal;

    const externalMeta = await this.fetchCinemetaMeta(type, parsedExternal.baseId);
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

    const queries = this.buildSearchQueries(externalMeta);
    debug.queries = queries;

    const candidates = await this.searchWithFallbackQueries({ type, externalMeta });
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

    let slug = bestMatch.id.split(":").slice(2).join(":");
    debug.seriesSlug = slug;

    const seriesMeta = await this.getMeta({ type: "series", slug });
    debug.videoCount = (seriesMeta.videos || []).length;
    debug.videoSample = (seriesMeta.videos || []).slice(0, 20).map((video) => ({
      id: video.id,
      season: video.season,
      episode: video.episode,
      title: video.title
    }));

    const matchingVideo = this.findMatchingEpisodeVideo(seriesMeta.videos || [], parsedExternal);
    debug.matchingVideo = matchingVideo
      ? {
          id: matchingVideo.id,
          season: matchingVideo.season,
          episode: matchingVideo.episode,
          title: matchingVideo.title
        }
      : null;

    if (!matchingVideo?.id) {
      debug.status = "no_matching_video";
      return debug;
    }

    slug = matchingVideo.id.split(":").slice(2).join(":");
    const target = this.parseSlugPayload("series", slug);
    debug.targetUrl = target.url;

    const page = await this.fetchTextResponse(target.url);
    const players = this.extractPlayerEntries(page.text)
      .filter((player) => this.isSourceEnabled(player.server));
    const cookieHeader = this.buildCookieHeader(page.response);
    const csrfToken = this.extractFirstMatch(page.text, /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i);

    debug.playerCount = players.length;
    debug.players = players.map((player) => ({
      server: player.server,
      quality: "",
      pageUrl: player.pageUrl,
      language: player.language
    }));

    if (!players.length) {
      debug.status = "no_players";
      return debug;
    }

    const streamGroups = await Promise.all(
      players.map((player) => this.resolvePlayerStream({
        ...player,
        csrfToken,
        cookieHeader,
        referer: target.url
      }))
    );

    const rawStreams = streamGroups.flat().filter(Boolean);
    const scoredStreams = analyzeScoredStreams(this.id, rawStreams, {
      cleanTitle: (streamTitle) => this.cleanStreamTitle(streamTitle)
    });
    const streams = scoredStreams.map((item) => item.stream);

    debug.streamCount = streams.length;
    debug.scoredStreams = scoredStreams.map((item) => ({
      title: item.stream.title,
      url: item.stream.url || null,
      sourceKey: item.sourceKey,
      sourceLabel: item.sourceLabel,
      score: item.score,
      components: item.components
    }));
    debug.streams = streams.map((stream) => ({
      name: stream.name,
      title: stream.title,
      url: stream.url || null,
      behaviorHints: stream.behaviorHints || null
    }));
    debug.status = streams.length > 0 ? "ok" : "no_streams";

    return debug;
  }

  async debugInternalStreams({ type, slug }) {
    if (type !== "series") {
      return null;
    }

    const target = this.parseSlugPayload(type, slug);
    const page = await this.fetchTextResponse(target.url);
    const csrfToken = this.extractFirstMatch(page.text, /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i);
    const cookieHeader = this.buildCookieHeader(page.response);
    const players = this.extractPlayerEntries(page.text)
      .filter((player) => this.isSourceEnabled(player.server));

    const streamGroups = await Promise.all(
      players.map((player) => this.resolvePlayerStream({
        ...player,
        csrfToken,
        cookieHeader,
        referer: target.url
      }))
    );

    const rawStreams = streamGroups.flat().filter(Boolean);
    const scoredStreams = analyzeScoredStreams(this.id, rawStreams, {
      cleanTitle: (streamTitle) => this.cleanStreamTitle(streamTitle)
    });
    const streams = scoredStreams.map((item) => item.stream);

    return {
      targetUrl: target.url,
      title: this.cleanSeriesTitle(this.extractTitle(page.text) || this.unslugify(target.primarySlug)),
      csrfTokenPresent: Boolean(csrfToken),
      cookieHeaderPresent: Boolean(cookieHeader),
      rawHashCount: (page.text.match(/data-hash=/gi) || []).length,
      rawPlayerCount: (page.text.match(/class=["'][^"']*\blien\b[^"']*["']/gi) || []).length,
      playerCount: players.length,
      players: players.map((player) => ({
        server: player.server,
        serverText: player.serverText,
        language: player.language,
        hashPreview: String(player.dataHash || "").slice(0, 24)
      })),
      streamCount: streams.length,
      scoredStreams: scoredStreams.map((item) => ({
        title: item.stream.title,
        url: item.stream.url || null,
        sourceKey: item.sourceKey,
        sourceLabel: item.sourceLabel,
        score: item.score,
        components: item.components
      })),
      streams: streams.map((stream) => ({
        name: stream.name,
        title: stream.title,
        url: stream.url || null,
        behaviorHints: stream.behaviorHints || null
      })),
      status: streams.length > 0 ? "ok" : (players.length > 0 ? "no_streams" : "no_players")
    };
  }

  parseSlugPayload(type, slug) {
    const value = decodeURIComponent(String(slug || ""));

    if (value.startsWith("ep:")) {
      const [, encodedPath, seasonNumber, episodeNumber, encodedSeriesPath] = value.split(":");
      const episodePath = this.decodePathToken(encodedPath);
      const seriesPath = this.decodePathToken(encodedSeriesPath);
      return {
        id: buildStremioId(this.id, "series", value),
        type: "series",
        primarySlug: this.pathToSlug(seriesPath || episodePath),
        seasonNumber: Number(seasonNumber) || 1,
        episodeNumber: Number(episodeNumber) || 0,
        seriesPath,
        episodePath,
        url: this.toAbsoluteUrl(episodePath)
      };
    }

    const seriesPath = this.decodePathToken(value);
    return {
      id: buildStremioId(this.id, "series", value),
      type: "series",
      primarySlug: this.pathToSlug(seriesPath),
      seriesPath,
      url: this.toAbsoluteUrl(seriesPath)
    };
  }

  mapSearchBlock(block) {
    const href = this.extractFirstMatch(block, /<a[^>]+class="[^"]*\bshort_img\b[^"]*"[^>]+href="([^"]+)"/i)
      || this.extractFirstMatch(block, /<a[^>]+href="([^"]*\/series\/[^"]+)"/i)
      || this.extractFirstMatch(block, /<a[^>]+href="([^"]+)"/i);
    const title = this.extractFirstMatch(block, /<div[^>]+class="[^"]*\bshort_title\b[^"]*"[\s\S]*?<a[^>]*>([^<]+)</i);
    const image = this.extractFirstMatch(block, /<img[^>]+data-src="([^"]+)"/i)
      || this.extractFirstMatch(block, /<img[^>]+src="([^"]+)"/i);

    if (!href || !title) {
      return null;
    }

    const path = this.normalizePath(href);
    if (!path) {
      return null;
    }

    const seriesPath = this.extractSeriesPath(path);
    if (!seriesPath) {
      return null;
    }

    return {
      id: buildStremioId(this.id, "series", this.encodePathToken(seriesPath)),
      type: "series",
      name: this.cleanText(this.decodeHtmlEntities(title)),
      poster: this.toAbsoluteUrl(image),
      posterShape: "poster",
      description: "",
      genres: [],
      releaseInfo: ""
    };
  }

  async buildEpisodeVideos(seriesHtml, expectedSeriesPath = null) {
    const seasonLinks = Array.from(
      seriesHtml.matchAll(/<a[^>]+href="([^"]*\/temporada-\d+\/?[^"]*)"[^>]*>/gi),
      (match) => this.normalizePath(match[1])
    )
      .filter(Boolean)
      .filter((value) => !expectedSeriesPath || value.startsWith(this.normalizePath(expectedSeriesPath)))
      .filter((value, index, array) => array.indexOf(value) === index);

    const videos = [];

    for (const seasonPath of seasonLinks) {
      const seasonUrl = this.toAbsoluteUrl(seasonPath);
      const seasonHtml = await this.fetchText(seasonUrl);
      const seasonNumber = Number(seasonPath.match(/temporada-(\d+)/i)?.[1] || 1);
      const seriesPath = this.extractSeriesPathFromSeasonPath(seasonPath);
      const seasonPrefix = this.normalizePath(`${seriesPath}temporada-${seasonNumber}/`);

      for (const match of seasonHtml.matchAll(/<a[^>]+href="([^"]*\/episodio-\d+\/?[^"]*)"[^>]*>[\s\S]*?(?:<span[^>]+class="[^"]*\bname\b[^"]*"[^>]*>([^<]+)<\/span>|title="([^"]+)")/gi)) {
        const episodePath = this.normalizePath(match[1]);
        const rawName = this.sanitizeEpisodeName(this.cleanText(this.decodeHtmlEntities(match[2] || match[3] || "")));

        if (!episodePath) {
          continue;
        }

        if (seasonPrefix && !episodePath.startsWith(seasonPrefix)) {
          continue;
        }

        const episodeNumber = Number(
          episodePath.match(/episodio-(\d+)/i)?.[1]
          || rawName.match(/cap[ií]tulo\s+(\d+)/i)?.[1]
          || 0
        );
        videos.push({
          id: buildStremioId(
            this.id,
            "series",
            `ep:${this.encodePathToken(episodePath)}:${seasonNumber}:${episodeNumber}:${this.encodePathToken(seriesPath)}`
          ),
          title: `Temporada ${seasonNumber} - ${rawName || `Capitulo ${episodeNumber || "?"}`}`,
          season: seasonNumber,
          episode: episodeNumber
        });
      }
    }

    return this.dedupeEpisodeVideos(videos).sort((a, b) => {
      const seasonDiff = Number(b.season) - Number(a.season);
      if (seasonDiff !== 0) return seasonDiff;
      return Number(b.episode) - Number(a.episode);
    });
  }

  extractPlayerEntries(html) {
    const players = [];
    const seen = new Set();
    const source = String(html || "");
    const optionPattern = /<a[^>]+class=["'][^"']*\bplay-option\b[^"']*["'][^>]+data-hash=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = optionPattern.exec(source))) {
      const dataHash = match[1];
      if (!dataHash || seen.has(dataHash)) {
        continue;
      }

      seen.add(dataHash);
      const optionHtml = match[0];
      const labelHtml = match[2] || "";
      const serverText = this.cleanText(labelHtml || optionHtml);
      const imageSrc = String(this.extractFirstMatch(optionHtml, /<img[^>]+src=["']([^"']+)["']/i) || "").toLowerCase();
      const language = this.detectLanguage(serverText, imageSrc);

      players.push({
        dataHash,
        server: this.detectServer(serverText),
        serverText,
        language
      });
    }

    return players;
  }

  async resolvePlayerStream(player) {
    const sourceKey = `${this.id}:${player.server}`;

    try {
      const videoUrl = await this.resolveHashLink(player);
      if (!videoUrl) {
        markSourceFailure(sourceKey);
        return [];
      }

      const label = [player.language, player.serverText || player.server].filter(Boolean).join(" - ").trim();
      const extracted = await resolveExtractorStream(videoUrl, label, true);

      if (extracted.length > 0) {
        markSourceSuccess(sourceKey);
        return extracted.map((stream) => ({
          ...stream,
          name: "VerSeriesOnline",
          _sourceKey: sourceKey
        }));
      }

      if (/\.(m3u8|mp4)(\?|$)/i.test(videoUrl)) {
        markSourceSuccess(sourceKey);
        return [
          {
            ...buildStream("VerSeriesOnline", label, videoUrl, player.referer, true),
            _sourceKey: sourceKey
          }
        ];
      }
    } catch {
      markSourceFailure(sourceKey);
      return [];
    }

    markSourceFailure(sourceKey);
    return [];
  }

  async resolveHashLink(player) {
    if (!player.dataHash || !player.csrfToken) {
      return null;
    }

    const body = new URLSearchParams({
      hash: player.dataHash,
      _token: player.csrfToken
    }).toString();

    const response = await fetch(`${this.baseUrl}/hashembedlink`, {
      method: "POST",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "application/json, text/plain, */*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        "x-csrf-token": player.csrfToken,
        origin: this.baseUrl,
        referer: player.referer || `${this.baseUrl}/`,
        "accept-language": "es-ES,es;q=0.9",
        ...(player.cookieHeader ? { cookie: player.cookieHeader } : {})
      },
      body
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => null);
    const link = String(payload?.link || "").trim();
    return /^https?:\/\//i.test(link) ? link : null;
  }

  sortStreams(streams) {
    return scoreAndSelectStreams(this.id, streams, {
      cleanTitle: (title) => this.cleanStreamTitle(title)
    });
  }

  cleanStreamTitle(title) {
    return String(title || "")
      .replace(/^\d+\.\s*[^-]+-\s*HD\s*/i, "")
      .replace(/^servidor\s+/i, "")
      .replace(/\s+/g, " ")
      .replace(/\bStreamWish HLS\b/gi, "StreamWish")
      .replace(/\bVoe HLS\b/gi, "Voe")
      .replace(/\bVoe MP4\b/gi, "Voe")
      .replace(/\bNetu HLS\b/gi, "Netu")
      .replace(/\bVidHide HLS\b/gi, "VidHide")
      .replace(/\bVimeos\b/gi, "Vimeos")
      .replace(/\bDoodstream 0000p\b/gi, "Doodstream")
      .trim();
  }

  async searchWithFallbackQueries({ type, externalMeta }) {
    const queries = this.buildSearchQueries(externalMeta);
    const deduped = new Map();

    for (const query of queries) {
      const results = await this.search({ type, query });
      for (const result of results) {
        if (!deduped.has(result.id)) {
          deduped.set(result.id, result);
        }
      }
    }

    return Array.from(deduped.values());
  }

  buildSearchQueries(externalMeta) {
    const baseName = String(externalMeta?.name || "").trim();
    const queries = [];

    if (baseName) {
      queries.push(baseName);
      queries.push(baseName.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim());
      queries.push(baseName.split(":")[0].trim());
      queries.push(baseName.replace(/\b(the|a|an)\b/gi, " ").replace(/\s+/g, " ").trim());
    }

    return [...new Set(queries.filter((query) => query && query.length >= 2))];
  }

  parseExternalStremioId(type, externalId) {
    if (type === "series") {
      const match = String(externalId).match(/^(tt\d+):(\d+):(\d+)$/);
      if (match) {
        return {
          baseId: match[1],
          season: Number(match[2]),
          episode: Number(match[3])
        };
      }
    }

    return {
      baseId: externalId,
      season: null,
      episode: null
    };
  }

  findMatchingEpisodeVideo(videos, parsedExternal) {
    const season = Number(parsedExternal.season);
    const episode = Number(parsedExternal.episode);

    return videos.find((video) =>
      Number(video.season) === season &&
      Number(video.episode) === episode
    ) || null;
  }

  pickBestCandidate(candidates, externalMeta) {
    const targetTitle = this.normalizeTitle(externalMeta.name);
    const targetYear = this.extractYear(externalMeta.releaseInfo || externalMeta.year || "");

    const scored = candidates.map((candidate) => {
      const candidateTitle = this.normalizeTitle(candidate.name);
      const candidateYear = this.extractYear(candidate.releaseInfo || "");
      const titleSimilarity = this.stringSimilarity(candidateTitle, targetTitle);
      const candidateWords = candidateTitle.split(/\s+/).filter(Boolean);
      const targetWords = targetTitle.split(/\s+/).filter(Boolean);
      const wordDelta = Math.abs(candidateWords.length - targetWords.length);

      let score = 0;

      if (candidateTitle === targetTitle) {
        score += 100;
      } else if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) {
        score += wordDelta <= 1 ? 50 : 12;
      }

      if (titleSimilarity >= 0.92) {
        score += 65;
      } else if (titleSimilarity >= 0.84) {
        score += 40;
      }

      const relaxedCandidateTitle = this.relaxTitle(candidateTitle);
      const relaxedTargetTitle = this.relaxTitle(targetTitle);
      const relaxedSimilarity = this.stringSimilarity(relaxedCandidateTitle, relaxedTargetTitle);

      if (relaxedCandidateTitle === relaxedTargetTitle) {
        score += 35;
      } else if (
        relaxedCandidateTitle.includes(relaxedTargetTitle) ||
        relaxedTargetTitle.includes(relaxedCandidateTitle)
      ) {
        score += 20;
      }

      if (relaxedSimilarity > 0.75) {
        score += Math.floor(relaxedSimilarity * 30);
      }

      if (targetYear && candidateYear && targetYear === candidateYear) {
        score += 25;
      }

      return { candidate, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.score > 0 ? scored[0].candidate : candidates[0];
  }

  detectServer(value) {
    const lower = String(value || "").toLowerCase();

    if (lower.includes("dood")) return "doodstream";
    if (lower.includes("dwish") || lower.includes("streamwish")) return "streamwish";
    if (lower.includes("streamtape")) return "streamtape";
    if (lower.includes("voe")) return "voe";
    if (lower.includes("uqload")) return "uqload";
    if (lower.includes("vudeo")) return "vudeo";
    return lower || "generic";
  }

  detectLanguage(serverText, imageSrc) {
    if (imageSrc.includes("lat") || /latino/i.test(serverText)) {
      return "[LAT]";
    }
    if (imageSrc.includes("esp") || /castellano|español|espanol/i.test(serverText)) {
      return "[CAST]";
    }
    if (imageSrc.includes("subesp") || /subtitulado|sub|vose/i.test(serverText)) {
      return "[VOSE]";
    }
    return "";
  }

  extractTitle(html) {
    return this.cleanText(
      this.extractFirstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || this.extractFirstMatch(html, /<title>([^<]+)<\/title>/i)
      || this.extractFirstMatch(html, /<h1[^>]*>([^<]+)<\/h1>/i)
    );
  }

  extractDescription(html) {
    return this.cleanText(
      this.extractFirstMatch(html, /<div[^>]+class="[^"]*\bfull_content-desc\b[^"]*"[\s\S]*?<p[^>]*><span[^>]*>([\s\S]*?)<\/span>/i)
    );
  }

  extractGenres(html) {
    return Array.from(
      html.matchAll(/<li[^>]+class="[^"]*\bvis\b[^"]*"[\s\S]*?Genre:\s*<\/span>\s*<a[^>]*>([^<]+)<\/a>/gi),
      (match) => this.cleanText(this.decodeHtmlEntities(match[1]))
    ).filter(Boolean);
  }

  extractDirector(html) {
    return this.cleanText(
      this.extractFirstMatch(html, /<li[^>]+class="[^"]*\bvis\b[^"]*"[\s\S]*?Director:\s*<\/span>\s*<a[^>]*>([^<]+)<\/a>/i)
    );
  }

  extractSeriesPathFromSeasonPath(path) {
    return this.extractSeriesPath(String(path || "").replace(/\/temporada-\d+\/?$/i, "/"));
  }

  normalizePath(value) {
    try {
      const parsed = new URL(value, this.baseUrl);
      return parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    } catch {
      return null;
    }
  }

  pathToSlug(path) {
    return String(path || "")
      .split("/")
      .filter(Boolean)
      .at(-1) || "";
  }

  unslugify(value) {
    return String(value || "")
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
      .trim();
  }

  extractSeriesPath(path) {
    const normalized = this.normalizePath(path);
    if (!normalized) {
      return null;
    }

    const match = normalized.match(/(\/series\/[^/]+\/)/i);
    return match?.[1] || null;
  }

  encodePathToken(path) {
    return Buffer.from(String(path || ""), "utf-8").toString("base64url");
  }

  decodePathToken(value) {
    const raw = String(value || "");

    if (raw.startsWith("/")) {
      return raw;
    }

    try {
      return Buffer.from(raw, "base64url").toString("utf-8");
    } catch {
      return raw;
    }
  }

  toAbsoluteUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return null;
    }

    try {
      return new URL(raw, this.baseUrl).toString();
    } catch {
      return null;
    }
  }

  buildCookieHeader(response) {
    const cookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];

    return cookies
      .map((cookie) => String(cookie).split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
  }

  dedupeById(items) {
    return Array.from(new Map(items.map((item) => [item.id, item])).values());
  }

  dedupeEpisodeVideos(videos) {
    return Array.from(
      new Map(
        videos.map((video) => [`${video.season}:${video.episode}:${video.id}`, video])
      ).values()
    );
  }

  extractOgValue(html, property) {
    const safeProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return this.decodeHtmlEntities(
      this.extractFirstMatch(
        html,
        new RegExp(`<meta[^>]+property=["']${safeProperty}["'][^>]+content=["']([^"']+)["']`, "i")
      )
    );
  }

  extractFirstMatch(text, pattern) {
    return pattern.exec(String(text || ""))?.[1] || "";
  }

  stripTags(value) {
    return String(value || "").replace(/<[^>]+>/g, " ");
  }

  decodeHtmlEntities(value) {
    return String(value || "")
      .replaceAll("&amp;", "&")
      .replaceAll("&quot;", "\"")
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&nbsp;", " ");
  }

  cleanText(value) {
    return this.decodeHtmlEntities(this.stripTags(value))
      .replace(/\s+/g, " ")
      .trim();
  }

  cleanSeriesTitle(value) {
    return this.cleanText(value)
      .replace(/^ver\s+/i, "")
      .replace(/\|\s*verseriesonline.*$/i, "")
      .replace(/\(\d{4}\)\s*$/i, "")
      .trim();
  }

  sanitizeEpisodeName(value) {
    const cleaned = this.cleanText(value);
    if (!cleaned || cleaned.includes("${")) {
      return "";
    }
    return cleaned;
  }

  normalizeTitle(value) {
    return String(value || "")
      .normalize("NFD")
      .replaceAll(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, " ")
      .trim();
  }

  relaxTitle(value) {
    return String(value || "")
      .replace(/\b(the|a|an)\b/g, " ")
      .replace(/\b(temporada|season|serie|series)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  extractYear(value) {
    const match = String(value || "").match(/\b(19|20)\d{2}\b/);
    return match?.[0] || "";
  }

  levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = Array(b.length + 1)
      .fill(null)
      .map(() => Array(a.length + 1).fill(null));

    for (let i = 0; i <= a.length; i += 1) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j += 1) matrix[j][0] = j;

    for (let j = 1; j <= b.length; j += 1) {
      for (let i = 1; i <= a.length; i += 1) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    return matrix[b.length][a.length];
  }

  stringSimilarity(a, b) {
    const left = String(a || "");
    const right = String(b || "");
    const longer = left.length > right.length ? left : right;
    const shorter = left.length > right.length ? right : left;

    if (longer.length === 0) {
      return 1;
    }

    return (longer.length - this.levenshtein(longer, shorter)) / longer.length;
  }

  async fetchText(url) {
    const response = await this.fetchTextResponse(url);
    return response.text;
  }

  async fetchTextResponse(url) {
    let response;

    try {
      response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
    } catch (error) {
      const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new Error(`No se pudo conectar con VerSeriesOnline en ${url}. ${details}`);
    }

    if (!response.ok) {
      throw new Error(`VerSeriesOnline respondio ${response.status} para ${url}`);
    }

    return {
      response,
      text: await response.text()
    };
  }

  async fetchJson(url) {
    let response;

    try {
      response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "application/json,text/plain;q=0.9,*/*;q=0.8"
        }
      });
    } catch (error) {
      const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new Error(`No se pudo obtener JSON desde ${url}. ${details}`);
    }

    if (!response.ok) {
      throw new Error(`JSON respondio ${response.status} para ${url}`);
    }

    return response.json();
  }

  async fetchCinemetaMeta(type, externalId) {
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${externalId}.json`;

    try {
      const payload = await this.fetchJson(url);
      return payload?.meta || null;
    } catch {
      return null;
    }
  }
}
