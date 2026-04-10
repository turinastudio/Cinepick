import { buildStremioId } from "../../../lib/ids.js";
import { buildStream, resolveExtractorStream } from "../../../lib/extractors.js";
import { markSourceFailure, markSourceSuccess } from "../../../lib/penalty-reliability.js";
import { fetchJson as sharedFetchJson, fetchText as sharedFetchText } from "../../../shared/fetch.js";
import { analyzeScoredStreams, scoreAndSelectStreams } from "../scoring.js";
import { Provider } from "./base.js";

export class Cineplus123Provider extends Provider {
  constructor() {
    super({
      id: "cineplus123",
      name: "Cineplus123",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.CINEPLUS123_BASE_URL || "https://cineplus123.org";
  }

  async search({ type, query }) {
    if (!query?.trim()) {
      return [];
    }

    const html = await this.fetchText(`${this.baseUrl}/page/1/?s=${encodeURIComponent(query.trim())}`);
    return this.extractSearchItems(html, type);
  }

  async getMeta({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const html = await this.fetchText(target.url);
    const resolvedType = this.resolveTypeFromPath(target.path, type);
    const name = this.cleanTitle(this.extractTitle(html) || this.unslugify(target.slug));
    const videos = resolvedType === "series" ? await this.buildEpisodeVideos(html, target.path, name) : [];

    return {
      id: buildStremioId(this.id, resolvedType, target.slug),
      type: resolvedType,
      name,
      poster: this.toAbsoluteUrl(
        this.extractOgValue(html, "og:image")
        || this.extractFirstMatch(html, /<img[^>]+class="[^"]*\bwp-post-image\b[^"]*"[^>]+src="([^"]+)"/i)
        || this.extractFirstMatch(html, /<img[^>]+class="[^"]*\bposter\b[^"]*"[^>]+src="([^"]+)"/i)
      ),
      background: this.toAbsoluteUrl(this.extractOgValue(html, "og:image")),
      description: this.extractDescription(html),
      genres: this.extractGenres(html),
      cast: this.extractCast(html),
      videos
    };
  }

  async getStreams({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const html = await this.fetchText(target.url);
    const players = this.extractPlayerOptions(html)
      .filter((player) => this.isSourceEnabled(player.server));

    if (!players.length) {
      return [];
    }

    const streamGroups = await Promise.all(players.map((player) => this.resolvePlayerStream(player)));
    return this.sortStreams(this.attachDisplayTitle(
      streamGroups.flat().filter(Boolean),
      this.cleanTitle(this.extractTitle(html) || this.unslugify(target.slug))
    ));
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

    const target = this.parseSlugPayload(type === "series" ? "series" : bestMatch.type, slug);
    debug.targetUrl = target.url;

    const html = await this.fetchText(target.url);
    const players = this.extractPlayerOptions(html)
      .filter((player) => this.isSourceEnabled(player.server));
    debug.playerCount = players.length;
    debug.players = players.map((player) => ({
      server: player.server,
      quality: "",
      pageUrl: `${this.baseUrl}/wp-admin/admin-ajax.php`,
      title: player.name,
      dataPost: player.dataPost,
      dataNume: player.dataNume,
      dataType: player.dataType
    }));

    if (!players.length) {
      debug.status = "no_players";
      return debug;
    }

    const streamGroups = await Promise.all(players.map((player) => this.resolvePlayerStream(player)));
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
    const target = this.parseSlugPayload(type, slug);
    const html = await this.fetchText(target.url);
    const resolvedType = this.resolveTypeFromPath(target.path, type);

    if (resolvedType === "series" && !String(slug || "").startsWith("ep:")) {
      const directCapituloLinks = Array.from(
        html.matchAll(/href=["']([^"']*\/capitulo\/[^"']+)["']/gi),
        (match) => this.normalizePath(match[1])
      ).filter(Boolean);

      const seasonLinks = Array.from(
        html.matchAll(/href=["']([^"']*\/(?:temporada|season)-\d+\/?[^"']*)["']/gi),
        (match) => this.normalizePath(match[1])
      ).filter(Boolean);

      const seasonBlockCount = Array.from(html.matchAll(/class=["'][^"']*\bse-c\b[^"']*["']/gi)).length;
      const episodiosListCount = Array.from(html.matchAll(/class=["'][^"']*\bepisodios\b[^"']*["']/gi)).length;
      const sampleVideos = await this.buildEpisodeVideos(html, target.path, this.cleanTitle(this.extractTitle(html)));

      return {
        targetUrl: target.url,
        resolvedType,
        seasonBlockCount,
        episodiosListCount,
        directCapituloLinkCount: directCapituloLinks.length,
        directCapituloLinkSample: directCapituloLinks.slice(0, 20),
        seasonLinkCount: seasonLinks.length,
        seasonLinkSample: seasonLinks.slice(0, 20),
        videoCount: sampleVideos.length,
        videoSample: sampleVideos.slice(0, 20).map((video) => ({
          id: video.id,
          title: video.title,
          season: video.season,
          episode: video.episode
        })),
        status: sampleVideos.length > 0 ? "ok" : "no_episode_matches"
      };
    }

    const players = this.extractPlayerOptions(html)
      .filter((player) => this.isSourceEnabled(player.server));
    const debugPlayers = await Promise.all(players.map(async (player) => {
      try {
        const ajaxText = await this.fetchPlayerAjaxResponse(player);
        const playerUrl = this.extractPlayerUrlFromAjax(ajaxText);
        const resolvedStreams = playerUrl ? await this.resolvePlayerStream(player) : [];
        return {
          server: player.server,
          title: player.name,
          dataPost: player.dataPost,
          dataNume: player.dataNume,
          dataType: player.dataType,
          ajaxPreview: String(ajaxText || "").slice(0, 300),
          playerUrl,
          streamCount: resolvedStreams.length,
          streamSample: resolvedStreams.slice(0, 3).map((stream) => ({
            title: stream.title,
            url: stream.url || null
          }))
        };
      } catch (error) {
        return {
          server: player.server,
          title: player.name,
          dataPost: player.dataPost,
          dataNume: player.dataNume,
          dataType: player.dataType,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }));

    return {
      targetUrl: target.url,
      resolvedType,
      playerCount: players.length,
      players: debugPlayers,
      status: players.length > 0 ? "ok" : "no_players"
    };
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
        url: this.toAbsoluteUrl(episodePath)
      };
    }

    const decodedPath = this.decodePathToken(value);
    const normalizedPath = decodedPath.startsWith("/") ? decodedPath : `/${value}/`;
    return {
      type,
      slug: value,
      path: normalizedPath,
      url: this.toAbsoluteUrl(normalizedPath)
    };
  }

  extractSearchItems(html, requestedType) {
    const items = [];
    const patterns = [
      /<article[^>]*class="[^"]*\bitem\b[^"]*"[\s\S]*?<\/article>/gi,
      /<div[^>]*class="[^"]*\bresult-item\b[^"]*"[\s\S]*?<\/article>/gi
    ];

    for (const pattern of patterns) {
      for (const match of html.matchAll(pattern)) {
        const mapped = this.mapSearchBlock(match[0], requestedType);
        if (mapped) {
          items.push(mapped);
        }
      }
    }

    if (items.length === 0) {
      for (const match of html.matchAll(/<a[^>]+href="([^"]*(?:\/peliculas\/|\/series\/|\/serie-de-tv\/|\/tvshows\/|\/temporadas\/)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const mapped = this.mapSearchBlock(match[0], requestedType);
        if (mapped) {
          items.push(mapped);
        }
      }
    }

    return this.dedupeById(items);
  }

  mapSearchBlock(block, requestedType) {
    const href = this.extractFirstMatch(block, /<a[^>]+href="([^"]*(?:\/peliculas\/|\/series\/|\/serie-de-tv\/|\/tvshows\/|\/temporadas\/)[^"]+)"/i);
    const title = this.extractFirstMatch(block, /<img[^>]+alt="([^"]+)"/i)
      || this.extractFirstMatch(block, /<h\d[^>]*>([^<]+)<\/h\d>/i)
      || this.extractFirstMatch(block, /title="([^"]+)"/i);
    const image = this.extractFirstMatch(block, /<img[^>]+data-src="([^"]+)"/i)
      || this.extractFirstMatch(block, /<img[^>]+src="([^"]+)"/i);

    if (!href || !title) {
      return null;
    }

    const path = this.normalizePath(href);
    const resolvedType = this.resolveTypeFromPath(path, requestedType);
    if (!path || !resolvedType) {
      return null;
    }

    return {
      id: buildStremioId(this.id, resolvedType, this.encodePathToken(path)),
      type: resolvedType,
      name: this.cleanTitle(this.cleanText(title)),
      poster: this.toAbsoluteUrl(image),
      posterShape: "poster",
      description: "",
      genres: [],
      releaseInfo: ""
    };
  }

  async buildEpisodeVideos(html, seriesPath, seriesTitle = "") {
    const videos = this.extractEpisodesFromSeasonHtml(html, seriesPath);

    if (videos.length === 0) {
      videos.push(...this.extractEpisodesFromCapituloLinks(html, seriesPath, seriesTitle));
    }

    if (videos.length === 0) {
      const seasonLinks = Array.from(
        html.matchAll(/<a[^>]+href=["']([^"']*\/(?:temporada|season)-\d+\/?[^"']*)["'][^>]*>/gi),
        (match) => this.normalizePath(match[1])
      )
        .filter(Boolean)
        .filter((path) => path.startsWith(seriesPath))
        .filter((value, index, array) => array.indexOf(value) === index);

      for (const seasonPath of seasonLinks) {
        const seasonHtml = await this.fetchText(this.toAbsoluteUrl(seasonPath));
        videos.push(...this.extractEpisodesFromSeasonHtml(seasonHtml, seriesPath, seasonPath));
      }
    }

    return this.dedupeEpisodeVideos(videos).sort((a, b) => {
      const seasonDiff = Number(b.season) - Number(a.season);
      if (seasonDiff !== 0) return seasonDiff;
      return Number(b.episode) - Number(a.episode);
    });
  }

  extractEpisodesFromCapituloLinks(html, seriesPath, seriesTitle = "") {
    const videos = [];
    const seriesSlug = seriesPath.split("/").filter(Boolean).at(-1) || "";
    const normalizedSeriesSlug = this.normalizeTitle(seriesSlug.replaceAll("-", " "));
    const normalizedSeriesTitle = this.normalizeTitle(seriesTitle);

    for (const match of html.matchAll(/<a[^>]+href=["']([^"']*\/capitulo\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const episodePath = this.normalizePath(match[1]);
      if (!episodePath || episodePath === seriesPath) {
        continue;
      }

      const pathMatch = episodePath.match(/\/capitulo\/(.+?)-(\d+)x(\d+)\/$/i);
      if (!pathMatch) {
        continue;
      }

      const [, slugPart, seasonRaw, episodeRaw] = pathMatch;
      const normalizedSlugPart = this.normalizeTitle(slugPart.replaceAll("-", " "));
      const titleLooksRelated =
        (normalizedSeriesTitle && (
          normalizedSlugPart.includes(normalizedSeriesTitle)
          || normalizedSeriesTitle.includes(normalizedSlugPart)
          || this.stringSimilarity(normalizedSlugPart, normalizedSeriesTitle) >= 0.75
        ))
        || (normalizedSeriesSlug && (
          normalizedSlugPart.includes(normalizedSeriesSlug)
          || normalizedSeriesSlug.includes(normalizedSlugPart)
          || this.stringSimilarity(normalizedSlugPart, normalizedSeriesSlug) >= 0.75
        ));

      if (!titleLooksRelated) {
        continue;
      }

      const seasonNumber = Number(seasonRaw) || 1;
      const episodeNumber = Number(episodeRaw) || 0;
      const anchorText = this.cleanText(match[2]);

      videos.push({
        id: buildStremioId(
          this.id,
          "series",
          `ep:${this.encodePathToken(episodePath)}:${seasonNumber}:${episodeNumber}:${this.encodePathToken(seriesPath)}`
        ),
        title: `Temporada ${seasonNumber} - ${anchorText || `Capitulo ${episodeNumber}`}`,
        season: seasonNumber,
        episode: episodeNumber
      });
    }

    return videos;
  }

  extractEpisodesFromSeasonHtml(html, seriesPath, seasonPathHint = "") {
    const videos = [];
    const seasonMatches = Array.from(
      html.matchAll(
        /<div[^>]*(?:class=["'][^"']*\bse-c\b[^"']*["']|data-season=["'][^"']+["']|id=["']season-[^"']+["'])(?:(?!<div[^>]+id=["']seasons["']).)*?<span[^>]+class=["'][^"']*\bse-t\b[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<ul[^>]+class=["'][^"']*\bepisodios\b[^"']*["'][\s\S]*?<\/ul>[\s\S]*?<\/div>/gi
      )
    );

    const normalizedSeasonMatches = seasonMatches.length > 0
      ? seasonMatches.map((match) => ({
          seasonNumber: Number(
            this.cleanText(match[1]).match(/\d+/)?.[0]
            || match[0].match(/data-season="(\d+)"/i)?.[1]
            || match[0].match(/id="season-(\d+)"/i)?.[1]
            || 1
          ),
          seasonHtml: match[0]
        }))
      : [
          {
            seasonNumber: 1,
            seasonHtml: html
          }
        ];

    for (const seasonMatch of normalizedSeasonMatches) {
      const seasonNumber = seasonMatch.seasonNumber;
      const seasonHtml = seasonMatch.seasonHtml;

      for (const itemMatch of seasonHtml.matchAll(/<li[^>]*>[\s\S]*?<\/li>/gi)) {
        const block = itemMatch[0];
        const href = this.extractFirstMatch(block, /<a[^>]+href=["']([^"']+)["']/i);
        const episodePath = this.normalizePath(href);

        if (!episodePath || episodePath === seriesPath) {
          continue;
        }

        if (seasonPathHint) {
          if (!episodePath.startsWith(seasonPathHint)) {
            continue;
          }
        } else if (
          !episodePath.startsWith(seriesPath)
          && !episodePath.includes("/episodio-")
          && !episodePath.includes("/episode-")
        ) {
          continue;
        }

        const numerando = this.cleanText(this.extractFirstMatch(block, /<div[^>]+class=["'][^"']*\bnumerando\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i));
        const episodeName = this.cleanText(
          this.extractFirstMatch(block, /<div[^>]+class=["'][^"']*\bepst\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
          || this.extractFirstMatch(block, /<span[^>]+class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
          || this.extractFirstMatch(block, /<a[^>]+href=["'][^"']+["'][^>]*>([\s\S]*?)<\/a>/i)
        );

        const episodeNumber = Number(
          episodePath.match(/(?:episodio|episode)-(\d+)/i)?.[1]
          || numerando.match(/(\d+)\s*$/)?.[1]
          || episodeName.match(/(?:episodio|episode|capitulo|capítulo)\s*(\d+)/i)?.[1]
          || 0
        );

        videos.push({
          id: buildStremioId(
            this.id,
            "series",
            `ep:${this.encodePathToken(episodePath)}:${seasonNumber}:${episodeNumber}:${this.encodePathToken(seriesPath)}`
          ),
          title: `Temporada ${seasonNumber} - ${episodeName || `Capitulo ${episodeNumber || "?"}`}`,
          season: seasonNumber,
          episode: episodeNumber
        });
      }
    }

    return videos;
  }

  extractPlayerOptions(html) {
    const players = [];

    for (const match of html.matchAll(/<li[^>]*class=["'][^"']*\bdooplay_player_option\b[^"']*["'][^>]*>[\s\S]*?<\/li>/gi)) {
      const block = match[0];
      const dataPost = this.extractAttribute(block, "data-post");
      const dataNume = this.extractAttribute(block, "data-nume");
      const dataType = this.extractAttribute(block, "data-type");
      const name = this.cleanText(
        this.extractFirstMatch(block, /<span[^>]+class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
        || this.extractFirstMatch(block, /<span[^>]+class=["'][^"']*\blabel\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
        || this.extractFirstMatch(block, /<li[^>]*>([\s\S]*?)<\/li>/i)
      );

      if (!dataPost || !dataNume || !dataType) {
        continue;
      }

      players.push({
        dataPost,
        dataNume,
        dataType,
        name,
        server: this.detectServer(name)
      });
    }

    return players;
  }

  async resolvePlayerStream(player) {
    const sourceKey = `${this.id}:${player.server}`;

    try {
      const url = await this.fetchPlayerUrl(player);
      if (!url) {
        markSourceFailure(sourceKey);
        return [];
      }

      const label = player.name;
      const extracted = await resolveExtractorStream(url, label, true);

      if (extracted.length > 0) {
        markSourceSuccess(sourceKey);
        return extracted.map((stream) => ({
          ...stream,
          name: "Cineplus123",
          _sourceKey: sourceKey
        }));
      }

      if (/\.(m3u8|mp4)(\?|$)/i.test(url)) {
        markSourceSuccess(sourceKey);
        return [
          {
            ...buildStream("Cineplus123", label, url, null, true),
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

  async fetchPlayerUrl(player) {
    const text = await this.fetchPlayerAjaxResponse(player);
    return this.extractPlayerUrlFromAjax(text);
  }

  async fetchPlayerAjaxResponse(player) {
    const body = new URLSearchParams({
      action: "doo_player_ajax",
      post: String(player.dataPost),
      nume: String(player.dataNume),
      type: String(player.dataType)
    }).toString();

    return sharedFetchText(`${this.baseUrl}/wp-admin/admin-ajax.php`, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: this.baseUrl,
        Referer: `${this.baseUrl}/`,
        "X-Requested-With": "XMLHttpRequest"
      },
      body
    });
  }

  extractPlayerUrlFromAjax(text) {
    const embedUrl = this.extractFirstMatch(text, /"embed_url":"([^"]+)"/i)
      || this.extractFirstMatch(text, /'embed_url':'([^']+)'/i)
      || this.extractFirstMatch(text, /embed_url["']?\s*:\s*["']([^"']+)["']/i);
    const normalized = this.decodeHtmlEntities(String(embedUrl || "")).replaceAll("\\", "");
    return normalized && /^https?:\/\//i.test(normalized) ? normalized : null;
  }

  searchWithFallbackQueries({ type, externalMeta }) {
    return this.runSearchQueries(type, this.buildSearchQueries(externalMeta));
  }

  async runSearchQueries(type, queries) {
    const settled = await Promise.allSettled(
      queries.map((query) => this.search({ type, query }).catch(() => []))
    );

    const deduped = new Map();
    for (const result of settled) {
      if (result.status === "fulfilled") {
        for (const item of result.value) {
          if (!deduped.has(item.id)) {
            deduped.set(item.id, item);
          }
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
    const targetWords = targetTitle.split(/\s+/).filter(Boolean);

    const scored = candidates.map((candidate) => {
      const candidateTitle = this.normalizeTitle(candidate.name);
      const candidateYear = this.extractYear(candidate.releaseInfo || "");
      const titleSimilarity = this.stringSimilarity(candidateTitle, targetTitle);
      const candidateWords = candidateTitle.split(/\s+/).filter(Boolean);
      const wordDelta = Math.abs(candidateWords.length - targetWords.length);
      const wordOverlap = targetWords.filter((word) => candidateWords.includes(word)).length;

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

      return { candidate, score, titleSimilarity, relaxedSimilarity, wordOverlap };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0] || null;

    if (!best) {
      return null;
    }

    const hasStrongExactness =
      best.score >= 40 ||
      best.titleSimilarity >= 0.84 ||
      best.relaxedSimilarity >= 0.9;
    const hasWordEvidence =
      best.wordOverlap >= Math.min(Math.max(targetWords.length, 1), 2) ||
      (targetWords.length === 1 && best.wordOverlap >= 1);

    if (!hasStrongExactness && !hasWordEvidence) {
      return null;
    }

    if (best.score <= 0) {
      return null;
    }

    return best.candidate;
  }

  resolveTypeFromPath(path, fallbackType) {
    const value = String(path || "").toLowerCase();
    if (
      value.includes("/series/") ||
      value.includes("/serie-de-tv/") ||
      value.includes("/tvshows/") ||
      value.includes("/temporadas/")
    ) return "series";
    if (value.includes("/peliculas/")) return "movie";
    return fallbackType || "movie";
  }

  detectServer(value) {
    const lower = String(value || "").toLowerCase();
    if (lower.includes("wish")) return "streamwish";
    if (lower.includes("uqload")) return "uqload";
    if (lower.includes("okru") || lower.includes("ok.ru")) return "okru";
    if (lower.includes("mp4upload")) return "mp4upload";
    if (lower.includes("yourupload")) return "yourupload";
    if (lower.includes("streamtape")) return "streamtape";
    if (lower.includes("dood")) return "doodstream";
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
      .replace(/\bUqload\b/gi, "Uqload")
      .trim();
  }

  extractTitle(html) {
    return this.cleanText(
      this.extractOgValue(html, "og:title")
      || this.extractFirstMatch(html, /<title>([^<]+)<\/title>/i)
      || this.extractFirstMatch(html, /<h1[^>]*>([^<]+)<\/h1>/i)
    );
  }

  extractDescription(html) {
    return this.cleanText(
      this.extractFirstMatch(html, /<div[^>]+class="[^"]*\bwp-content\b[^"]*"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
      || this.extractFirstMatch(html, /<meta[^>]+name="description"[^>]+content="([^"]+)"/i)
    );
  }

  extractGenres(html) {
    return Array.from(
      html.matchAll(/<a[^>]+rel="category tag"[^>]*>([^<]+)<\/a>/gi),
      (match) => this.cleanText(match[1])
    ).filter(Boolean);
  }

  extractCast(html) {
    return Array.from(
      html.matchAll(/<div[^>]+class="[^"]*\bperson\b[^"]*"[\s\S]*?<div[^>]+class="[^"]*\bname\b[^"]*"[^>]*>([^<]+)<\/div>/gi),
      (match) => this.cleanText(match[1])
    ).filter(Boolean);
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

  unslugify(value) {
    return String(value || "")
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
      .trim();
  }

  cleanTitle(value) {
    return this.cleanText(value)
      .replace(/^ver\s+/i, "")
      .replace(/\|\s*cineplus123.*$/i, "")
      .trim();
  }

  cleanText(value) {
    return this.decodeHtmlEntities(this.stripTags(value))
      .replace(/\s+/g, " ")
      .trim();
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

  dedupeById(items) {
    return Array.from(new Map(items.map((item) => [item.id, item])).values());
  }

  dedupeEpisodeVideos(videos) {
    return Array.from(new Map(videos.map((video) => [video.id, video])).values());
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

  extractAttribute(text, attributeName) {
    const safeAttribute = String(attributeName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return this.extractFirstMatch(
      text,
      new RegExp(`${safeAttribute}=["']([^"']+)["']`, "i")
    );
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
      .replace(/\b(temporada|season|serie|series|pelicula|movie)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  extractYear(value) {
    return String(value || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
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
    try {
      return await sharedFetchText(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
    } catch (error) {
      const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new Error(`No se pudo conectar con Cineplus123 en ${url}. ${details}`);
    }
  }

  async fetchJson(url) {
    return sharedFetchJson(url, {
      headers: {
        Accept: "application/json,text/plain;q=0.9,*/*;q=0.8"
      }
    });
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

