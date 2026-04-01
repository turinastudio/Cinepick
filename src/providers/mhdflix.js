import { buildStremioId } from "../lib/ids.js";
import { buildStream, resolveExtractorStream } from "../lib/extractors.js";
import { markSourceFailure, markSourceSuccess } from "../lib/penalty-reliability.js";
import { analyzeScoredStreams, scoreAndSelectStreams } from "../lib/stream-scoring.js";
import { Provider } from "./base.js";

export class MhdflixProvider extends Provider {
  constructor() {
    super({
      id: "mhdflix",
      name: "MhdFlix",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.MHDFLIX_BASE_URL || "https://ww1.mhdflix.com";
    this.apiUrl = process.env.MHDFLIX_API_URL || "https://core.mhdflix.com";
  }

  async search({ type, query }) {
    if (!query?.trim()) {
      return [];
    }

    const payload = {
      query: query.trim(),
      page: 1
    };

    const apiType = this.toApiType(type);
    if (apiType) {
      payload.type = apiType;
    }

    const response = await this.fetchJson(`${this.apiUrl}/api/search/query`, {
      method: "POST",
      body: payload
    });

    return this.normalizeMediaEntries(response?.data)
      .map((item) => this.mapSearchItem(item, type))
      .filter(Boolean);
  }

  async getMeta({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const media = await this.fetchMedia(target.mediaId);
    const resolvedType = this.resolveMediaType(media?.type, type);
    const videos = resolvedType === "series"
      ? await this.fetchEpisodeVideos(target.mediaId)
      : [];

    return {
      id: buildStremioId(this.id, resolvedType, String(target.mediaId)),
      type: resolvedType,
      name: this.resolveMediaTitle(media),
      poster: this.toImageUrl(media?.poster_path),
      background: this.toImageUrl(media?.backdrop_path) || this.toImageUrl(media?.poster_path),
      description: media?.content || "",
      genres: this.collectGenres(media),
      cast: [],
      videos
    };
  }

  async getStreams({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const links = await this.fetchLinks(target);

    if (!links.length) {
      return [];
    }

    const streamGroups = await Promise.all(
      links
        .filter((link) => this.isSourceEnabled(this.detectServer(link.server?.name || "")))
        .map((link) => this.resolveLinkStream(link))
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
      const seriesMeta = await this.getMeta({
        type: "series",
        slug
      });

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
    debug.targetUrl = target.kind === "movie"
      ? `${this.apiUrl}/api/links/movie/${target.targetId}`
      : `${this.apiUrl}/api/links/episode/${target.targetId}`;

    const links = await this.fetchLinks(target);
    const enabledLinks = links.filter((link) => this.isSourceEnabled(this.detectServer(link.server?.name || "")));

    debug.playerCount = enabledLinks.length;
    debug.players = enabledLinks.map((link) => ({
      server: this.detectServer(link.server?.name || ""),
      quality: link.quality?.name || "",
      pageUrl: link.link || ""
    }));

    if (!enabledLinks.length) {
      debug.status = "no_players";
      return debug;
    }

    const streamGroups = await Promise.all(enabledLinks.map((link) => this.resolveLinkStream(link)));
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

  mapSearchItem(item, requestedType) {
    const mediaId = Number(item?.idMedia);
    if (!mediaId) {
      return null;
    }

    const resolvedType = this.resolveMediaType(item?.type, requestedType);
    if (!resolvedType) {
      return null;
    }

    return {
      id: buildStremioId(this.id, resolvedType, String(mediaId)),
      type: resolvedType,
      name: this.resolveMediaTitle(item),
      poster: this.toImageUrl(item?.poster_path),
      posterShape: "poster",
      description: item?.content || "",
      genres: this.collectGenres(item),
      releaseInfo: item?.release_date || ""
    };
  }

  parseSlugPayload(type, slug) {
    const value = String(slug || "");

    if (type === "series" && value.startsWith("ep:")) {
      const [, episodeId, seasonNumber, episodeNumber, seriesId] = value.split(":");
      return {
        kind: "episode",
        mediaId: Number(seriesId) || 0,
        targetId: Number(episodeId) || 0,
        seasonNumber: Number(seasonNumber) || 1,
        episodeNumber: Number(episodeNumber) || 1
      };
    }

    return {
      kind: type === "movie" ? "movie" : "series",
      mediaId: Number(value) || 0,
      targetId: Number(value) || 0
    };
  }

  async fetchLinks(target) {
    const endpoint = target.kind === "movie"
      ? `${this.apiUrl}/api/links/movie/${target.targetId}`
      : `${this.apiUrl}/api/links/episode/${target.targetId}`;

    const payload = await this.fetchJson(endpoint);
    return Array.isArray(payload?.data) ? payload.data : [];
  }

  async resolveLinkStream(link) {
    const sourceName = this.detectServer(link.server?.name || "");
    const sourceKey = `${this.id}:${sourceName}`;
    const directUrl = link?.link;

    if (!directUrl || !/^https?:\/\//i.test(directUrl)) {
      markSourceFailure(sourceKey);
      return [];
    }

    try {
      const label = this.buildLinkLabel(link, sourceName);
      const extracted = await resolveExtractorStream(directUrl, label, true);

      if (extracted.length > 0) {
        markSourceSuccess(sourceKey);
        return extracted.map((stream) => ({
          ...stream,
          name: "MhdFlix",
          _sourceKey: sourceKey
        }));
      }

      if (/\.(m3u8|mp4)(\?|$)/i.test(directUrl)) {
        markSourceSuccess(sourceKey);
        return [
          {
            ...buildStream("MhdFlix", label, directUrl, null, true),
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

  buildLinkLabel(link, sourceName) {
    const parts = [];
    const languageTag = this.toLanguageTag(link?.language?.name);
    const quality = String(link?.quality?.name || "").trim();

    if (languageTag) parts.push(languageTag);
    parts.push(sourceName);
    if (quality) parts.push(quality);

    return parts.join(" ").trim();
  }

  detectServer(value) {
    const lower = String(value || "").toLowerCase();

    if (lower.includes("streamwish")) return "streamwish";
    if (lower.includes("filemoon")) return "filemoon";
    if (lower.includes("streamvid")) return "vidhide";
    if (lower.includes("vidhide")) return "vidhide";
    if (lower.includes("voe")) return "voe";
    if (lower.includes("uqload")) return "uqload";
    if (lower.includes("lulu")) return "lulu";
    if (lower.includes("streamtape")) return "streamtape";
    if (lower.includes("dood")) return "doodstream";
    if (lower.includes("mixdrop")) return "mixdrop";
    if (lower.includes("filelions")) return "vidhide";
    if (lower.includes("hexupload")) return "hexupload";
    if (lower.includes("netu")) return "netu";

    return lower || "generic";
  }

  async fetchEpisodeVideos(mediaId) {
    const seasonsPayload = await this.fetchJson(`${this.apiUrl}/api/serie/${mediaId}/seasons`);
    const seasons = Array.isArray(seasonsPayload?.data) ? seasonsPayload.data : [];
    const videos = [];

    for (const season of seasons) {
      const seasonId = Number(season?.idSeasson);
      const seasonNumber = Number(season?.num) || 1;
      if (!seasonId) {
        continue;
      }

      let page = 1;
      while (true) {
        const payload = await this.fetchJson(`${this.apiUrl}/api/serie/episodes/${seasonId}/${page}`);
        const episodes = Array.isArray(payload?.data) ? payload.data : [];

        for (const episode of episodes) {
          const episodeId = Number(episode?.idEpisodios);
          if (!episodeId) {
            continue;
          }

          const episodeNumber = Number(episode?.numEpisode) || 0;
          const episodeDisplay = Number.isInteger(episodeNumber)
            ? String(Math.trunc(episodeNumber))
            : String(episodeNumber);
          const titleSuffix = String(episode?.title || "").trim();
          const title = [`T${seasonNumber}x${episodeDisplay}`, titleSuffix].filter(Boolean).join(" - ");

          videos.push({
            id: buildStremioId(this.id, "series", `ep:${episodeId}:${seasonNumber}:${episodeNumber}:${mediaId}`),
            title,
            season: seasonNumber,
            episode: episodeNumber,
            released: episode?.air_date || undefined,
            thumbnail: this.toImageUrl(episode?.poster_path)
          });
        }

        const totalPage = Number(payload?.totalPage) || page;
        if (page >= totalPage) {
          break;
        }

        page += 1;
      }
    }

    return videos.sort((a, b) => {
      const seasonDiff = Number(b.season) - Number(a.season);
      if (seasonDiff !== 0) return seasonDiff;
      return Number(b.episode) - Number(a.episode);
    });
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

  normalizeMediaEntries(data) {
    if (Array.isArray(data)) {
      return data;
    }

    if (data && typeof data === "object") {
      return [data];
    }

    return [];
  }

  resolveMediaType(sourceType, fallbackType) {
    const normalized = String(sourceType || "").toLowerCase();
    if (normalized === "movie") {
      return "movie";
    }
    if (["tv", "serie", "series", "show"].includes(normalized)) {
      return "series";
    }
    if (fallbackType === "movie" || fallbackType === "series") {
      return fallbackType;
    }
    return "series";
  }

  resolveMediaTitle(media) {
    const title = String(media?.title || "").trim();
    if (title) {
      return title.replace(/\s+/g, " ");
    }

    const slug = String(media?.slug || "").trim();
    if (!slug) {
      return "Sin titulo";
    }

    return slug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  collectGenres(media) {
    return [...new Set([
      ...(Array.isArray(media?.genders) ? media.genders : []),
      ...(Array.isArray(media?.genre) ? media.genre : [])
    ].filter(Boolean))];
  }

  toImageUrl(path) {
    const value = String(path || "").trim();
    return value ? `https://image.tmdb.org/t/p/w500${value}` : null;
  }

  toApiType(type) {
    if (type === "movie") {
      return "movie";
    }
    if (type === "series") {
      return "tv";
    }
    return null;
  }

  toLanguageTag(value) {
    const normalized = String(value || "").toLowerCase();
    if (!normalized) {
      return "";
    }
    if (normalized.includes("lat")) return "[LAT]";
    if (normalized.includes("cast") || normalized.includes("esp")) return "[CAST]";
    if (normalized.includes("sub")) return "[SUB]";
    if (normalized.includes("vose")) return "[VOSE]";
    return `[${String(value).trim()}]`;
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
      const relaxedCandidateWords = relaxedCandidateTitle.split(/\s+/).filter(Boolean);
      const relaxedTargetWords = relaxedTargetTitle.split(/\s+/).filter(Boolean);
      const relaxedWordDelta = Math.abs(relaxedCandidateWords.length - relaxedTargetWords.length);

      if (relaxedCandidateTitle === relaxedTargetTitle) {
        score += 35;
      } else if (
        relaxedCandidateTitle.includes(relaxedTargetTitle) ||
        relaxedTargetTitle.includes(relaxedCandidateTitle)
      ) {
        score += relaxedWordDelta <= 1 ? 20 : 5;
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

  async fetchMedia(mediaId) {
    const payload = await this.fetchJson(`${this.apiUrl}/api/media/${mediaId}`);
    return payload?.data || null;
  }

  async fetchJson(url, options = {}) {
    const method = options.method || "GET";
    const body = options.body
      ? JSON.stringify(options.body)
      : undefined;

    const response = await fetch(url, {
      method,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Origin: this.baseUrl,
        Referer: `${this.baseUrl}/`,
        Accept: "application/json, text/plain, */*",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body
    });

    if (!response.ok) {
      throw new Error(`MhdFlix respondio ${response.status} para ${url}`);
    }

    return response.json();
  }

  async fetchCinemetaMeta(type, externalId) {
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${externalId}.json`;

    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "application/json,text/plain;q=0.9,*/*;q=0.8"
        }
      });

      if (!response.ok) {
        return null;
      }

      const payload = await response.json();
      return payload?.meta || null;
    } catch {
      return null;
    }
  }
}
