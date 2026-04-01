import { buildStremioId } from "../lib/ids.js";
import { resolveExtractorStream } from "../lib/extractors.js";
import { markSourceFailure, markSourceSuccess } from "../lib/penalty-reliability.js";
import { analyzeScoredStreams, scoreAndSelectStreams } from "../lib/stream-scoring.js";
import { Provider } from "./base.js";

export class GnulaProvider extends Provider {
  constructor() {
    super({
      id: "gnula",
      name: "Gnula",
      supportedTypes: ["movie", "series", "anime", "other"]
    });

    this.baseUrl = process.env.GNULA_BASE_URL || "https://gnula.life";
  }

  async search({ type, query }) {
    if (!query?.trim()) {
      return [];
    }

    const url = `${this.baseUrl}/search?q=${encodeURIComponent(query.trim())}&p=1`;
    const html = await this.fetchText(url);
    const pageProps = this.extractNextData(html)?.results;

    if (!pageProps?.data?.length) {
      return [];
    }

    return pageProps.data
      .map((item) => this.mapSearchItem(item, type))
      .filter(Boolean);
  }

  async getMeta({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const html = await this.fetchText(target.url);
    const nextData = this.extractNextData(html);

    if (!nextData?.post) {
      throw new Error(`No se pudo obtener metadata de Gnula para ${target.url}`);
    }

    const post = nextData.post;
    const resolvedType = target.type;
    const videos = resolvedType === "series"
      ? this.buildEpisodeVideos(post)
      : [];

    return {
      id: target.id,
      type: resolvedType,
      name: post.titles?.name || this.unslugify(target.primarySlug),
      poster: post.images?.poster || null,
      background: post.images?.backdrop || null,
      description: post.overview || "",
      genres: (post.genres || []).map((genre) => genre.name).filter(Boolean),
      cast: (post.cast?.acting || []).map((person) => person.name).filter(Boolean),
      videos
    };
  }

  async getStreams({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const html = await this.fetchText(target.url);
    const nextData = this.extractNextData(html);

    const players = target.type === "series"
      ? nextData?.episode?.players
      : nextData?.post?.players;

    if (!players) {
      return [];
    }

    const allPlayers = [
      ...this.mapRegionPlayers(players.latino, "[LAT]"),
      ...this.mapRegionPlayers(players.spanish, "[CAST]"),
      ...this.mapRegionPlayers(players.english, "[SUB]")
    ].filter((player) => this.isSourceEnabled(player.server));

    const streamGroups = await Promise.all(
      allPlayers.map((player) => this.resolvePlayerStream(player))
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

    const candidates = await this.searchWithFallbackQueries({
      type,
      externalMeta
    });

    if (!candidates.length) {
      return [];
    }

    const typeCandidates = candidates.filter((candidate) => candidate.type === type);
    const validCandidates = typeCandidates.length > 0 ? typeCandidates : candidates;

    const bestMatch = this.pickBestCandidate(validCandidates, externalMeta);
    if (!bestMatch) {
      return [];
    }

    const parsed = bestMatch.id.split(":");
    let slug = parsed.slice(2).join(":");

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

    const parsed = bestMatch.id.split(":");
    let slug = parsed.slice(2).join(":");
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
    debug.targetUrl = target.url;

    const html = await this.fetchText(target.url);
    const nextData = this.extractNextData(html);
    const players = target.type === "series"
      ? nextData?.episode?.players
      : nextData?.post?.players;

    const allPlayers = players
      ? [
          ...this.mapRegionPlayers(players.latino, "[LAT]"),
          ...this.mapRegionPlayers(players.spanish, "[CAST]"),
          ...this.mapRegionPlayers(players.english, "[SUB]")
        ].filter((player) => this.isSourceEnabled(player.server))
      : [];

    debug.playerCount = allPlayers.length;
    debug.players = allPlayers.map((player) => ({
      lang: player.lang,
      server: player.server,
      quality: player.quality,
      pageUrl: player.pageUrl
    }));

    if (!allPlayers.length) {
      debug.status = "no_players";
      return debug;
    }

    const streamGroups = await Promise.all(
      allPlayers.map((player) => this.resolvePlayerStream(player))
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

  sortStreams(streams) {
    return scoreAndSelectStreams(this.id, streams, {
      cleanTitle: (title) => this.cleanStreamTitle(title)
    });
  }

  cleanStreamTitle(title) {
    return title
      .replace(/\s+/g, " ")
      .replace(/\bHD GenericM3U8\b/gi, "HD")
      .replace(/\bVidHide HLS\b/gi, "VidHide")
      .replace(/\bNetu HLS\b/gi, "Netu")
      .replace(/\bStreamWish HLS\b/gi, "StreamWish")
      .replace(/\bVoe HLS\b/gi, "Voe")
      .replace(/\bVoe MP4\b/gi, "Voe")
      .trim();
  }

  slugify(value) {
    return value
      .normalize("NFD")
      .replaceAll(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "");
  }

  unslugify(value) {
    return value
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  mapSearchItem(item, requestedType) {
    const pathSlug = item?.url?.slug || "";
    const normalizedType = this.resolveTypeFromPath(pathSlug, requestedType);
    const slug = item?.slug?.name;

    if (!slug || !normalizedType) {
      return null;
    }

    return {
      id: buildStremioId(this.id, normalizedType, slug),
      type: normalizedType,
      name: item?.titles?.name || this.unslugify(slug),
      poster: item?.images?.poster?.replace("/original/", "/w200/") || null,
      posterShape: "poster",
      description: "",
      genres: [],
      releaseInfo: item?.releaseDate || ""
    };
  }

  resolveTypeFromPath(pathSlug, fallbackType) {
    if (typeof pathSlug === "string") {
      if (pathSlug.includes("series")) {
        return "series";
      }

      if (pathSlug.includes("movies")) {
        return fallbackType === "anime" || fallbackType === "other" ? fallbackType : "movie";
      }
    }

    return fallbackType || "movie";
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

    const sameEpisode = videos.filter((video) => Number(video.episode) === episode);

    if (sameEpisode.length === 1) {
      return sameEpisode[0];
    }

    if (sameEpisode.length > 1) {
      const sameSeason = sameEpisode.find((video) => Number(video.season) === season);
      if (sameSeason) {
        return sameSeason;
      }
    }

    // Some sites mislabel seasons but keep chronological episode order.
    // If the requested season has no exact representation, fall back to the
    // Nth episode inside the requested season block as exposed by Stremio.
    const ordered = [...videos].sort((a, b) => {
      const seasonDiff = Number(a.season) - Number(b.season);
      if (seasonDiff !== 0) return seasonDiff;
      return Number(a.episode) - Number(b.episode);
    });

    const seasonBlock = ordered.filter((video) => Number(video.season) === season);
    if (seasonBlock.length >= episode) {
      return seasonBlock[episode - 1];
    }

    // Last fallback: for single-season or badly tagged shows, use absolute episode number.
    if (ordered.length >= episode) {
      return ordered[episode - 1];
    }

    return null;
  }

  buildEpisodeVideos(post) {
    const videos = [];

    for (const season of post.seasons || []) {
      for (const episode of season.episodes || []) {
        const seasonNumber = String(episode?.slug?.season || season?.number || "");
        const episodeNumber = String(episode?.slug?.episode || episode?.number || "");
        const episodeSlug = episode?.slug?.name;

        if (!seasonNumber || !episodeNumber || !episodeSlug) {
          continue;
        }

        videos.push({
          id: buildStremioId(this.id, "series", `${episodeSlug}:${seasonNumber}:${episodeNumber}`),
          title: episode?.title || `T${seasonNumber} E${episodeNumber}`,
          season: Number(seasonNumber) || 1,
          episode: Number(episodeNumber) || 1,
          released: episode?.releaseDate || undefined,
          thumbnail: episode?.image || null
        });
      }
    }

    return videos.reverse();
  }

  parseSlugPayload(type, slug) {
    if (type === "series" && slug.includes(":")) {
      const [episodeSlug, seasonNumber, episodeNumber] = slug.split(":");
      return {
        id: buildStremioId(this.id, type, slug),
        type,
        primarySlug: episodeSlug,
        seasonNumber,
        episodeNumber,
        url: `${this.baseUrl}/series/${episodeSlug}/seasons/${seasonNumber}/episodes/${episodeNumber}`
      };
    }

    const section = type === "series" ? "series" : "movies";
    return {
      id: buildStremioId(this.id, type, slug),
      type,
      primarySlug: slug,
      url: `${this.baseUrl}/${section}/${slug}`
    };
  }

  mapRegionPlayers(regions, lang) {
    return (regions || []).map((region) => ({
      lang,
      server: region.cyberlocker || "Desconocido",
      quality: region.quality || "",
      pageUrl: region.result || ""
    })).filter((item) => item.pageUrl);
  }

  async resolvePlayerStream(player) {
    const sourceKey = `${this.id}:${String(player.server || "generic").toLowerCase()}`;
    try {
      const html = await this.fetchText(player.pageUrl);
      const directUrl = this.extractVarUrl(html) || player.pageUrl;
      const label = [player.lang, player.server, player.quality].filter(Boolean).join(" ");
      const shouldProxy = true;
      const extracted = await resolveExtractorStream(directUrl, label, shouldProxy);

      if (extracted.length > 0) {
        markSourceSuccess(sourceKey);
        return extracted.map((stream) => ({
          ...stream,
          _sourceKey: sourceKey
        }));
      }

      if (/\.(m3u8|mp4)(\?|$)/i.test(directUrl)) {
        markSourceSuccess(sourceKey);
        return [
          buildStream("Gnula", label, directUrl, player.pageUrl, shouldProxy)
        ];
      }
    } catch {
      markSourceFailure(sourceKey);
      return [];
    }

    markSourceFailure(sourceKey);
    return [];
  }

  extractVarUrl(html) {
    const match = html.match(/var\s+url\s*=\s*'([^']+)'/i);
    return match?.[1] || null;
  }

  extractNextData(html) {
    const nextDataMatch = html.match(/<script[^>]*>\s*self\.__NEXT_DATA__\s*=\s*({.+?})\s*<\/script>/is);

    if (nextDataMatch) {
      try {
        const parsed = JSON.parse(nextDataMatch[1]);
        return parsed?.props?.pageProps || null;
      } catch {
        return null;
      }
    }

    const inlineScriptMatches = Array.from(
      html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi),
      (match) => match[1]
    );

    for (const scriptContent of inlineScriptMatches) {
      const marker = "{\"props\":{\"pageProps\":";
      const startIndex = scriptContent.indexOf(marker);

      if (startIndex === -1) {
        continue;
      }

      const jsonCandidate = this.extractBalancedJson(scriptContent.slice(startIndex));

      if (!jsonCandidate) {
        continue;
      }

      try {
        const parsed = JSON.parse(jsonCandidate);
        return parsed?.props?.pageProps || null;
      } catch {
        continue;
      }
    }

    return null;
  }

  extractBalancedJson(text) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;

        if (depth === 0) {
          return text.slice(0, index + 1);
        }
      }
    }

    return null;
  }

  async fetchText(url) {
    let response;

    try {
      response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
    } catch (error) {
      const details = error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
      throw new Error(`No se pudo conectar con Gnula en ${url}. ${details}`);
    }

    if (!response.ok) {
      throw new Error(`Gnula respondio ${response.status} para ${url}`);
    }

    return response.text();
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
      const details = error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
      throw new Error(`No se pudo obtener JSON desde ${url}. ${details}`);
    }

    if (!response.ok) {
      throw new Error(`JSON endpoint respondio ${response.status} para ${url}`);
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
