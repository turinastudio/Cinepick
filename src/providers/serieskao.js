import crypto from "node:crypto";
import { buildStremioId } from "../lib/ids.js";
import { buildStream, resolveExtractorStream } from "../lib/extractors.js";
import { markSourceFailure, markSourceSuccess } from "../lib/penalty-reliability.js";
import { analyzeScoredStreams, scoreAndSelectStreams } from "../lib/stream-scoring.js";
import { Provider } from "./base.js";

const AES_KEY = "Ak7qrvvH4WKYxV2OgaeHAEg2a5eh16vE";
const DATA_LINK_REGEX = /dataLink\s*=\s*([^;]+);/is;
const VIDEO_SOURCES_REGEX = /var\s+videoSources\s*=\s*\[(.+?)]\s*;/is;
const SOURCE_URL_REGEX = /['"]([^'"]+)['"]/g;

export class SerieskaoProvider extends Provider {
  constructor() {
    super({
      id: "serieskao",
      name: "SeriesKao",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.SERIESKAO_BASE_URL || "https://serieskao.top";
  }

  async search({ type, query }) {
    if (!query?.trim()) {
      return [];
    }

    const html = await this.fetchText(`${this.baseUrl}/search?s=${encodeURIComponent(query.trim())}&page=1`);
    const items = [];

    for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*\/(?:pelicula|serie|anime|animes|dorama)\/[^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)) {
      const mapped = this.mapSearchAnchor(match[0], type);
      if (mapped) {
        items.push(mapped);
      }
    }

    return this.dedupeById(items);
  }

  async getMeta({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const html = await this.fetchText(target.url);
    const resolvedType = this.resolveTypeFromPath(target.path, type);
    const videos = resolvedType === "series" && !target.isEpisode
      ? this.buildEpisodeVideos(html, target.path)
      : [];

    return {
      id: buildStremioId(this.id, resolvedType, target.slug),
      type: resolvedType,
      name: this.extractTitle(html) || this.unslugify(target.primarySlug),
      poster: this.extractPoster(html),
      background: this.extractPoster(html),
      description: this.extractDescription(html),
      genres: this.extractGenres(html),
      cast: [],
      videos
    };
  }

  async getStreams({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const html = await this.fetchText(target.url);
    const sourcePages = this.extractVideoSourcePages(html);

    if (!sourcePages.length) {
      return [];
    }

    const streamGroups = await Promise.all(
      sourcePages.map((pageUrl) => this.resolveSourcePage(pageUrl, target.url))
    );

    return this.sortStreams(streamGroups.flat().filter(Boolean));
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

    let slug = bestMatch.id.split(":").slice(2).join(":");

    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const seriesMeta = await this.getMeta({ type: "series", slug });
      const matchingVideo = this.findMatchingEpisodeVideo(seriesMeta.videos || [], parsedExternal);
      if (!matchingVideo?.id) {
        return [];
      }
      slug = matchingVideo.id.split(":").slice(2).join(":");
    }

    return this.getStreams({ type: bestMatch.type, slug });
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
          releaseInfo: bestMatch.releaseInfo || ""
        }
      : null;

    if (!bestMatch) {
      debug.status = "no_best_match";
      return debug;
    }

    let slug = bestMatch.id.split(":").slice(2).join(":");
    debug.seriesSlug = slug;

    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
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
    }

    const target = this.parseSlugPayload(type, slug);
    debug.targetUrl = target.url;

    const html = await this.fetchText(target.url);
    const sourcePages = this.extractVideoSourcePages(html);
    debug.playerCount = sourcePages.length;
    debug.players = sourcePages.map((pageUrl) => ({
      server: this.detectServer(pageUrl),
      pageUrl
    }));

    if (!sourcePages.length) {
      debug.status = "no_players";
      return debug;
    }

    const streamGroups = await Promise.all(
      sourcePages.map((pageUrl) => this.resolveSourcePage(pageUrl, target.url))
    );
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

  async debugInternalStreams({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const html = await this.fetchText(target.url);

    if (this.resolveTypeFromPath(target.path, type) === "series" && !target.isEpisode) {
      const videos = this.buildEpisodeVideos(html, target.path);
      return {
        targetUrl: target.url,
        resolvedType: "series",
        seasonTabCount: (html.match(/data-tab=/gi) || []).length,
        episodeItemCount: (html.match(/episode-item/gi) || []).length,
        videoCount: videos.length,
        videoSample: videos.slice(0, 20).map((video) => ({
          id: video.id,
          title: video.title,
          season: video.season,
          episode: video.episode
        })),
        status: videos.length > 0 ? "ok" : "no_episode_matches"
      };
    }

    const sourcePages = this.extractVideoSourcePages(html);
    const debugPages = await Promise.all(
      sourcePages.map(async (pageUrl) => {
        try {
          const pageHtml = await this.fetchText(pageUrl, {
            Referer: target.url
          });
          const parsedLinks = this.extractNewExtractorLinks(pageHtml, pageHtml);
          const streams = await this.resolveSourcePage(pageUrl, target.url);
          return {
            pageUrl,
            parsedLinkCount: parsedLinks.length,
            parsedLinkSample: parsedLinks.slice(0, 10).map(([url, language]) => ({ url, language })),
            streamCount: streams.length,
            streamSample: streams.slice(0, 3).map((stream) => ({
              title: stream.title,
              url: stream.url || null
            }))
          };
        } catch (error) {
          return {
            pageUrl,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      })
    );

    return {
      targetUrl: target.url,
      resolvedType: this.resolveTypeFromPath(target.path, type),
      playerCount: sourcePages.length,
      players: debugPages,
      status: sourcePages.length > 0 ? "ok" : "no_players"
    };
  }

  mapSearchAnchor(block, requestedType) {
    const href = this.extractFirstMatch(block, /href=["']([^"']+)["']/i);
    const path = this.normalizePath(href);
    if (!path) {
      return null;
    }

    const type = this.resolveTypeFromPath(path, requestedType);
    if (!type) {
      return null;
    }

    if (requestedType && type !== requestedType) {
      return null;
    }

    if (/(?:^|\/)(?:animes?|series?|doramas?|peliculas?)\/(?:populares?|popular|recientes?|latest)\/?$/i.test(path)) {
      return null;
    }

    const title = this.cleanText(
      this.extractFirstMatch(block, /<[^>]+class=["'][^"']*\bposter-card__title\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)
      || this.extractFirstMatch(block, /<img[^>]+alt=["']([^"']+)["']/i)
      || this.extractFirstMatch(block, /<img[^>]+title=["']([^"']+)["']/i)
      || this.extractFirstMatch(block, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
      || this.extractFirstMatch(block, /<span[^>]+class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
      || this.extractFirstMatch(block, /<div[^>]+class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
      || this.extractAttribute(block, "title")
      || this.cleanText(block)
    );
    const image = this.extractFirstMatch(block, /<img[^>]+(?:src|data-src)=["']([^"']+)["']/i);

    if (!title) {
      return null;
    }

    return {
      id: buildStremioId(this.id, type, this.encodePathToken(path)),
      type,
      name: title.replace(/^VER\s+/i, "").trim(),
      poster: this.toAbsoluteUrl(image)?.replace("/w154/", "/w500/") || null,
      posterShape: "poster",
      description: "",
      genres: [],
      releaseInfo: ""
    };
  }

  buildEpisodeVideos(html, seriesPath) {
    const seasonTabs = Array.from(
      html.matchAll(/<a\b[^>]*data-tab=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi),
      (match) => ({
        seasonId: match[1],
        seasonNumber: Number(this.cleanText(match[0]).match(/\d+/)?.[0] || match[1].match(/\d+/)?.[0] || 1)
      })
    );

    if (seasonTabs.length === 0) {
      return this.sortEpisodeVideos(this.extractEpisodeItems(html, 1, seriesPath));
    }

    const videos = [];
    for (const tab of seasonTabs) {
      const seasonHtml = this.extractSeasonPane(html, tab.seasonId, seasonTabs.map((item) => item.seasonId));
      videos.push(...this.extractEpisodeItems(seasonHtml, tab.seasonNumber, seriesPath));
    }

    return this.sortEpisodeVideos(videos);
  }

  extractEpisodeItems(html, seasonNumber, seriesPath) {
    const episodes = [];

    for (const match of html.matchAll(/<a\b[^>]*class=["'][^"']*\bepisode-item\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)) {
      const block = match[0];
      const episodePath = this.normalizePath(this.extractFirstMatch(block, /href=["']([^"']+)["']/i));
      if (!episodePath) {
        continue;
      }

      const episodeBlock = block;
      const episodeNumber = Number(
        this.cleanText(this.extractFirstMatch(episodeBlock, /<[^>]+class=["'][^"']*\bepisode-number\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)).match(/\d+/)?.[0]
        || episodePath.match(/(?:episodio|episode)[-_]?(\d+)/i)?.[1]
        || episodePath.match(/[-_/](\d+)(?:\/)?$/)?.[1]
        || 0
      );
      const episodeTitle = this.cleanText(
        this.extractFirstMatch(episodeBlock, /<[^>]+class=["'][^"']*\bepisode-title\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)
      ) || `Episodio ${episodeNumber || "?"}`;

      episodes.push({
        id: buildStremioId(
          this.id,
          "series",
          `ep:${this.encodePathToken(episodePath)}:${seasonNumber}:${episodeNumber}:${this.encodePathToken(seriesPath)}`
        ),
        title: `T${seasonNumber} - Episodio ${episodeNumber}: ${episodeTitle}`,
        season: seasonNumber,
        episode: episodeNumber
      });
    }

    return episodes;
  }

  extractSeasonPane(html, seasonId, allSeasonIds = []) {
    const escapedId = String(seasonId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const otherIds = allSeasonIds
      .filter((id) => id && id !== seasonId)
      .map((id) => String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const boundary = otherIds.length > 0 ? `(?=<[^>]+id=["'](?:${otherIds.join("|")})["'])` : "$";
    const regex = new RegExp(`<[^>]+id=["']${escapedId}["'][^>]*>([\\s\\S]*?)${boundary}`, "i");
    return regex.exec(html)?.[1] || "";
  }

  sortEpisodeVideos(videos) {
    return this.dedupeEpisodeVideos(videos).sort((a, b) => {
      const seasonDiff = Number(b.season) - Number(a.season);
      if (seasonDiff !== 0) return seasonDiff;
      return Number(b.episode) - Number(a.episode);
    });
  }

  extractVideoSourcePages(html) {
    const scriptData = Array.from(
      html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi),
      (match) => match[1]
    ).find((script) => script.includes("var videoSources"));

    if (!scriptData) {
      return [];
    }

    const sourcesBlock = VIDEO_SOURCES_REGEX.exec(scriptData)?.[1] || "";
    return Array.from(sourcesBlock.matchAll(SOURCE_URL_REGEX), (match) => match[1])
      .filter((value) => /^https?:\/\//i.test(value))
      .filter((value, index, array) => array.indexOf(value) === index);
  }

  async resolveSourcePage(pageUrl, referer) {
    try {
      const body = await this.fetchText(pageUrl, {
        Referer: referer
      });
      const parsedLinks = this.extractNewExtractorLinks(body, body);
      if (!parsedLinks.length) {
        return [];
      }

      const results = [];
      for (const [url, language] of parsedLinks) {
        const label = language || this.detectLanguageTag(url);
        const extracted = await resolveExtractorStream(url, label, true);

        if (extracted.length > 0) {
          const sourceKey = `${this.id}:${this.detectServer(url)}`;
          markSourceSuccess(sourceKey);
          results.push(...extracted.map((stream) => ({
            ...stream,
            name: "SeriesKao",
            _sourceKey: sourceKey
          })));
          continue;
        }

        if (/\.(m3u8|mp4)(\?|$)/i.test(url)) {
          const sourceKey = `${this.id}:${this.detectServer(url)}`;
          markSourceSuccess(sourceKey);
          results.push({
            ...buildStream("SeriesKao", label || "SeriesKao", url, null, true),
            _sourceKey: sourceKey
          });
          continue;
        }

        markSourceFailure(`${this.id}:${this.detectServer(url)}`);
      }

      return results;
    } catch {
      markSourceFailure(`${this.id}:${this.detectServer(pageUrl)}`);
      return [];
    }
  }

  extractNewExtractorLinks(docHtml, rawHtml) {
    const rawExpression = this.extractFirstMatch(docHtml, DATA_LINK_REGEX) || this.extractFirstMatch(rawHtml, DATA_LINK_REGEX);
    const jsonPayload = this.resolveDataLink(rawExpression);
    const links = [];
    const languages = {
      LAT: "[LAT]",
      ESP: "[CAST]",
      SUB: "[SUB]"
    };

    if (jsonPayload) {
      const items = this.tryParseJson(jsonPayload);
      if (Array.isArray(items)) {
        for (const item of items) {
          const languageKey = String(item?.video_language || "").toUpperCase();
          const languageCode = languages[languageKey] || "";

          for (const embed of Array.isArray(item?.sortedEmbeds) ? item.sortedEmbeds : []) {
            if (!/video/i.test(String(embed?.type || ""))) {
              continue;
            }

            const decryptedLink = this.decryptEmbedLink(embed?.link);
            if (decryptedLink) {
              links.push([decryptedLink, languageCode]);
            }
          }
        }
      }
    }

    if (links.length === 0) {
      links.push(...this.extractFallbackVideoLinks(docHtml, rawHtml));
    }

    return this.dedupeLinkPairs(links);
  }

  extractFallbackVideoLinks(docHtml, rawHtml) {
    const text = `${docHtml || ""}\n${rawHtml || ""}`;
    const urls = new Set();
    const patterns = [
      /<iframe[^>]+src=["']([^"']+)["']/gi,
      /<source[^>]+src=["']([^"']+)["']/gi,
      /embed_url["']?\s*:\s*["']([^"']+)["']/gi,
      /location\.href\s*=\s*["']([^"']+)["']/gi,
      /(?:player|window\.player)\.src\s*=\s*["']([^"']+)["']/gi,
      /file\s*:\s*["'](https?:\/\/[^"']+)["']/gi,
      /https?:\/\/[^"'\\\s<>()]+/gi
    ];

    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const candidate = this.normalizeFallbackUrl(match[1] || match[0]);
        if (candidate && this.isLikelyVideoPageUrl(candidate)) {
          urls.add(candidate);
        }
      }
    }

    return Array.from(urls, (url) => [url, this.detectLanguageTag(url)]);
  }

  normalizeFallbackUrl(value) {
    const raw = this.decodeHtmlEntities(String(value || "").trim())
      .replaceAll("\\/", "/")
      .replace(/^\/\//, "https://");

    if (!/^https?:\/\//i.test(raw)) {
      return this.toAbsoluteUrl(raw);
    }

    return raw;
  }

  isLikelyVideoPageUrl(url) {
    const value = String(url || "").toLowerCase();
    if (!/^https?:\/\//i.test(value)) {
      return false;
    }

    if (/\.(?:css|js|json|png|jpe?g|webp|gif|svg|woff2?|ttf)(\?|$)/i.test(value)) {
      return false;
    }

    return /(voe|ok\.ru|okru|filemoon|uqload|mp4upload|streamwish|hlswish|wishembed|strwish|dood|streamlare|yourupload|burstcloud|fastream|upstream|streamtape|stape|vidhide|streamhide|streamvid|vidguard|goodstream|vimeos|filelions|waaw|netu|hqq|mixdrop|dailymotion|xupalace|\.m3u8|\.mp4)/i.test(value);
  }

  dedupeLinkPairs(pairs) {
    const seen = new Set();
    const result = [];

    for (const [url, language] of pairs) {
      const key = `${url}::${language || ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push([url, language]);
    }

    return result;
  }

  resolveDataLink(rawExpression) {
    if (!rawExpression) {
      return null;
    }

    let expr = String(rawExpression).trim().replace(/;$/, "");

    const removeOuterCall = (value, prefix) => {
      if (!value.toLowerCase().startsWith(prefix.toLowerCase()) || !value.endsWith(")")) {
        return null;
      }
      const start = value.indexOf("(");
      const end = value.lastIndexOf(")");
      if (start === -1 || end <= start) {
        return null;
      }
      return value.slice(start + 1, end).trim();
    };

    const trimQuotes = (value) => {
      const text = String(value || "");
      if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
        return text.slice(1, -1);
      }
      return text;
    };

    while (true) {
      let changed = false;

      for (const prefix of ["JSON.parse", "window.JSON.parse"]) {
        const unwrapped = removeOuterCall(expr, prefix);
        if (unwrapped !== null) {
          expr = unwrapped;
          changed = true;
        }
      }

      for (const prefix of ["decodeURIComponent", "window.decodeURIComponent"]) {
        const unwrapped = removeOuterCall(expr, prefix);
        if (unwrapped !== null) {
          try {
            expr = decodeURIComponent(trimQuotes(unwrapped));
            changed = true;
          } catch {
            return null;
          }
        }
      }

      for (const prefix of ["atob", "window.atob"]) {
        const unwrapped = removeOuterCall(expr, prefix);
        if (unwrapped !== null) {
          try {
            expr = Buffer.from(trimQuotes(unwrapped), "base64").toString("utf8");
            changed = true;
          } catch {
            return null;
          }
        }
      }

      if (!changed) {
        break;
      }
    }

    const cleaned = trimQuotes(expr).trim();
    return cleaned || null;
  }

  decryptEmbedLink(rawLink) {
    const link = String(rawLink || "").trim();
    if (!link) {
      return null;
    }

    if (/^https?:\/\//i.test(link)) {
      return link;
    }

    const decrypted = [
      this.decryptAesCbcWithIv(link),
      this.decryptAesCbcFallback(link),
      this.decodeJwtLink(link)
    ].find(Boolean);

    return decrypted || null;
  }

  decryptAesCbcWithIv(value) {
    try {
      const data = Buffer.from(String(value || ""), "base64");
      if (data.length <= 16) {
        return null;
      }
      const iv = data.subarray(0, 16);
      const encrypted = data.subarray(16);
      const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(AES_KEY, "utf8"), iv);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8").trim();
      return /^https?:\/\//i.test(decrypted) ? decrypted : null;
    } catch {
      return null;
    }
  }

  decryptAesCbcFallback(value) {
    try {
      const encrypted = Buffer.from(String(value || ""), "base64");
      const iv = Buffer.alloc(16, 0);
      const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(AES_KEY, "utf8"), iv);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8").trim();
      return /^https?:\/\//i.test(decrypted) ? decrypted : null;
    } catch {
      return null;
    }
  }

  decodeJwtLink(token) {
    try {
      const segments = String(token || "").split(".");
      if (segments.length < 2) {
        return null;
      }

      const payload = segments[1] + "=".repeat((4 - segments[1].length % 4) % 4);
      const decoded = Buffer.from(payload.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
      const json = this.tryParseJson(decoded);
      const link = json?.link || json?.data?.link || null;
      return /^https?:\/\//i.test(String(link || "")) ? link : null;
    } catch {
      return null;
    }
  }

  searchWithFallbackQueries({ type, externalMeta }) {
    return this.runSearchQueries(type, this.buildSearchQueries(externalMeta));
  }

  async runSearchQueries(type, queries) {
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
    return videos.find((video) =>
      Number(video.season) === Number(parsedExternal.season) &&
      Number(video.episode) === Number(parsedExternal.episode)
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

      if (titleSimilarity >= 0.92) score += 65;
      else if (titleSimilarity >= 0.84) score += 40;

      const relaxedCandidateTitle = this.relaxTitle(candidateTitle);
      const relaxedTargetTitle = this.relaxTitle(targetTitle);
      const relaxedSimilarity = this.stringSimilarity(relaxedCandidateTitle, relaxedTargetTitle);

      if (relaxedCandidateTitle === relaxedTargetTitle) {
        score += 35;
      } else if (relaxedCandidateTitle.includes(relaxedTargetTitle) || relaxedTargetTitle.includes(relaxedCandidateTitle)) {
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
    return scored[0]?.score > 0 ? scored[0].candidate : candidates[0] || null;
  }

  resolveTypeFromPath(path, fallbackType) {
    const value = String(path || "").toLowerCase();
    if (value.includes("/pelicula/")) return "movie";
    if (
      value.includes("/serie/")
      || value.includes("/series/")
      || value.includes("/anime/")
      || value.includes("/animes/")
      || value.includes("/dorama/")
    ) return "series";
    return fallbackType || "series";
  }

  detectLanguageTag(url) {
    const value = String(url || "").toLowerCase();
    if (value.includes("lat")) return "[LAT]";
    if (value.includes("esp")) return "[CAST]";
    return "";
  }

  detectServer(value) {
    const lower = String(value || "").toLowerCase();
    if (lower.includes("voe")) return "voe";
    if (lower.includes("ok.ru") || lower.includes("okru")) return "okru";
    if (lower.includes("filemoon") || lower.includes("moonplayer")) return "filemoon";
    if (lower.includes("uqload")) return "uqload";
    if (lower.includes("mp4upload")) return "mp4upload";
    if (lower.includes("streamwish") || lower.includes("wishembed") || lower.includes("strwish")) return "streamwish";
    if (lower.includes("dood")) return "doodstream";
    if (lower.includes("streamlare")) return "streamlare";
    if (lower.includes("yourupload") || lower.includes("upload")) return "yourupload";
    if (lower.includes("burstcloud") || lower.includes("burst")) return "burstcloud";
    if (lower.includes("fastream")) return "fastream";
    if (lower.includes("upstream")) return "upstream";
    if (lower.includes("streamtape") || lower.includes("stape")) return "streamtape";
    if (lower.includes("streamhide") || lower.includes("vidhide") || lower.includes("streamvid")) return "vidhide";
    if (lower.includes("vidguard") || lower.includes("guard")) return "vidguard";
    return lower || "generic";
  }

  sortStreams(streams) {
    return scoreAndSelectStreams(this.id, streams, {
      cleanTitle: (title) => this.cleanStreamTitle(title)
    });
  }

  cleanStreamTitle(title) {
    return String(title || "")
      .replace(/\s+/g, " ")
      .replace(/\bStreamWish HLS\b/gi, "StreamWish")
      .replace(/\bVidHide HLS\b/gi, "VidHide")
      .replace(/\bVoe HLS\b/gi, "Voe")
      .replace(/\bVoe MP4\b/gi, "Voe")
      .trim();
  }

  parseSlugPayload(type, slug) {
    const value = String(slug || "");

    if (value.startsWith("ep:")) {
      const [, encodedEpisodePath, seasonNumber, episodeNumber, encodedSeriesPath] = value.split(":");
      const episodePath = this.decodePathToken(encodedEpisodePath);
      const seriesPath = this.decodePathToken(encodedSeriesPath);
      return {
        type: "series",
        slug: value,
        path: episodePath,
        seriesPath,
        seasonNumber: Number(seasonNumber) || 1,
        episodeNumber: Number(episodeNumber) || 0,
        isEpisode: true,
        primarySlug: this.pathToSlug(seriesPath || episodePath),
        url: this.toAbsoluteUrl(episodePath)
      };
    }

    const path = this.decodePathToken(value);
    return {
      type,
      slug: value,
      path,
      isEpisode: false,
      primarySlug: this.pathToSlug(path),
      url: this.toAbsoluteUrl(path)
    };
  }

  extractTitle(html) {
    const raw = this.cleanText(
      this.extractFirstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
      || this.extractFirstMatch(html, /<h1[^>]+class=["'][^"']*\bm-b-5\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)
      || this.extractFirstMatch(html, /<title>([^<]+)<\/title>/i)
    );

    return raw
      .replace(/^ver\s+/i, "")
      .replace(/\s*online\s*-\s*serieskao\s*$/i, "")
      .replace(/\s*-\s*serieskao\s*$/i, "")
      .trim();
  }

  extractPoster(html) {
    const raw = this.extractFirstMatch(html, /<img[^>]+class=["'][^"']*\bimg-fluid\b[^"']*["'][^>]+(?:src|data-src)=["']([^"']+)["']/i)
      || this.extractFirstMatch(html, /<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]+class=["'][^"']*\bimg-fluid\b[^"']*["']/i);
    return this.toAbsoluteUrl(raw)?.replace("/w154/", "/w500/") || null;
  }

  extractDescription(html) {
    return this.cleanText(this.extractFirstMatch(html, /<div[^>]+class=["'][^"']*\btext-large\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i));
  }

  extractGenres(html) {
    return Array.from(
      html.matchAll(/<div[^>]+class=["'][^"']*\bp-v-20\b[^"']*["'][\s\S]*?<a[^>]*>\s*<span[^>]*>([^<]+)<\/span>\s*<\/a>/gi),
      (match) => this.cleanText(match[1])
    ).filter(Boolean);
  }

  encodePathToken(path) {
    return Buffer.from(String(path || ""), "utf8").toString("base64url");
  }

  decodePathToken(value) {
    try {
      const decoded = Buffer.from(String(value || ""), "base64url").toString("utf8");
      return decoded.startsWith("/") ? decoded : `/${decoded}`;
    } catch {
      return String(value || "");
    }
  }

  normalizePath(value) {
    try {
      const parsed = new URL(value, this.baseUrl);
      return parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    } catch {
      return null;
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

  pathToSlug(path) {
    return String(path || "").split("/").filter(Boolean).at(-1) || "";
  }

  unslugify(value) {
    return String(value || "")
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  dedupeById(items) {
    return Array.from(new Map(items.map((item) => [item.id, item])).values());
  }

  dedupeEpisodeVideos(videos) {
    return Array.from(new Map(videos.map((video) => [video.id, video])).values());
  }

  tryParseJson(value) {
    try {
      return JSON.parse(String(value || ""));
    } catch {
      return null;
    }
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

  stripTags(value) {
    return String(value || "").replace(/<[^>]+>/g, " ");
  }

  cleanText(value) {
    return this.decodeHtmlEntities(this.stripTags(value)).replace(/\s+/g, " ").trim();
  }

  extractFirstMatch(text, pattern) {
    return pattern.exec(String(text || ""))?.[1] || "";
  }

  extractAttribute(text, attributeName) {
    const safe = String(attributeName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return this.extractFirstMatch(text, new RegExp(`${safe}=["']([^"']+)["']`, "i"));
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
      .replace(/\b(temporada|season|serie|series|pelicula|movie|anime|dorama)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  extractYear(value) {
    return String(value || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
  }

  levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = Array.from({ length: b.length + 1 }, () => Array(a.length + 1).fill(0));
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
    if (!longer.length) {
      return 1;
    }
    return (longer.length - this.levenshtein(longer, shorter)) / longer.length;
  }

  async fetchText(url, extraHeaders = {}) {
    let response;

    try {
      response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...extraHeaders
        }
      });
    } catch (error) {
      const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new Error(`No se pudo conectar con SeriesKao en ${url}. ${details}`);
    }

    if (!response.ok) {
      throw new Error(`SeriesKao respondio ${response.status} para ${url}`);
    }

    return response.text();
  }

  async fetchJson(url) {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "application/json,text/plain;q=0.9,*/*;q=0.8"
      }
    });

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
