import { buildStremioId } from "../../../lib/ids.js";
import { buildStream, resolveExtractorStream } from "../../../lib/extractors.js";
import { markSourceFailure, markSourceSuccess } from "../../../lib/penalty-reliability.js";
import { analyzeScoredStreams, scoreAndSelectStreams } from "../scoring.js";
import { fetchJson as sharedFetchJson, fetchText as sharedFetchText } from "../../../lib/webstreamer/http.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

export class CinecalidadProvider extends WebstreamBaseProvider {
  constructor() {
    super({
      id: "cinecalidad",
      name: "CineCalidad",
      supportedTypes: ["movie", "series", "anime", "other"]
    });

    this.baseUrl = process.env.CINECALIDAD_BASE_URL || "https://www.cinecalidad.vg";
  }

  async search({ type, query }) {
    if (!query?.trim()) {
      return [];
    }

    const url = `${this.baseUrl}/page/1/?s=${encodeURIComponent(query.trim())}`;
    const html = await this.fetchText(url);
    const items = this.extractSearchItems(html, type);
    return items;
  }

  async getMeta({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const page = await this.fetchResolvedPage(target);
    const html = page.html;

    const title = this.extractOgValue(html, "og:title")
      || this.extractFirstMatch(html, /<title>([^<]+)<\/title>/i)
      || this.unslugify(target.primarySlug);
    const poster = this.extractImageFromSingleLeft(html) || this.extractOgValue(html, "og:image") || null;
    const background = this.extractOgValue(html, "og:image") || poster;
    const description = this.extractDescription(html);
    const genre = this.extractField(html, "Género") || this.extractField(html, "Genero") || "";
    const author = this.extractField(html, "Creador") || "";
    const artist = this.extractField(html, "Elenco") || "";
    const videos = target.type === "series"
      ? this.buildEpisodeVideos(html)
      : [];

    return {
      id: target.id,
      type: target.type,
      name: this.cleanTitle(title),
      poster,
      background,
      description,
      genres: genre ? genre.split(",").map((item) => item.trim()).filter(Boolean) : [],
      cast: [author, artist].filter(Boolean),
      videos
    };
  }

  async getStreams({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const page = await this.fetchResolvedPage(target);
    const html = page.html;
    const players = (await this.extractPlayerLinksFromHtml(html))
      .filter((player) => this.isSourceEnabled(player.server));

    let httpStreams = [];
    if (players.length) {
      const streamGroups = await Promise.all(
        players.map((player) => this.resolvePlayerStream(player))
      );

      const rawStreams = streamGroups.flat().filter(Boolean);
      const displayTitle = this.extractDisplayTitleFromPage(target, html);
      httpStreams = this.sortStreams(this.attachDisplayTitle(rawStreams, displayTitle));
    }

    return httpStreams;
  }

  async getStreamsFromExternalId({ type, externalId }) {
    if (!externalId?.startsWith("tt")) {
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

    const typeCandidates = candidates.filter((candidate) => candidate.type === type);
    const validCandidates = typeCandidates.length > 0 ? typeCandidates : candidates;
    const bestMatch = this.pickBestCandidate(validCandidates, externalMeta);

    if (!bestMatch) {
      return [];
    }

    if (bestMatch._resolvedUrl) {
      return this.getStreamsFromResolvedUrl(bestMatch.type, bestMatch._resolvedUrl);
    }

    let slug = bestMatch.id.split(":").slice(2).join(":");

    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const seriesMeta = await this.getMeta({
        type: "series",
        slug
      });

      const matchingVideo = this.findMatchingEpisodeVideo(
        seriesMeta.videos || [],
        parsedExternal
      );

      if (!matchingVideo?.id) {
        return [];
      }

      slug = matchingVideo.id.split(":").slice(2).join(":");
    }

    return this.getStreams({
      type: bestMatch.type,
      slug
    });
  }

  async debugStreamsFromExternalId({ type, externalId }) {
    const debug = {
      provider: this.id,
      type,
      externalId,
      supported: externalId?.startsWith("tt") || false
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

    const typeCandidates = candidates.filter((candidate) => candidate.type === type);
    const validCandidates = typeCandidates.length > 0 ? typeCandidates : candidates;
    debug.validCandidates = validCandidates.map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      name: candidate.name,
      releaseInfo: candidate.releaseInfo || ""
    }));

    const bestMatch = this.pickBestCandidate(validCandidates, externalMeta);
    debug.bestMatch = bestMatch
      ? {
          id: bestMatch.id,
          type: bestMatch.type,
          name: bestMatch.name,
          releaseInfo: bestMatch.releaseInfo || "",
          resolvedUrl: bestMatch._resolvedUrl || null
        }
      : null;

    if (!bestMatch) {
      debug.status = "no_best_match";
      return debug;
    }

    if (bestMatch._resolvedUrl) {
      debug.targetUrl = bestMatch._resolvedUrl;

      const html = await this.fetchText(bestMatch._resolvedUrl);
      const players = (await this.extractPlayerLinksFromHtml(html))
        .filter((player) => this.isSourceEnabled(player.server));
      debug.playerCount = players.length;
      debug.players = players.map((player) => ({
        server: player.server,
        quality: player.quality,
        pageUrl: player.pageUrl
      }));

      if (!players.length) {
        debug.status = "no_players";
        return debug;
      }

      const streamGroups = await Promise.all(players.map((player) => this.resolvePlayerStream(player)));
      const rawStreams = streamGroups.flat().filter(Boolean);
      const scoredStreams = analyzeScoredStreams(this.id, rawStreams, {
        cleanTitle: (title) => this.cleanStreamTitle(title)
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

    let slug = bestMatch.id.split(":").slice(2).join(":");
    debug.seriesSlug = slug;

    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const seriesTarget = this.parseSlugPayload("series", slug);
      const seriesPage = await this.fetchResolvedPage(seriesTarget);
      const seriesHtml = seriesPage.html;
      const seriesMeta = await this.getMeta({
        type: "series",
        slug
      });

      debug.episodePatternDebug = {
        targetUrl: seriesPage.url,
        mark1Count: (seriesHtml.match(/class=['"][^'"]*\bmark-1\b/gi) || []).length,
        numerandoCount: (seriesHtml.match(/class=['"][^'"]*\bnumerando\b/gi) || []).length,
        episodioTitleCount: (seriesHtml.match(/class=['"][^'"]*\bepisodiotitle\b/gi) || []).length,
        temporadaPathCount: (seriesHtml.match(/\/temporada\/\d+\/episodio\/\d+/gi) || []).length,
        temporadaPathSample: Array.from(
          seriesHtml.matchAll(/[^"'\\s>]*\/ver-serie\/[^"'\\s>]*\/temporada\/\d+\/episodio\/\d+\/?/gi),
          (match) => match[0]
        ).slice(0, 10),
        numerandoSample: Array.from(
          seriesHtml.matchAll(/class=['"][^'"]*\bnumerando\b[^'"]*['"][^>]*>([^<]+)/gi),
          (match) => this.cleanText(match[1])
        ).slice(0, 10),
        episodiotitleSample: Array.from(
          seriesHtml.matchAll(/class=['"][^'"]*\bepisodiotitle\b[^'"]*['"][^>]*>[\s\S]{0,500}?<a[^>]*>([^<]+)/gi),
          (match) => this.cleanText(match[1])
        ).slice(0, 10)
      };

      debug.videoCount = (seriesMeta.videos || []).length;
      debug.videoSample = (seriesMeta.videos || []).slice(0, 20).map((video) => ({
        id: video.id,
        season: video.season,
        episode: video.episode,
        title: video.title
      }));

      const matchingVideo = this.findMatchingEpisodeVideo(
        seriesMeta.videos || [],
        parsedExternal
      );

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
    }

    const target = this.parseSlugPayload(type === "series" ? "series" : bestMatch.type, slug);
    const page = await this.fetchResolvedPage(target);
    debug.targetUrl = page.url;

    const html = page.html;
    const players = (await this.extractPlayerLinksFromHtml(html))
      .filter((player) => this.isSourceEnabled(player.server));
    debug.playerCount = players.length;
    debug.players = players.map((player) => ({
      server: player.server,
      quality: player.quality,
      pageUrl: player.pageUrl
    }));

    if (!players.length) {
      debug.status = "no_players";
      return debug;
    }

    const streamGroups = players.length > 0
      ? await Promise.all(players.map((player) => this.resolvePlayerStream(player)))
      : [];

    const rawStreams = streamGroups.flat().filter(Boolean);
    const scoredStreams = analyzeScoredStreams(this.id, rawStreams, {
      cleanTitle: (title) => this.cleanStreamTitle(title)
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

  async searchWithFallbackQueries({ type, externalMeta }) {
    const extraTitles = await this.fetchTmdbSearchTitles(type, externalMeta.id || "").catch(() => []);
    externalMeta._searchTitles = extraTitles;
    const deduped = new Map();
    const directCandidates = await this.probeDirectCandidates(type, externalMeta, extraTitles);

    for (const candidate of directCandidates) {
      if (!deduped.has(candidate.id)) {
        deduped.set(candidate.id, candidate);
      }
    }

    const searched = await super.searchWithFallbackQueries({ type, externalMeta });
    for (const candidate of searched) {
      if (!deduped.has(candidate.id)) {
        deduped.set(candidate.id, candidate);
      }
    }

    return Array.from(deduped.values());
  }

  buildSearchQueries(externalMeta) {
    return super.buildSearchQueries(externalMeta);
  }

  extractSearchItems(html, requestedType) {
    const items = [];
    const blockPatterns = [
      /<div[^>]*class="[^"]*\bitem\b[^"]*"[^>]*data-cf[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi,
      /<article[\s\S]*?<a[^>]+href="[^"]*\/ver-(?:pelicula|serie)\/[^"]+"[\s\S]*?<\/article>/gi,
      /<div[^>]*class="[^"]*\bcustom\b[^"]*"[\s\S]*?<a[^>]+href="[^"]*\/ver-(?:pelicula|serie)\/[^"]+"[\s\S]*?<\/a>[\s\S]*?<\/div>/gi
    ];

    for (const pattern of blockPatterns) {
      for (const match of html.matchAll(pattern)) {
        const mapped = this.mapSearchBlock(match[0], requestedType);
        if (mapped) {
          items.push(mapped);
        }
      }
    }

    if (items.length === 0) {
      const linkMatches = html.matchAll(/<a[^>]+href="([^"]*\/ver-(?:pelicula|serie)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
      for (const match of linkMatches) {
        const block = match[0];
        const mapped = this.mapSearchBlock(block, requestedType);
        if (mapped) {
          items.push(mapped);
        }
      }
    }

    return this.dedupeById(items);
  }

  mapSearchBlock(block, requestedType) {
    const href = this.decodeHtmlEntities(this.extractFirstMatch(block, /<a[^>]+href="([^"]+)"/i));
    const title = this.extractFirstMatch(block, /<img[^>]+alt="([^"]+)"/i)
      || this.extractFirstMatch(block, /title="([^"]+)"/i)
      || this.extractFirstMatch(block, /<h\d[^>]*>([^<]+)<\/h\d>/i);
    const thumbnail = this.decodeHtmlEntities(
      this.extractFirstMatch(block, /<img[^>]+data-src="([^"]+)"/i)
        || this.extractFirstMatch(block, /<img[^>]+src="([^"]+)"/i)
    );

    if (!href || !title) {
      return null;
    }

    const resolved = this.resolveTypeFromPath(href, requestedType);
    const slug = this.extractSlugFromUrl(href);

    if (!slug || !resolved) {
      return null;
    }

    if (!/\/ver-(pelicula|serie)\//i.test(href)) {
      return null;
    }

    if (/micinecalidad/i.test(slug)) {
      return null;
    }

    return {
      id: buildStremioId(this.id, resolved, slug),
      type: resolved,
      name: this.cleanTitle(this.decodeHtmlEntities(title)),
      poster: thumbnail || null,
      posterShape: "poster",
      description: "",
      genres: [],
      releaseInfo: ""
    };
  }

  extractSlugFromUrl(url) {
    try {
      const parsed = new URL(url, this.baseUrl);
      const parts = parsed.pathname.split("/").filter(Boolean);
      return parts.at(-1) || null;
    } catch {
      return null;
    }
  }

  resolveTypeFromPath(path, fallbackType) {
    const value = String(path || "").toLowerCase();

    if (value.includes("/ver-serie/")) {
      return "series";
    }

    if (value.includes("/ver-pelicula/")) {
      return fallbackType === "anime" || fallbackType === "other" ? fallbackType : "movie";
    }

    return fallbackType || "movie";
  }

  parseSlugPayload(type, slug) {
    if (type === "series" && slug.includes(":")) {
      const [episodeToken, seasonNumber, episodeNumber] = slug.split(":");
      return {
        id: buildStremioId(this.id, type, slug),
        type,
        primarySlug: episodeToken,
        seasonNumber,
        episodeNumber,
        url: this.buildEpisodePageUrl(episodeToken, seasonNumber, episodeNumber)
      };
    }

    return {
      id: buildStremioId(this.id, type, slug),
      type,
      primarySlug: slug,
      url: this.buildContentPageUrls(type, slug)[0],
      candidateUrls: this.buildContentPageUrls(type, slug)
    };
  }

  buildContentPageUrls(type, slug) {
    const normalizedSlug = String(slug || "").trim();
    if (type === "series") {
      return [
        `${this.baseUrl}/ver-serie/${normalizedSlug}/`,
        `${this.baseUrl}/serie/${normalizedSlug}/`
      ];
    }

    return [
      `${this.baseUrl}/ver-pelicula/${normalizedSlug}/`,
      `${this.baseUrl}/pelicula/${normalizedSlug}/`
    ];
  }

  async fetchResolvedPage(target) {
    const urls = Array.isArray(target?.candidateUrls) && target.candidateUrls.length > 0
      ? target.candidateUrls
      : [target.url].filter(Boolean);

    let lastError = null;
    for (const url of urls) {
      try {
        const html = await this.fetchText(url);
        return { url, html };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error(`No se pudo resolver la pagina para ${target?.primarySlug || "desconocido"}`);
  }

  async getStreamsFromResolvedUrl(type, url) {
    const html = await this.fetchText(url);
    const players = (await this.extractPlayerLinksFromHtml(html))
      .filter((player) => this.isSourceEnabled(player.server));

    if (!players.length) {
      return [];
    }

    const streamGroups = await Promise.all(players.map((player) => this.resolvePlayerStream(player)));
    const rawStreams = streamGroups.flat().filter(Boolean);
    const displayTitle = this.extractDisplayTitleFromPage({ type, primarySlug: this.extractSlugFromUrl(url) || "" }, html);
    return this.sortStreams(this.attachDisplayTitle(rawStreams, displayTitle));
  }

  buildEpisodePageUrl(token, seasonNumber, episodeNumber) {
    const normalized = String(token || "");

    if (normalized.startsWith("episode/")) {
      return `${this.baseUrl}/ver-el-episodio/${normalized.slice("episode/".length)}/`;
    }

    if (normalized.startsWith("series/")) {
      const baseSlug = normalized.slice("series/".length);
      return `${this.baseUrl}/ver-serie/${baseSlug}/temporada/${seasonNumber}/episodio/${episodeNumber}/`;
    }

    return `${this.baseUrl}/ver-el-episodio/${normalized}/`;
  }

  extractPlayerLinks(html) {
    const matches = html.matchAll(/<li[^>]+data-option="([^"]+)"[^>]*>/gi);
    const players = [];

    for (const match of matches) {
      const pageUrl = this.decodeHtmlEntities(match[1]);
      const server = this.detectServer(pageUrl);

      if (!pageUrl) {
        continue;
      }

      players.push({
        server,
        quality: "",
        pageUrl
      });
    }

    return players;
  }

  async extractPlayerLinksFromHtml(html) {
    const inlinePlayers = this.extractPlayerLinks(html);
    const base64Players = await this.extractBase64EmbedPlayers(html);
    return this.dedupePlayers([...inlinePlayers, ...base64Players]);
  }

  async extractBase64EmbedPlayers(html) {
    const encodedValues = Array.from(
      html.matchAll(/data-src="([A-Za-z0-9+/=]{20,})"/gi),
      (match) => match[1]
    );

    if (encodedValues.length === 0) {
      return [];
    }

    const decodedUrls = [...new Set(
      encodedValues
        .map((value) => this.decodeBase64(value))
        .filter((value) => value && /^https?:\/\//i.test(value))
    )];

    const players = [];
    const directUrls = decodedUrls.filter((url) => this.isKnownEmbedUrl(url));
    const intermediateUrls = decodedUrls.filter((url) => !this.isKnownEmbedUrl(url));

    for (const pageUrl of directUrls) {
      players.push({
        server: this.detectServer(pageUrl),
        quality: "",
        pageUrl
      });
    }

    if (intermediateUrls.length > 0) {
      const resolved = await Promise.all(intermediateUrls.map((url) => this.resolveIntermediateEmbedUrl(url)));
      for (const pageUrl of resolved.filter(Boolean)) {
        players.push({
          server: this.detectServer(pageUrl),
          quality: "",
          pageUrl
        });
      }
    }

    return players;
  }

  async resolveIntermediateEmbedUrl(url) {
    try {
      const html = await this.fetchText(url);
      const buttonHref = this.decodeHtmlEntities(
        this.extractFirstMatch(html, /id="btn_enlace"[^>]*>[\s\S]*?href="([^"]+)"/i)
      );
      if (buttonHref && /^https?:\/\//i.test(buttonHref)) {
        return buttonHref;
      }

      const iframeUrl = this.decodeHtmlEntities(
        this.extractFirstMatch(html, /<iframe[^>]+src="([^"]+)"/i)
      );
      if (iframeUrl && /^https?:\/\//i.test(iframeUrl)) {
        return iframeUrl;
      }

      if (/\/e\//i.test(url)) {
        return url;
      }
    } catch {
      return null;
    }

    return null;
  }

  isKnownEmbedUrl(url) {
    const lower = String(url || "").toLowerCase();
    return [
      "goodstream.one",
      "voe.sx",
      "filemoon.sx",
      "filemoon.to",
      "hlswish.com",
      "streamwish.com",
      "streamwish.to",
      "strwish.com",
      "vimeos.net"
    ].some((domain) => lower.includes(domain));
  }

  decodeBase64(value) {
    try {
      return Buffer.from(String(value || ""), "base64").toString("utf8");
    } catch {
      return "";
    }
  }

  dedupePlayers(players) {
    const seen = new Set();
    return players.filter((player) => {
      const key = `${player.server}:${player.pageUrl}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }
  extractFirstNumber(text, regex) {
    const match = String(text || "").match(regex);
    return match ? Number(match[1]) || 0 : 0;
  }
  detectServer(url) {
    const lower = String(url || "").toLowerCase();

    if (lower.includes("voe")) return "voe";
    if (lower.includes("vimeos")) return "vimeos";
    if (lower.includes("ok.ru") || lower.includes("okru")) return "okru";
    if (lower.includes("filemoon") || lower.includes("moonplayer")) return "filemoon";
    if (lower.includes("uqload")) return "uqload";
    if (lower.includes("mp4upload")) return "mp4upload";
    if (lower.includes("wishembed") || lower.includes("streamwish") || lower.includes("strwish") || lower.includes("wishfast") || lower.includes("hlswish")) return "streamwish";
    if (lower.includes("dood")) return "doodstream";
    if (lower.includes("streamlare")) return "streamlare";
    if (lower.includes("yourupload") || lower.includes("upload")) return "yourupload";
    if (lower.includes("burstcloud") || lower.includes("burst")) return "burstcloud";
    if (lower.includes("fastream")) return "fastream";
    if (lower.includes("upstream")) return "upstream";
    if (lower.includes("streamtape") || lower.includes("stp") || lower.includes("stape")) return "streamtape";
    if (lower.includes("ahvsh") || lower.includes("streamhide") || lower.includes("guccihide") || lower.includes("streamvid") || lower.includes("vidhide")) return "vidhide";
    if (lower.includes("goodstream")) return "goodstream";
    if (lower.includes("amazon") || lower.includes("amz")) return "amazon";

    return "desconocido";
  }

  async resolvePlayerStream(player) {
    const sourceKey = `${this.id}:${String(player.server || "generic").toLowerCase()}`;
    try {
      let directUrl = player.pageUrl;

      if (/player\.php\?h=/i.test(directUrl) || !/^https?:\/\//i.test(directUrl)) {
        return [];
      }

      if (player.server === "amazon") {
        return [];
      }

      const shouldProxy = true;
      const extracted = await resolveExtractorStream(directUrl, this.buildPlayerLabel(player), shouldProxy);

      if (extracted.length > 0) {
        markSourceSuccess(sourceKey);
        return extracted.map((stream) => ({
          ...stream,
          name: "CineCalidad",
          _sourceKey: sourceKey
        }));
      }

      if (/\.(m3u8|mp4)(\?|$)/i.test(directUrl)) {
        markSourceSuccess(sourceKey);
        return [
          buildStream("CineCalidad", this.buildPlayerLabel(player), directUrl, player.pageUrl, shouldProxy)
        ];
      }
    } catch {
      markSourceFailure(sourceKey);
      return [];
    }

    markSourceFailure(sourceKey);
    return [];
  }

  buildPlayerLabel(player) {
    return [player.server, player.quality].filter(Boolean).join(" ").trim();
  }

  sortStreams(streams) {
    return scoreAndSelectStreams(this.id, streams, {
      cleanTitle: (title) => this.cleanStreamTitle(title)
    });
  }

  attachDisplayTitle(streams, displayTitle) {
    const normalized = String(displayTitle || "").trim();
    if (!normalized) {
      return streams;
    }

    return streams.map((stream) => ({
      ...stream,
      _displayTitle: stream._displayTitle || normalized
    }));
  }

  extractDisplayTitleFromPage(target, html) {
    const pageTitle = this.cleanTitle(
      this.extractOgValue(html, "og:title")
      || this.extractFirstMatch(html, /<title>([^<]+)<\/title>/i)
      || this.unslugify(target?.primarySlug || "")
    );

    return pageTitle;
  }

  cleanStreamTitle(title) {
    return title
      .replace(/\s+/g, " ")
      .replace(/\bVidHide HLS\b/gi, "VidHide")
      .replace(/\bStreamWish HLS\b/gi, "StreamWish")
      .replace(/\bVoe HLS\b/gi, "Voe")
      .replace(/\bVoe MP4\b/gi, "Voe")
      .trim();
  }

  buildEpisodeVideos(html) {
    const videos = [];
    const seen = new Set();
    const blockPatterns = [
      /<div[^>]*class=['"][^'"]*\bmark-1\b[^'"]*['"][\s\S]{0,5000}?class=['"][^'"]*\bnumerando\b[^'"]*['"][^>]*>([^<]+)<[\s\S]{0,5000}?class=['"][^'"]*\bepisodiotitle\b[^'"]*['"][\s\S]{0,5000}?<a[^>]+href=['"]([^'"]+)['"][^>]*>([^<]+)<\/a>/gi,
      /<div[^>]*class=['"][^'"]*\bmark-1\b[^'"]*['"][\s\S]{0,5000}?class=['"][^'"]*\bepisodiotitle\b[^'"]*['"][\s\S]{0,5000}?<a[^>]+href=['"]([^'"]+)['"][^>]*>([^<]+)<\/a>[\s\S]{0,5000}?class=['"][^'"]*\bnumerando\b[^'"]*['"][^>]*>([^<]+)</gi
    ];

    for (const pattern of blockPatterns) {
      for (const match of html.matchAll(pattern)) {
        const isFirstPattern = pattern === blockPatterns[0];
        const numerando = this.cleanText(isFirstPattern ? match[1] : match[3]);
        const href = this.decodeHtmlEntities(isFirstPattern ? match[2] : match[1]);
        const explicitTitle = this.cleanText(this.decodeHtmlEntities(isFirstPattern ? match[3] : match[2]));
        const parsed = this.parseEpisodeHref(href, numerando);

        if (!parsed) {
          continue;
        }

        const key = `${parsed.token}:${parsed.season}:${parsed.episode}`;
        if (seen.has(key)) {
          continue;
        }

        const seasonEpisode = numerando.match(/^S(\d+)-E(\d+)$/i);
        const title = explicitTitle
          ? seasonEpisode
            ? `T${seasonEpisode[1]} - E${seasonEpisode[2]} - ${explicitTitle}`
            : explicitTitle
          : `T${parsed.season} E${parsed.episode}`;

        videos.push({
          id: buildStremioId(this.id, "series", key),
          title,
          season: parsed.season,
          episode: parsed.episode,
          thumbnail: null
        });
        seen.add(key);
      }
    }

    const linkMatches = html.matchAll(/<a[^>]+href=['"]([^'"]*\/ver-serie\/[^'"]*\/temporada\/\d+\/episodio\/\d+\/?)['"][^>]*>([\s\S]*?)<\/a>/gi);

    for (const match of linkMatches) {
      const href = this.decodeHtmlEntities(match[1]);
      const anchorHtml = match[2] || "";
      const surroundingBlock = match[0];
      const parsed = this.parseEpisodeHref(href, surroundingBlock);

      if (!parsed) {
        continue;
      }

      const key = `${parsed.token}:${parsed.season}:${parsed.episode}`;
      if (seen.has(key)) {
        continue;
      }

      const title = this.extractEpisodeTitle(anchorHtml, surroundingBlock, parsed);

      videos.push({
        id: buildStremioId(this.id, "series", key),
        title,
        season: parsed.season,
        episode: parsed.episode,
        thumbnail: this.extractFirstMatch(anchorHtml, /<img[^>]+(?:data-src|src)="([^"]+)"/i) || null
      });
      seen.add(key);
    }

    if (videos.length === 0) {
      const urlMatches = html.matchAll(/https?:\/\/[^"' ]+\/ver-serie\/[^"' ]+\/temporada\/\d+\/episodio\/\d+\/?/gi);
      for (const match of urlMatches) {
        const href = this.decodeHtmlEntities(match[0]);
        const parsed = this.parseEpisodeHref(href, "");

        if (!parsed) {
          continue;
        }

        const key = `${parsed.token}:${parsed.season}:${parsed.episode}`;
        if (seen.has(key)) {
          continue;
        }

        videos.push({
          id: buildStremioId(this.id, "series", key),
          title: `T${parsed.season} E${parsed.episode}`,
          season: parsed.season,
          episode: parsed.episode,
          thumbnail: null
        });
        seen.add(key);
      }
    }

    if (videos.length === 0) {
      const altEpisodeLinks = html.matchAll(/<a[^>]+href=['"]([^'"]*\/ver-el-episodio\/[^'"]+\/?)['"][^>]*>([\s\S]*?)<\/a>/gi);
      for (const match of altEpisodeLinks) {
        const href = this.decodeHtmlEntities(match[1]);
        const anchorHtml = match[2] || "";
        const parsed = this.parseEpisodeHref(href, anchorHtml);

        if (!parsed) {
          continue;
        }

        const key = `${parsed.token}:${parsed.season}:${parsed.episode}`;
        if (seen.has(key)) {
          continue;
        }

        videos.push({
          id: buildStremioId(this.id, "series", key),
          title: this.extractEpisodeTitle(anchorHtml, anchorHtml, parsed),
          season: parsed.season,
          episode: parsed.episode,
          thumbnail: this.extractFirstMatch(anchorHtml, /<img[^>]+(?:data-src|src)=['"]([^'"]+)['"]/i) || null
        });
        seen.add(key);
      }
    }

    return videos.reverse();
  }

  extractEpisodeTitle(anchorHtml, surroundingBlock, parsed) {
    const numerando = this.cleanText(
      this.extractFirstMatch(surroundingBlock, /<div[^>]*class="[^"]*\bnumerando\b[^"]*"[^>]*>([^<]+)<\/div>/i)
    );
    const explicit = this.cleanText(
      this.extractFirstMatch(surroundingBlock, /<div[^>]*class="[^"]*\bepisodiotitle\b[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)
        || this.stripTags(anchorHtml)
    );

    if (explicit) {
      const seasonEpisode = numerando.match(/^S(\d+)-E(\d+)$/i);
      if (seasonEpisode) {
        return `T${seasonEpisode[1]} - E${seasonEpisode[2]} - ${explicit}`;
      }

      return explicit;
    }

    return `T${parsed.season} E${parsed.episode}`;
  }

  parseEpisodeHref(url, fallbackText = "") {
    try {
      const parsed = new URL(url, this.baseUrl);
      const parts = parsed.pathname.split("/").filter(Boolean);
      let token = "";
      let season = 0;
      let episode = 0;

      const serieIndex = parts.findIndex((part) => part === "ver-serie");
      if (serieIndex !== -1 && parts[serieIndex + 1]) {
        const slug = parts[serieIndex + 1];
        const seasonIdx = parts.findIndex((part) => part === "temporada");
        const episodeIdx = parts.findIndex((part) => part === "episodio");

        season = Number(parts[seasonIdx + 1]);
        episode = Number(parts[episodeIdx + 1]);
        token = `series/${slug}`;
      }

      const directEpisodeIndex = parts.findIndex((part) => part === "ver-el-episodio");
      if (directEpisodeIndex !== -1 && parts[directEpisodeIndex + 1]) {
        token = `episode/${parts[directEpisodeIndex + 1]}`;
      }

      if (!season || !episode) {
        const fallbackSource = this.cleanText(this.stripTags(fallbackText));
        const match = String(fallbackSource).match(/S(\d+)-E(\d+)/i);
        if (match) {
          season = Number(match[1]);
          episode = Number(match[2]);
        }
      }

      if (!season || !episode) {
        const tokenMatch = String(token).match(/(\d+)x(\d+)/i);
        if (tokenMatch) {
          season = Number(tokenMatch[1]);
          episode = Number(tokenMatch[2]);
        }
      }

      if (!token || !season || !episode) {
        return null;
      }

      return { token, season, episode };
    } catch {
      return null;
    }
  }

  findMatchingEpisodeVideo(videos, parsedExternal) {
    const season = Number(parsedExternal.season);
    const episode = Number(parsedExternal.episode);

    const exact = videos.find((video) =>
      Number(video.season) === season &&
      Number(video.episode) === episode
    );

    if (exact) {
      return exact;
    }

    const uniqueSeasons = new Set(videos.map((video) => Number(video.season)));
    if (uniqueSeasons.size === 1 || season === 1) {
      const episodeOnly = videos.find((video) => Number(video.episode) === episode);
      if (episodeOnly) {
        return episodeOnly;
      }
    }

    const ordered = [...videos].sort((a, b) => {
      const seasonDiff = Number(a.season) - Number(b.season);
      if (seasonDiff !== 0) return seasonDiff;
      return Number(a.episode) - Number(b.episode);
    });

    const seasonBlock = ordered.filter((video) => Number(video.season) === season);
    if (seasonBlock.length >= episode) {
      return seasonBlock[episode - 1];
    }

    if (ordered.length >= episode) {
      return ordered[episode - 1];
    }

    return null;
  }

  parseExternalStremioId(type, externalId) {
    return super.parseExternalStremioId(type, externalId);
  }

  pickBestCandidate(candidates, externalMeta) {
    const directMatches = candidates.filter((candidate) => candidate?._directPathMatch);
    if (directMatches.length === 1) {
      return directMatches[0];
    }

    if (directMatches.length > 0) {
      const directBest = super.pickBestCandidate(directMatches, externalMeta);
      if (directBest) {
        return directBest;
      }
    }

    return super.pickBestCandidate(candidates, externalMeta);
  }

  async probeDirectCandidates(type, externalMeta, extraTitles = []) {
    const year = this.extractYear(externalMeta.releaseInfo || externalMeta.year || "");
    const sections = type === "series"
      ? ["serie", "ver-serie"]
      : ["pelicula", "ver-pelicula"];
    const titleCandidates = [
      externalMeta.name,
      ...(Array.isArray(extraTitles) ? extraTitles : [])
    ];
    const slugCandidates = [];
    const directMatches = [];

    for (const title of titleCandidates) {
      const slug = this.slugifyTitle(title);
      if (!slug) {
        continue;
      }

      slugCandidates.push(slug);
      slugCandidates.push(this.stripLeadingArticleSlug(slug));

      if (year) {
        slugCandidates.push(`${slug}-${year}`);
        slugCandidates.push(`${this.stripLeadingArticleSlug(slug)}-${year}`);
      }
    }

    for (const slug of [...new Set(slugCandidates.filter(Boolean))]) {
      for (const section of sections) {
        const targetUrl = `${this.baseUrl}/${section}/${slug}/`;

        try {
          const html = await this.fetchText(targetUrl);
          const pageTitle = this.cleanTitle(
            this.extractOgValue(html, "og:title")
            || this.extractFirstMatch(html, /<title>([^<]+)<\/title>/i)
          );

          if (!pageTitle) {
            continue;
          }

          const mapped = {
            id: buildStremioId(this.id, type, slug),
            type,
            name: pageTitle,
            poster: this.extractImageFromSingleLeft(html) || this.extractOgValue(html, "og:image") || null,
            posterShape: "poster",
            description: this.extractDescription(html),
            genres: [],
            releaseInfo: this.extractYear(pageTitle) || this.extractYear(
              this.extractFirstMatch(html, /<title>([^<]+)<\/title>/i)
            ) || "",
            _directPathMatch: true,
            _resolvedUrl: targetUrl
          };

          directMatches.push(mapped);
        } catch {
          // Ignore direct slug misses.
        }
      }
    }

    return this.dedupeById(directMatches);
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

  extractDescription(html) {
    const tableBlock = this.extractFirstMatch(
      html,
      /<div[^>]*class="[^"]*\bsingle_left\b[^"]*"[\s\S]*?<table[\s\S]*?<\/table>/i
    ) || "";

    const paragraphs = Array.from(
      tableBlock.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi),
      (match) => this.cleanText(this.stripTags(match[1]))
    ).filter(Boolean);

    const firstParagraph = paragraphs.find((text) => !/^(género|genero|creador|elenco|títulos|titulos)\s*:/i.test(text));
    return firstParagraph ? firstParagraph.split(/Títulos:|Titulos:/i)[0].trim() : "";
  }

  extractField(html, label) {
    const regex = new RegExp(`${label}\\s*:\\s*([^<\\n]+)`, "i");
    const block = this.extractFirstMatch(
      html,
      /<div[^>]*class="[^"]*\bsingle_left\b[^"]*"[\s\S]*?<table[\s\S]*?<\/table>/i
    ) || "";
    return this.cleanText(this.decodeHtmlEntities(this.extractFirstMatch(block, regex) || ""));
  }

  extractImageFromSingleLeft(html) {
    const block = this.extractFirstMatch(
      html,
      /<div[^>]*class="[^"]*\bsingle_left\b[^"]*"[\s\S]*?<table[\s\S]*?<\/table>/i
    ) || "";

    return this.extractFirstMatch(block, /<img[^>]+data-src="([^"]+)"/i)
      || this.extractFirstMatch(block, /<img[^>]+src="([^"]+)"/i)
      || null;
  }

  extractOgValue(html, property) {
    return this.extractFirstMatch(
      html,
      new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i")
    );
  }

  extractFirstMatch(text, regex) {
    const match = String(text || "").match(regex);
    return match?.[1] || match?.[0] || "";
  }

  stripTags(value) {
    return String(value || "").replace(/<[^>]+>/g, " ");
  }

  cleanText(value) {
    return this.decodeHtmlEntities(this.stripTags(value))
      .replace(/\s+/g, " ")
      .trim();
  }

  cleanTitle(value) {
    return this.cleanText(
      String(value || "")
        .replace(/^\s*o\s+descargar\s+/i, "")
        .replace(/^\s*descargar\s+/i, "")
        .replace(/\s*[\|\-]\s*CineCalidad.*$/i, "")
        .replace(/^ver\s+/i, "")
        .replace(/\s+online(?:\s+gratis)?(?:\s+hd)?$/i, "")
        .replace(/\s+gratis(?:\s+hd)?$/i, "")
        .replace(/\s+hd$/i, "")
    );
  }

  slugifyTitle(value) {
    return this.cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  stripLeadingArticleSlug(value) {
    return String(value || "").replace(/^(el|la|los|las|un|una)-/i, "");
  }

  extractYear(value) {
    return String(value || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
  }

  decodeHtmlEntities(value) {
    return String(value || "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&ntilde;/g, "ñ")
      .replace(/&Ntilde;/g, "Ñ")
      .replace(/&aacute;/g, "á")
      .replace(/&eacute;/g, "é")
      .replace(/&iacute;/g, "í")
      .replace(/&oacute;/g, "ó")
      .replace(/&uacute;/g, "ú")
      .replace(/&Aacute;/g, "Á")
      .replace(/&Eacute;/g, "É")
      .replace(/&Iacute;/g, "Í")
      .replace(/&Oacute;/g, "Ó")
      .replace(/&Uacute;/g, "Ú")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  }

  unslugify(value) {
    return String(value || "")
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  dedupeById(items) {
    const seen = new Set();
    return items.filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }

      seen.add(item.id);
      return true;
    });
  }

  async fetchText(url) {
    try {
      return await sharedFetchText(url, {
        headers: {
          Referer: this.baseUrl,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
    } catch (error) {
      const details = error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
      throw new Error(`No se pudo conectar con CineCalidad en ${url}. ${details}`);
    }
  }

  async fetchJson(url) {
    try {
      return await sharedFetchJson(url, {
        headers: {
          Referer: this.baseUrl,
          Accept: "application/json,text/plain;q=0.9,*/*;q=0.8"
        }
      });
    } catch (error) {
      const details = error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
      throw new Error(`No se pudo obtener JSON desde ${url}. ${details}`);
    }
  }

  async fetchCinemetaMeta(type, externalId) {
    return super.fetchCinemetaMeta(type, externalId);
  }
}


