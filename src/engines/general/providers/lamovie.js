import { buildStremioId } from "../../../lib/ids.js";
import { buildStream, resolveExtractorStream } from "../../../lib/extractors.js";
import { markSourceFailure, markSourceSuccess } from "../../../lib/penalty-reliability.js";
import { fetchJson as sharedJsonFetch } from "../../../shared/fetch.js";
import { analyzeScoredStreams, scoreAndSelectStreams } from "../scoring.js";
import { fetchJson as sharedFetchJson, fetchText as sharedFetchText } from "../../../lib/webstreamer/http.js";
import { Provider } from "./base.js";

export class LaMovieProvider extends Provider {
  constructor() {
    super({
      id: "lamovie",
      name: "LaMovie",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.LAMOVIE_BASE_URL || "https://la.movie";
    this.apiBase = `${this.baseUrl}/wp-api/v1`;
    this.tmdbApiKey = process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c";
  }

  async search({ type, query }) {
    if (!query?.trim()) {
      return [];
    }

    const payload = await this.fetchApiJson("search", {
      postType: "any",
      q: query.trim(),
      postsPerPage: "24",
      page: "1"
    });

    const posts = Array.isArray(payload?.posts) ? payload.posts : [];
    return posts
      .map((post) => this.mapSearchItem(post))
      .filter(Boolean)
      .filter((item) => item.type === type);
  }

  async getMeta({ type, slug }) {
    const target = this.parseSlugPayload(slug);
    const payload = await this.fetchApiJson(`single/${target.postType}`, {
      slug: target.slug,
      postType: target.postType,
      ...(target.id ? { _id: String(target.id) } : {})
    });

    const resolvedType = this.resolveType(payload?.type || target.postType || type);
    const videos = resolvedType === "series"
      ? await this.fetchEpisodeVideos(payload)
      : [];

    return {
      id: buildStremioId(this.id, resolvedType, this.encodePayload({
        kind: "media",
        postType: payload?.type || target.postType,
        slug: payload?.slug || target.slug,
        id: Number(payload?._id || payload?.id || target.id) || 0
      })),
      type: resolvedType,
      name: String(payload?.title || "").trim() || this.unslugify(payload?.slug || target.slug),
      poster: this.resolveImage(payload, "poster"),
      background: this.resolveImage(payload, "backdrop") || this.resolveImage(payload, "poster"),
      description: String(payload?.overview || "").trim(),
      genres: [],
      cast: [],
      videos
    };
  }

  async getStreams({ type, slug }) {
    const target = this.parseSlugPayload(slug);
    const postId = target.kind === "episode" ? target.postId : target.id;

    if (!postId) {
      return [];
    }

    const payload = await this.fetchApiJson("player", {
      postId: String(postId),
      demo: "0"
    });

    const embeds = this.parseEmbeds(payload?.embeds)
      .filter((embed) => this.isSourceEnabled(this.detectServer(embed.server, embed.url)));

    if (!embeds.length) {
      return [];
    }

    const streamGroups = await Promise.all(embeds.map((embed) => this.resolveEmbedStream(embed)));
    const displayTitle = this.unslugify(target.slug || "");
    return this.sortStreams(this.attachDisplayTitle(streamGroups.flat().filter(Boolean), displayTitle));
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

    const candidates = await this.searchWithFallbackQueries(type, externalMeta);
    const filtered = candidates.filter((candidate) => candidate.type === type);
    const validCandidates = filtered.length > 0 ? filtered : candidates;
    const bestMatch = this.pickBestCandidate(validCandidates, externalMeta);

    if (!bestMatch) {
      return [];
    }

    let slug = bestMatch.id.split(":").slice(2).join(":");

    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const meta = await this.getMeta({ type: "series", slug });
      const matchingVideo = this.findMatchingEpisodeVideo(meta.videos || [], parsedExternal);

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

    const candidates = await this.searchWithFallbackQueries(type, externalMeta);
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

    const filtered = candidates.filter((candidate) => candidate.type === type);
    const validCandidates = filtered.length > 0 ? filtered : candidates;
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
      const meta = await this.getMeta({ type: "series", slug });
      debug.videoCount = (meta.videos || []).length;
      debug.videoSample = (meta.videos || []).slice(0, 20).map((video) => ({
        id: video.id,
        season: video.season,
        episode: video.episode,
        title: video.title
      }));

      const matchingVideo = this.findMatchingEpisodeVideo(meta.videos || [], parsedExternal);
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

    const target = this.parseSlugPayload(slug);
    debug.targetUrl = `${this.apiBase}/player?postId=${target.kind === "episode" ? target.postId : target.id}&demo=0`;

    const payload = await this.fetchApiJson("player", {
      postId: String(target.kind === "episode" ? target.postId : target.id),
      demo: "0"
    });
    const embeds = this.parseEmbeds(payload?.embeds)
      .filter((embed) => this.isSourceEnabled(this.detectServer(embed.server, embed.url)));

    debug.playerCount = embeds.length;
    debug.players = embeds.map((embed) => ({
      server: this.detectServer(embed.server, embed.url),
      quality: embed.quality || "",
      language: embed.language || "",
      pageUrl: embed.url
    }));

    if (!embeds.length) {
      debug.status = "no_players";
      return debug;
    }

    const streamGroups = await Promise.all(embeds.map((embed) => this.resolveEmbedStream(embed)));
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
    const target = this.parseSlugPayload(slug);
    const payload = target.kind === "episode"
      ? await this.fetchApiJson("player", { postId: String(target.postId), demo: "0" })
      : await this.fetchApiJson(`single/${target.postType}`, {
          slug: target.slug,
          postType: target.postType,
          ...(target.id ? { _id: String(target.id) } : {})
        });

    if (target.kind !== "episode" && this.resolveType(target.postType || type) === "series") {
      const videos = await this.fetchEpisodeVideos(payload);
      return {
        targetUrl: `${this.apiBase}/single/${target.postType}?slug=${target.slug}`,
        resolvedType: "series",
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

    const embeds = this.parseEmbeds(payload?.embeds)
      .filter((embed) => this.isSourceEnabled(this.detectServer(embed.server, embed.url)));

    const debugPlayers = await Promise.all(embeds.map(async (embed) => {
      try {
        const streams = await this.resolveEmbedStream(embed);
        return {
          server: this.detectServer(embed.server, embed.url),
          title: this.buildEmbedLabel(embed),
          language: embed.language || "",
          quality: embed.quality || "",
          playerUrl: embed.url,
          streamCount: streams.length,
          streamSample: streams.slice(0, 3).map((stream) => ({
            title: stream.title,
            url: stream.url || null
          }))
        };
      } catch (error) {
        return {
          server: this.detectServer(embed.server, embed.url),
          title: this.buildEmbedLabel(embed),
          playerUrl: embed.url,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }));

    return {
      targetUrl: `${this.apiBase}/player?postId=${target.kind === "episode" ? target.postId : target.id}&demo=0`,
      resolvedType: type,
      playerCount: embeds.length,
      players: debugPlayers,
      status: embeds.length > 0 ? "ok" : "no_players"
    };
  }

  async resolveEmbedStream(embed) {
    const sourceName = this.detectServer(embed.server, embed.url);
    const sourceKey = `${this.id}:${sourceName}`;
    const directUrl = embed.url;

    if (!directUrl || !/^https?:\/\//i.test(directUrl)) {
      markSourceFailure(sourceKey);
      return [];
    }

    try {
      const label = this.buildEmbedLabel(embed);
      const extracted = await resolveExtractorStream(directUrl, label, true);

      if (extracted.length > 0) {
        markSourceSuccess(sourceKey);
        return extracted.map((stream) => ({
          ...stream,
          name: "LaMovie",
          _sourceKey: sourceKey
        }));
      }

      if (/\.(m3u8|mp4)(\?|$)/i.test(directUrl)) {
        markSourceSuccess(sourceKey);
        return [
          {
            ...buildStream("LaMovie", label, directUrl, null, true),
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

  async fetchEpisodeVideos(media) {
    const mediaId = Number(media?._id || media?.id);
    if (!mediaId) {
      return [];
    }

    const seasons = [];
    let baseResponse = null;
    let baseSeason = null;

    for (const seasonCandidate of ["1", "0"]) {
      try {
        const payload = await this.fetchEpisodesPage(mediaId, seasonCandidate, 1);
        baseResponse = payload;
        baseSeason = seasonCandidate;
        break;
      } catch {
        // Try the next season.
      }
    }

    if (!baseResponse) {
      return [];
    }

    const availableSeasons = Array.isArray(baseResponse?.seasons) && baseResponse.seasons.length > 0
      ? baseResponse.seasons.map((season) => String(season))
      : [baseSeason || "1"];

    seasons.push(...availableSeasons);
    const videos = [];

    for (const season of [...new Set(seasons)]) {
      const firstPage = season === baseSeason
        ? baseResponse
        : await this.fetchEpisodesPage(mediaId, season, 1);

      videos.push(...this.mapEpisodePosts(firstPage?.posts, media, season));

      const lastPage = Number(firstPage?.pagination?.last_page || firstPage?.pagination?.lastPage || 1) || 1;
      for (let page = 2; page <= lastPage; page += 1) {
        const nextPage = await this.fetchEpisodesPage(mediaId, season, page);
        videos.push(...this.mapEpisodePosts(nextPage?.posts, media, season));
      }
    }

    return this.dedupeEpisodeVideos(videos).sort((a, b) => {
      const seasonDiff = Number(b.season) - Number(a.season);
      if (seasonDiff !== 0) return seasonDiff;
      return Number(b.episode) - Number(a.episode);
    });
  }

  mapEpisodePosts(posts, media) {
    if (!Array.isArray(posts)) {
      return [];
    }

    return posts
      .map((episode) => {
        const episodeId = Number(episode?._id || episode?.id);
        if (!episodeId) {
          return null;
        }

        const seasonNumber = Number(episode?.season_number || 1) || 1;
        const episodeNumber = Number(episode?.episode_number || 1) || 1;
        const baseName = String(episode?.name || episode?.title || "").trim() || `Episodio ${episodeNumber}`;

        return {
          id: buildStremioId(this.id, "series", `ep:${this.encodePayload({
            kind: "episode",
            postId: episodeId,
            seriesId: Number(media?._id || media?.id) || 0,
            postType: media?.type || "tvshows",
            slug: media?.slug || "",
            season: seasonNumber,
            episode: episodeNumber
          })}`),
          title: `T${seasonNumber}x${episodeNumber} - ${baseName}`,
          season: seasonNumber,
          episode: episodeNumber,
          released: episode?.date || undefined
        };
      })
      .filter(Boolean);
  }

  async fetchEpisodesPage(mediaId, season, page) {
    return this.fetchApiJson("single/episodes/list", {
      _id: String(mediaId),
      season: String(season),
      page: String(page),
      postsPerPage: "3000"
    });
  }

  parseEmbeds(embeds) {
    const items = [];

    if (Array.isArray(embeds)) {
      for (const item of embeds) {
        const mapped = this.mapEmbedItem(item);
        if (mapped) {
          items.push(mapped);
        }
      }
      return items;
    }

    if (embeds && typeof embeds === "object") {
      for (const [language, values] of Object.entries(embeds)) {
        if (!Array.isArray(values)) {
          continue;
        }

        for (const item of values) {
          const mapped = this.mapEmbedItem(item, language);
          if (mapped) {
            items.push(mapped);
          }
        }
      }
    }

    return items;
  }

  mapEmbedItem(item, fallbackLanguage = null) {
    const server = String(item?.server || "").trim();
    const url = String(item?.url || "").trim();

    if (!server || !url) {
      return null;
    }

    return {
      server,
      url,
      quality: String(item?.quality || "").trim(),
      language: String(item?.lang || fallbackLanguage || "").trim()
    };
  }

  mapSearchItem(post) {
    const resolvedType = this.resolveType(post?.type || post?.postType);
    if (!resolvedType) {
      return null;
    }

    const rawPostType = String(post?.type || post?.postType || (resolvedType === "movie" ? "movies" : "tvshows")).trim();
    const slug = this.encodePayload({
      kind: "media",
      postType: rawPostType,
      slug: post?.slug || String(post?._id || post?.id || ""),
      id: Number(post?._id || post?.id) || 0
    });

    return {
      id: buildStremioId(this.id, resolvedType, slug),
      type: resolvedType,
      name: String(post?.title || "").trim() || this.unslugify(post?.slug || ""),
      poster: this.resolveImage(post, "poster"),
      posterShape: "poster",
      description: String(post?.overview || "").trim(),
      genres: [],
      releaseInfo: "",
      _postType: rawPostType
    };
  }

  resolveImage(post, kind) {
    const images = post?.images || {};
    const raw = kind === "backdrop" ? images?.backdrop : images?.poster;
    const gallery = post?.gallery;
    const candidates = [];

    if (raw) candidates.push(...this.buildImageCandidates(raw));
    if (gallery) candidates.push(...this.buildImageCandidates(gallery));

    return candidates[0] || null;
  }

  buildImageCandidates(raw) {
    return String(raw || "")
      .split(/\n|,|\|/g)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        if (/^https?:\/\//i.test(part)) {
          return part;
        }

        const normalized = part.startsWith("/") ? part : `/${part}`;
        if (/^\/[a-z0-9/_-]+\.(jpg|jpeg|png|webp)$/i.test(normalized)) {
          return `https://image.tmdb.org/t/p/w780${normalized}`;
        }

        return `${this.baseUrl}${normalized}`;
      });
  }

  parseSlugPayload(slug) {
    const value = String(slug || "");
    if (value.startsWith("ep:")) {
      const payload = this.decodePayload(value.slice(3));
      return {
        kind: "episode",
        ...payload
      };
    }

    const payload = this.decodePayload(value);
    return {
      kind: "media",
      ...payload
    };
  }

  buildEmbedLabel(embed) {
    const parts = [];
    const languageTag = this.toLanguageTag(embed.language);
    const quality = String(embed.quality || "").trim();
    const sourceName = this.detectServer(embed.server, embed.url);

    if (languageTag) parts.push(languageTag);
    parts.push(sourceName);
    if (quality) parts.push(quality);

    return parts.join(" ").trim();
  }

  detectServer(server, url = "") {
    const fingerprint = `${server || ""} ${url || ""}`.toLowerCase();
    if (fingerprint.includes("streamwish") || fingerprint.includes("hlswish") || fingerprint.includes("strwish")) return "streamwish";
    if (fingerprint.includes("streamhide") || fingerprint.includes("streamvid") || fingerprint.includes("vidhide")) return "vidhide";
    if (fingerprint.includes("voe")) return "voe";
    if (fingerprint.includes("mp4upload")) return "mp4upload";
    if (fingerprint.includes("yourupload")) return "yourupload";
    if (fingerprint.includes("filemoon")) return "filemoon";
    if (fingerprint.includes("goodstream")) return "goodstream";
    if (fingerprint.includes("dood")) return "doodstream";
    if (fingerprint.includes("vimeos")) return "vimeos";
    if (fingerprint.includes("lamovie.link") || fingerprint.includes("la.movie")) return "lamovie";
    return String(server || "generic").trim().toLowerCase() || "generic";
  }

  toLanguageTag(value) {
    const normalized = String(value || "").toLowerCase();
    if (!normalized) return "";
    if (/(^|[^a-z])(lat|latino|latam)([^a-z]|$)/i.test(normalized)) return "[LAT]";
    if (/(^|[^a-z])(cast|castellano|espana|españa)([^a-z]|$)/i.test(normalized)) return "[CAST]";
    if (/(^|[^a-z])(sub|subs|subtitulado|vose)([^a-z]|$)/i.test(normalized)) return "[SUB]";
    if (/(^|[^a-z])(eng|ingles|ingl[eé]s|english)([^a-z]|$)/i.test(normalized)) return "[ENG]";
    return `[${String(value).trim()}]`;
  }

  resolveType(value) {
    const normalized = String(value || "").toLowerCase();
    if (normalized === "movies" || normalized === "movie") return "movie";
    if (["tvshows", "tvshow", "series", "serie", "animes", "anime"].includes(normalized)) return "series";
    return null;
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
      .replace(/\bGoodStream\b/gi, "GoodStream")
      .replace(/\bGenericM3U8\b/gi, "HLS")
      .trim();
  }

  async searchWithFallbackQueries(type, externalMeta) {
    const extraTitles = await this.fetchTmdbSearchTitles(type, externalMeta.id || "").catch(() => []);
    externalMeta._searchTitles = extraTitles;
    const deduped = new Map();
    const directCandidates = await this.probeDirectCandidates(type, externalMeta, extraTitles);

    for (const result of directCandidates) {
      if (!deduped.has(result.id)) {
        deduped.set(result.id, result);
      }
    }

    for (const query of this.buildSearchQueries(externalMeta, extraTitles)) {
      const results = await this.search({ type, query }).catch(() => []);
      for (const result of results) {
        if (!deduped.has(result.id)) {
          deduped.set(result.id, result);
        }
      }
    }
    return Array.from(deduped.values());
  }

  async probeDirectCandidates(type, externalMeta, extraTitles = []) {
    const postType = type === "movie" ? "movies" : "tvshows";
    const publicTypes = type === "movie"
      ? ["peliculas", "movies"]
      : ["series", "animes", "tvshows"];
    const year = this.extractYear(externalMeta.releaseInfo || externalMeta.year || "");
    const slugBases = [
      externalMeta.name,
      ...(Array.isArray(extraTitles) ? extraTitles : [])
    ]
      .map((value) => this.slugify(value))
      .filter(Boolean);
    const slugCandidates = [];

    for (const slugBase of [...new Set(slugBases)]) {
      slugCandidates.push(slugBase);
      if (year) {
        slugCandidates.push(`${slugBase}-${year}`);
      }
    }

    const directMatches = [];

    for (const slug of [...new Set(slugCandidates)]) {
      for (const publicType of publicTypes) {
        try {
          const exists = await this.probePublicPath(`/${publicType}/${slug}`);
          if (!exists) {
            continue;
          }

          const payload = await this.fetchApiJson(`single/${postType}`, {
            slug,
            postType
          });
          const mapped = this.mapSearchItem(payload);
          if (mapped && mapped.type === type) {
            mapped._directPathMatch = true;
            directMatches.push(mapped);
          }
        } catch {
          // Ignore direct slug misses.
        }
      }
    }

    return directMatches;
  }

  async fetchTmdbSearchTitles(type, externalId) {
    if (!externalId?.startsWith("tt")) {
      return [];
    }

    const mediaType = type === "series" ? "tv" : "movie";
    const resultKey = type === "series" ? "tv_results" : "movie_results";
    const url = `https://api.themoviedb.org/3/find/${externalId}?api_key=${this.tmdbApiKey}&external_source=imdb_id&language=es-ES`;

    try {
      const payload = await sharedFetchJson(url, {
        headers: {
          Accept: "application/json"
        }
      });
      const item = Array.isArray(payload?.[resultKey]) ? payload[resultKey][0] : null;
      if (!item) {
        return [];
      }

      const values = [
        item.title,
        item.name,
        item.original_title,
        item.original_name
      ];

      if (item.id) {
        for (const language of ["es-MX", "es-ES", "en-US"]) {
          const details = await sharedFetchJson(
            `https://api.themoviedb.org/3/${mediaType}/${item.id}?api_key=${this.tmdbApiKey}&language=${language}`,
            {
              headers: {
                Accept: "application/json"
              }
            }
          ).catch(() => null);

          if (!details) {
            continue;
          }

          values.push(
            details.title,
            details.name,
            details.original_title,
            details.original_name
          );
        }
      }

      return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
    } catch {
      return [];
    }
  }

  async probePublicPath(path) {
    try {
      const html = await sharedFetchText(`${this.baseUrl}${path}`, {
        headers: {
          Referer: `${this.baseUrl}/`,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "es-MX,es;q=0.9"
        }
      });

      return /rel=['"]shortlink['"][^>]+href=['"][^'"]*\?p=\d+/i.test(html);
    } catch {
      return false;
    }
  }

  buildSearchQueries(externalMeta, extraTitles = []) {
    const baseNames = [
      String(externalMeta?.name || "").trim(),
      ...(Array.isArray(extraTitles) ? extraTitles : [])
    ];
    const queries = [];

    for (const rawName of baseNames) {
      const baseName = String(rawName || "").trim();
      if (!baseName) {
        continue;
      }

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
    const titleCandidates = [
      externalMeta.name,
      ...(Array.isArray(externalMeta?._searchTitles) ? externalMeta._searchTitles : [])
    ].map((value) => this.normalizeTitle(value)).filter(Boolean);
    const targetTitle = titleCandidates[0] || "";
    const targetYear = this.extractYear(externalMeta.releaseInfo || externalMeta.year || "");
    const targetWords = targetTitle.split(/\s+/).filter(Boolean);
    const isShortTarget = targetWords.length <= 2 && targetTitle.length <= 12;
    const strictShortCandidates = isShortTarget
      ? candidates.filter((candidate) => {
          for (const candidateTargetTitle of titleCandidates) {
            const candidateTitle = this.normalizeTitle(candidate.name);
            const candidateWords = candidateTitle.split(/\s+/).filter(Boolean);
            const referenceWords = candidateTargetTitle.split(/\s+/).filter(Boolean);
            const relaxedCandidateTitle = this.relaxTitle(candidateTitle);
            const relaxedTargetTitle = this.relaxTitle(candidateTargetTitle);

            if (candidateTitle === candidateTargetTitle || relaxedCandidateTitle === relaxedTargetTitle) {
              return true;
            }

            if (candidateTitle.startsWith(`${candidateTargetTitle} `) && candidateWords.length <= referenceWords.length + 1) {
              return true;
            }
          }

          return false;
        })
      : candidates;

    if (isShortTarget && strictShortCandidates.length === 0) {
      return null;
    }

    const scored = strictShortCandidates.map((candidate) => {
      const candidateTitle = this.normalizeTitle(candidate.name);
      const candidateYear = this.extractYear(candidate.releaseInfo || "");
      const candidatePostType = String(candidate._postType || "").toLowerCase();
      const isAnimeCandidate = candidatePostType === "animes" || candidatePostType === "anime";
      const candidateWords = candidateTitle.split(/\s+/).filter(Boolean);
      let score = 0;

      for (const candidateTargetTitle of titleCandidates) {
        const referenceWords = candidateTargetTitle.split(/\s+/).filter(Boolean);
        const wordDelta = Math.abs(candidateWords.length - referenceWords.length);
        const hasWholeWordMatch = referenceWords.every((word) => candidateWords.includes(word));
        const candidateStartsWithTarget = candidateTitle.startsWith(`${candidateTargetTitle} `) || candidateTitle === candidateTargetTitle;
        const relaxedCandidateTitle = this.relaxTitle(candidateTitle);
        const relaxedTargetTitle = this.relaxTitle(candidateTargetTitle);
        const titleSimilarity = this.stringSimilarity(candidateTitle, candidateTargetTitle);
        const relaxedSimilarity = this.stringSimilarity(relaxedCandidateTitle, relaxedTargetTitle);
        const relaxedCandidateWords = relaxedCandidateTitle.split(/\s+/).filter(Boolean);
        const relaxedTargetWords = relaxedTargetTitle.split(/\s+/).filter(Boolean);
        const relaxedWordDelta = Math.abs(relaxedCandidateWords.length - relaxedTargetWords.length);
        const relaxedWholeWordMatch = relaxedTargetWords.every((word) => relaxedCandidateWords.includes(word));

        let localScore = 0;
        if (candidateTitle === candidateTargetTitle) localScore += 100;
        else if (candidateTitle.includes(candidateTargetTitle) || candidateTargetTitle.includes(candidateTitle)) {
          if (isShortTarget) {
            localScore += candidateStartsWithTarget && wordDelta <= 1 ? 22 : -20;
          } else {
            localScore += wordDelta <= 1 ? 30 : 12;
          }
        }

        if (hasWholeWordMatch) {
          localScore += isShortTarget ? 12 : 20;
        } else if (isShortTarget) {
          localScore -= 25;
        }

        if (titleSimilarity >= 0.92) localScore += 65;
        else if (titleSimilarity >= 0.84) localScore += 40;

        if (relaxedCandidateTitle === relaxedTargetTitle) localScore += 35;
        else if (relaxedCandidateTitle.includes(relaxedTargetTitle) || relaxedTargetTitle.includes(relaxedCandidateTitle)) {
          if (isShortTarget) {
            localScore += relaxedWordDelta <= 1 ? 8 : -10;
          } else {
            localScore += 20;
          }
        }

        if (relaxedWholeWordMatch) {
          localScore += isShortTarget ? 8 : 15;
        }

        if (relaxedSimilarity > 0.75) localScore += Math.floor(relaxedSimilarity * 30);
        score = Math.max(score, localScore);
      }

      if (targetYear && candidateYear && targetYear === candidateYear) score += 25;
      if (candidate._directPathMatch) score += 120;

      if (isAnimeCandidate) {
        const animeMatch = titleCandidates.some((candidateTargetTitle) => {
          const relaxedCandidateTitle = this.relaxTitle(candidateTitle);
          const relaxedTargetTitle = this.relaxTitle(candidateTargetTitle);
          return candidateTitle === candidateTargetTitle || relaxedCandidateTitle === relaxedTargetTitle;
        });

        if (animeMatch) {
          score += 5;
        } else {
          score -= isShortTarget ? 180 : 90;
        }
      }

      const wordOverlap = titleCandidates.reduce((bestOverlap, candidateTargetTitle) => {
        const referenceWords = candidateTargetTitle.split(/\s+/).filter(Boolean);
        return Math.max(
          bestOverlap,
          referenceWords.filter((word) => candidateWords.includes(word)).length
        );
      }, 0);

      return { candidate, score, wordOverlap };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0] || null;
    if (!best || best.score <= 0) {
      return null;
    }

    const minimumOverlap = targetWords.length <= 1 ? 1 : Math.min(targetWords.length, 2);
    const hasWordEvidence = best.wordOverlap >= minimumOverlap;
    const hasStrongScore = best.score >= 35;

    return hasStrongScore || hasWordEvidence ? best.candidate : null;
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
      .replace(/\b(temporada|season|serie|series|pelicula|movie|anime)\b/g, " ")
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
    if (!longer.length) return 1;
    return (longer.length - this.levenshtein(longer, shorter)) / longer.length;
  }

  encodePayload(payload) {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  }

  decodePayload(value) {
    return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
  }

  unslugify(value) {
    return String(value || "")
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  slugify(value) {
    return String(value || "")
      .normalize("NFD")
      .replaceAll(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-");
  }

  dedupeEpisodeVideos(videos) {
    return Array.from(new Map(videos.map((video) => [video.id, video])).values());
  }

  async fetchApiJson(path, query = {}) {
    const url = new URL(`${this.apiBase}/${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const payload = await sharedFetchJson(url.toString(), {
      headers: {
        Accept: "application/json, text/plain, */*",
        Origin: this.baseUrl,
        Referer: `${this.baseUrl}/`
      }
    });

    if (payload?.error) {
      throw new Error(payload?.message || `LaMovie devolvio error para ${url}`);
    }

    return payload?.data ?? null;
  }

  async fetchCinemetaMeta(type, externalId) {
    try {
      const payload = await sharedJsonFetch(`https://v3-cinemeta.strem.io/meta/${type}/${externalId}.json`, {
        headers: {
          Accept: "application/json,text/plain;q=0.9,*/*;q=0.8"
        }
      });
      return payload?.meta || null;
    } catch {
      return null;
    }
  }
}

