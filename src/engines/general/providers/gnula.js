import { buildStremioId } from "../../../lib/ids.js";
import { buildStream, resolveExtractorStream } from "../../../lib/extractors.js";
import { markSourceFailure, markSourceSuccess } from "../../../lib/penalty-reliability.js";
import { analyzeScoredStreams, scoreAndSelectStreams } from "../scoring.js";
import { getTmdbMeta, hasTmdbCredentials } from "../../anime/runtime/lib/metadata.js";
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

  async getCatalogItems({ type, catalogId, extra = {} }) {
    if (String(catalogId || "") === "gnula|search") {
      return this.search({
        type: null,
        query: String(extra.search || "").trim()
      });
    }

    const url = this.buildCatalogUrl(catalogId, extra);
    if (!url) {
      return [];
    }

    const html = await this.fetchText(url);
    const nextData = this.extractNextData(html);
    const itemType = this.resolveCatalogType(type, catalogId);
    const items = this.extractCatalogItems(nextData, catalogId, itemType);
    return this.dedupeById(items);
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
      ? this.buildEpisodeVideos(post, html)
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
      runtime: post.runtime || undefined,
      directors: (post.cast?.directing || []).map((person) => person.name).filter(Boolean),
      countries: (post.cast?.countries || []).map((country) => country.name).filter(Boolean),
      videos
    };
  }

  async getStreams({ type, slug }) {
    const target = this.parseSlugPayload(type, slug);
    const html = await this.fetchText(target.url);
    const nextData = this.extractNextData(html);

    const allPlayers = this.collectPlayersFromPage({
      target,
      nextData,
      html
    });

    if (!allPlayers.length) {
      return [];
    }

    const streamGroups = await Promise.all(
      allPlayers.map((player) => this.resolvePlayerStream(player))
    );

    const rawStreams = streamGroups.flat().filter(Boolean);
    const displayTitle = this.extractDisplayTitleForTarget(target, nextData);
    return this.sortStreams(this.attachDisplayTitle(rawStreams, displayTitle));
  }

  async getStreamsFromExternalId({ type, externalId }) {
    if (!externalId?.startsWith("tt")) {
      return [];
    }

    const parsedExternal = this.parseExternalStremioId(type, externalId);
    const externalMeta = await this.fetchExternalSearchMetadata(type, parsedExternal.baseId);
    if (!externalMeta?.name) {
      return [];
    }

    const matchBundle = await this.findBestExternalMatch({
      type,
      externalMeta
    });

    if (!matchBundle?.bestMatch) {
      return [];
    }

    const bestMatch = matchBundle.bestMatch;

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

    const externalMeta = await this.fetchExternalSearchMetadata(type, parsedExternal.baseId);
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

    const matchBundle = await this.findBestExternalMatch({
      type,
      externalMeta
    });
    debug.queries = matchBundle.queries;
    debug.queryStrategy = matchBundle.queryStrategy;
    debug.queryTerms = matchBundle.queryTerms;
    debug.searchMetadata = {
      name: externalMeta.name,
      originalTitle: externalMeta.originalTitle || null,
      aliases: Array.isArray(externalMeta.aliases) ? externalMeta.aliases.slice(0, 20) : []
    };

    const candidates = matchBundle.candidates;
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

    const bestMatch = matchBundle.bestMatch;
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
    const allPlayers = this.collectPlayersFromPage({
      target,
      nextData,
      html
    });

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

    const playerDebug = await Promise.all(
      allPlayers.map((player) => this.resolvePlayerStreamDebug(player))
    );

    debug.playerDebug = playerDebug.map((item) => ({
      lang: item.player.lang,
      server: item.player.server,
      quality: item.player.quality,
      pageUrl: item.player.pageUrl,
      directUrl: item.directUrl || null,
      extractedCount: item.streams.length,
      extractedTitles: item.streams.map((stream) => stream.title),
      error: item.error || null
    }));

    const rawStreams = playerDebug.flatMap((item) => item.streams).filter(Boolean);
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

  async findBestExternalMatch({ type, externalMeta }) {
    const primaryTerms = this.buildSearchQueries(externalMeta, { expanded: false });
    const primaryCandidates = await this.searchWithQueries({ type, queries: primaryTerms });
    const primaryBest = this.pickBestCandidate(primaryCandidates, externalMeta);

    if (primaryBest) {
      return {
        queryStrategy: "primary",
        queryTerms: primaryTerms,
        queries: primaryTerms,
        candidates: primaryCandidates,
        bestMatch: primaryBest
      };
    }

    const expandedMeta = await this.fetchExpandedExternalMetadata(externalMeta);
    const expandedTerms = this.buildSearchQueries(expandedMeta, { expanded: true });
    const expandedCandidates = await this.searchWithQueries({ type, queries: expandedTerms });
    const expandedBest = this.pickBestCandidate(expandedCandidates, expandedMeta);

    return {
      queryStrategy: expandedMeta !== externalMeta ? "expanded" : "primary",
      queryTerms: expandedTerms,
      queries: expandedTerms,
      candidates: expandedCandidates,
      bestMatch: expandedBest
    };
  }

  async searchWithQueries({ type, queries }) {
    const terms = [...new Set((queries || []).filter(Boolean))];
    if (terms.length === 0) {
      return [];
    }

    return this.searchWithFallbackQueries({
      type,
      externalMeta: {
        name: terms[0]
      },
      queriesOverride: terms
    });
  }

  buildSearchQueries(externalMeta, { expanded = false } = {}) {
    const rawTerms = [
      externalMeta?.name,
      externalMeta?.originalTitle,
      ...(Array.isArray(externalMeta?.aliases) ? externalMeta.aliases : []),
      ...(Array.isArray(externalMeta?.alternativeTitles) ? externalMeta.alternativeTitles : [])
    ].filter(Boolean);

    const queries = [];
    const seen = new Set();

    const pushQuery = (value) => {
      const normalized = String(value || "").trim();
      if (!normalized || normalized.length < 2) {
        return;
      }

      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      queries.push(normalized);
    };

    for (const term of rawTerms) {
      pushQuery(term);
      pushQuery(term.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim());
      pushQuery(String(term).split(":")[0].trim());
      pushQuery(String(term).replace(/\b(the|a|an)\b/gi, " ").replace(/\s+/g, " ").trim());
    }

    return expanded ? queries.slice(0, 8) : queries.slice(0, 4);
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

  extractDisplayTitleForTarget(target, nextData) {
    const seriesName = String(nextData?.post?.titles?.name || "").replace(/\s+/g, " ").trim();
    const episodeTitle = String(nextData?.episode?.title || "").replace(/\s+/g, " ").trim();

    if (target?.type === "series") {
      if (seriesName && episodeTitle && !episodeTitle.toLowerCase().includes(seriesName.toLowerCase())) {
        return `${seriesName} - ${episodeTitle}`;
      }

      if (episodeTitle) {
        return episodeTitle;
      }
    }

    return seriesName || this.unslugify(target?.primarySlug || "");
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
      const lowerPath = pathSlug.toLowerCase();
      if (lowerPath.includes("/series/")) {
        return "series";
      }
      if (lowerPath.includes("/movies/")) {
        return "movie";
      }
    }

    return fallbackType === "series" ? "series" : "movie";
  }

  extractCatalogItems(nextData, catalogId, itemType) {
    const id = String(catalogId || "");
    const resultsData = Array.isArray(nextData?.results?.data) ? nextData.results.data : null;
    if (resultsData?.length) {
      return resultsData
        .map((item) => this.mapSearchItem(item, itemType))
        .filter(Boolean);
    }

    const fallbackMap = {
      "gnula|movies|latest": nextData?.lastMovies?.data,
      "gnula|movies|popular": nextData?.topDayMovies?.data,
      "gnula|series|latest": nextData?.lastSeries?.data,
      "gnula|series|popular": nextData?.topDaySeries?.data
    };

    return (Array.isArray(fallbackMap[id]) ? fallbackMap[id] : [])
      .map((item) => this.mapSearchItem(item, itemType))
      .filter(Boolean);
  }

  buildCatalogUrl(catalogId, extra = {}) {
    const pageSize = 19;
    const page = Math.max(1, Math.floor(Number(extra.skip || 0) / pageSize) + 1);
    const suffix = page > 1 ? `/page/${page}` : "";
    const id = String(catalogId || "");
    const genre = this.normalizeGenreFilter(extra.genre);

    if (id === "gnula|movies|latest") {
      return `${this.baseUrl}/archives/movies${suffix}`;
    }

    if (id === "gnula|movies|popular") {
      if (genre && genre !== "top") {
        return `${this.baseUrl}/genres/${genre}${suffix}`;
      }

      return `${this.baseUrl}/archives/movies/top/day${suffix}`;
    }

    if (id === "gnula|series|latest") {
      return `${this.baseUrl}/archives/series${suffix}`;
    }

    if (id === "gnula|series|popular") {
      if (genre && genre !== "top") {
        return `${this.baseUrl}/genres/${genre}${suffix}`;
      }

      return `${this.baseUrl}/archives/series/top/day${suffix}`;
    }

    return null;
  }

  resolveCatalogType(type, catalogId) {
    if (type === "movie" || type === "series") {
      return type;
    }

    return String(catalogId || "").includes("|series|") ? "series" : "movie";
  }

  pickBestCandidate(candidates, externalMeta) {
    const targetTitle = this.normalizeTitle(externalMeta.name);
    const targetYear = this.extractYear(externalMeta.releaseInfo || externalMeta.year || "");
    const targetWords = targetTitle.split(/\s+/).filter(Boolean);
    const aliasTitles = [
      targetTitle,
      this.normalizeTitle(externalMeta.originalTitle || ""),
      ...(Array.isArray(externalMeta.aliases) ? externalMeta.aliases.map((alias) => this.normalizeTitle(alias)) : [])
    ].filter(Boolean);
    const anchorWords = Array.from(new Set(
      aliasTitles
        .flatMap((title) => title.split(/\s+/))
        .filter((word) => word.length >= 4 && !/^\d+$/.test(word))
    ));

    const scored = candidates.map((candidate) => {
      const candidateTitle = this.normalizeTitle(candidate.name);
      const candidateYear = this.extractYear(candidate.releaseInfo || "");
      const titleSimilarity = this.stringSimilarity(candidateTitle, targetTitle);
      const candidateWords = candidateTitle.split(/\s+/).filter(Boolean);
      const wordDelta = Math.abs(candidateWords.length - targetWords.length);
      const wordOverlap = targetWords.filter((word) => candidateWords.includes(word)).length;
      const aliasSimilarity = Math.max(
        ...aliasTitles.map((aliasTitle) => this.stringSimilarity(candidateTitle, aliasTitle))
      );
      const anchorOverlap = anchorWords.filter((word) => candidateWords.includes(word)).length;
      const hasLatinLetters = /[a-z]/i.test(candidateTitle);
      const hasAnyLexicalEvidence = wordOverlap > 0 || anchorOverlap > 0 || aliasSimilarity >= 0.55;

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

      if (aliasSimilarity >= 0.92) {
        score += 85;
      } else if (aliasSimilarity >= 0.84) {
        score += 50;
      } else if (aliasSimilarity >= 0.72) {
        score += 18;
      }

      score += anchorOverlap * 70;

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

      if (!hasAnyLexicalEvidence) {
        score -= 220;
      }

      if (!hasLatinLetters && anchorWords.length > 0) {
        score -= 160;
      }

      return { candidate, score, titleSimilarity, relaxedSimilarity, aliasSimilarity, wordOverlap, anchorOverlap };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0] || null;
    if (!best || best.score <= 0) {
      return null;
    }

    const hasStrongExactness =
      best.score >= 40 ||
      best.titleSimilarity >= 0.84 ||
      best.relaxedSimilarity >= 0.9 ||
      best.aliasSimilarity >= 0.84;
    const hasWordEvidence =
      best.wordOverlap >= Math.min(Math.max(targetWords.length, 1), 2) ||
      (targetWords.length === 1 && best.wordOverlap >= 1) ||
      best.anchorOverlap >= 1;

    return hasStrongExactness || hasWordEvidence ? best.candidate : null;
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

  buildEpisodeVideos(post, html = "") {
    const merged = new Map();
    const posterFallback = post?.images?.poster || null;

    for (const season of post.seasons || []) {
      for (const episode of season.episodes || []) {
        const seasonNumber = Number(episode?.slug?.season || season?.number || 0);
        const episodeNumber = Number(episode?.slug?.episode || episode?.number || 0);
        const episodeSlug = episode?.slug?.name;

        if (!seasonNumber || !episodeNumber || !episodeSlug) {
          continue;
        }

        this.mergeEpisodeVideo(merged, {
          id: buildStremioId(this.id, "series", `${episodeSlug}:${seasonNumber}:${episodeNumber}`),
          title: episode?.title || `T${seasonNumber} E${episodeNumber}`,
          season: seasonNumber,
          episode: episodeNumber,
          released: episode?.releaseDate || undefined,
          thumbnail: episode?.image || posterFallback
        });
      }
    }

    for (const episode of this.extractEpisodeVideosFromHtml(html, posterFallback)) {
      this.mergeEpisodeVideo(merged, episode);
    }

    return Array.from(merged.values()).sort((a, b) => {
      const seasonDiff = Number(a.season) - Number(b.season);
      if (seasonDiff !== 0) return seasonDiff;
      return Number(a.episode) - Number(b.episode);
    });
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
    const result = await this.resolvePlayerStreamDebug(player);
    return result.streams;
  }

  async resolvePlayerStreamDebug(player) {
    const sourceKey = `${this.id}:${String(player.server || "generic").toLowerCase()}`;
    try {
      const directUrl = await this.resolvePlayerIntermediateUrl(player.pageUrl);
      const label = [player.lang, player.server, player.quality].filter(Boolean).join(" ");
      const shouldProxy = true;
      const extracted = await resolveExtractorStream(directUrl, label, shouldProxy);

      if (extracted.length > 0) {
        markSourceSuccess(sourceKey);
        return {
          player,
          directUrl,
          streams: extracted.map((stream) => ({
            ...stream,
            _sourceKey: sourceKey
          })),
          error: null
        };
      }

      if (/\.(m3u8|mp4)(\?|$)/i.test(directUrl)) {
        markSourceSuccess(sourceKey);
        return {
          player,
          directUrl,
          streams: [
            buildStream("Gnula", label, directUrl, player.pageUrl, shouldProxy)
          ],
          error: null
        };
      }
    } catch (error) {
      markSourceFailure(sourceKey);
      return {
        player,
        directUrl: null,
        streams: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }

    markSourceFailure(sourceKey);
    return {
      player,
      directUrl: null,
      streams: [],
      error: null
    };
  }

  extractPlayerUrl(html, baseUrl = null) {
    const patterns = [
      /var\s+url\s*=\s*['"]([^'"]+)['"]/i,
      /(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i,
      /(?:window\.)?location(?:\.href)?\.replace\(\s*['"]([^'"]+)['"]\s*\)/i,
      /(?:window\.)?location\.assign\(\s*['"]([^'"]+)['"]\s*\)/i,
      /(?:window\.)?location(?:\.href)?\s*=\s*url\b/i
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);

      if (match?.[1]) {
        return this.resolveMaybeRelativeUrl(match[1], baseUrl);
      }
    }

    const startUrl = html.match(/id\s*=\s*['"]start['"][\s\S]{0,1200}?window\.location\.href\s*=\s*url/i);
    if (startUrl) {
      const varMatch = html.match(/var\s+url\s*=\s*['"]([^'"]+)['"]/i);
      if (varMatch?.[1]) {
        return this.resolveMaybeRelativeUrl(varMatch[1], baseUrl);
      }
    }

    const iframeMatch = html.match(/<iframe[^>]+src=['"]([^'"]+)['"][^>]*>/i);
    if (iframeMatch?.[1]) {
      return this.resolveMaybeRelativeUrl(iframeMatch[1], baseUrl);
    }

    const absoluteMatch = html.match(/https?:\/\/(?:www\.)?(?:streamtape\.(?:com|to|net|xyz|ca|cc|site|link))\/(?:e|v)\/[A-Za-z0-9_-]+/i);
    return absoluteMatch?.[0] || null;
  }

  collectPlayersFromPage({ target, nextData, html }) {
    const players = target.type === "series"
      ? nextData?.episode?.players
      : nextData?.post?.players;

    const mappedPlayers = players
      ? [
          ...this.mapRegionPlayers(players.latino, "[LAT]"),
          ...this.mapRegionPlayers(players.spanish, "[CAST]"),
          ...this.mapRegionPlayers(players.english, "[SUB]")
        ]
      : [];

    const fallbackPlayers = mappedPlayers.length > 0
      ? []
      : this.extractIframePlayersFromHtml(html);

    return [...mappedPlayers, ...fallbackPlayers]
      .filter((player) => player?.pageUrl)
      .filter((player) => this.isSourceEnabled(player.server))
      .filter((player, index, items) =>
        items.findIndex((candidate) => candidate.pageUrl === player.pageUrl && candidate.lang === player.lang) === index
      );
  }

  extractIframePlayersFromHtml(html) {
    const iframeUrls = this.extractIframeUrls(html);
    return iframeUrls.map((pageUrl) => ({
      lang: "",
      server: this.inferServerNameFromUrl(pageUrl) || "iframe",
      quality: "",
      pageUrl
    }));
  }

  extractIframeUrls(html, baseUrl = this.baseUrl) {
    const matches = Array.from(
      html.matchAll(/<iframe[^>]+src=['"]([^'"]+)['"][^>]*>/gi),
      (match) => this.resolveMaybeRelativeUrl(match[1], baseUrl)
    ).filter(Boolean);

    return Array.from(new Set(matches));
  }

  async resolvePlayerIntermediateUrl(pageUrl, maxDepth = 2) {
    let currentUrl = pageUrl;

    for (let depth = 0; depth <= maxDepth; depth += 1) {
      if (!this.shouldFollowIntermediateUrl(currentUrl)) {
        return currentUrl;
      }

      const html = await this.fetchText(currentUrl);
      const discoveredUrl = this.extractPlayerUrl(html, currentUrl);

      if (!discoveredUrl || discoveredUrl === currentUrl) {
        return currentUrl;
      }

      currentUrl = discoveredUrl;
    }

    return currentUrl;
  }

  shouldFollowIntermediateUrl(url) {
    if (!url || /\.(m3u8|mp4)(\?|$)/i.test(url)) {
      return false;
    }

    return /player\.gnula\.life\/player\.php/i.test(url)
      || /gnula\.life\//i.test(url);
  }

  resolveMaybeRelativeUrl(url, baseUrl = this.baseUrl) {
    if (!url) {
      return null;
    }

    try {
      return new URL(url, baseUrl).toString();
    } catch {
      return url;
    }
  }

  inferServerNameFromUrl(url) {
    const normalized = String(url || "").toLowerCase();
    const knownServers = ["streamwish", "vidhide", "voe", "voesx", "doodstream", "streamtape", "netu", "filemoon"];
    const match = knownServers.find((server) => normalized.includes(server));
    if (match) {
      return match;
    }

    if (normalized.includes("player.gnula.life/player.php")) {
      return "player";
    }

    try {
      return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      return "iframe";
    }
  }

  extractEpisodeVideosFromHtml(html, posterFallback = null) {
    const matches = Array.from(
      html.matchAll(/<a[^>]+href=['"]([^"'<>]*\/series\/[^"'<>]+\/seasons\/(\d+)\/episodes\/(\d+))['"][^>]*>([\s\S]*?)<\/a>/gi)
    );

    return matches.map((match) => {
      const url = this.resolveMaybeRelativeUrl(match[1], this.baseUrl);
      const season = Number(match[2]) || 1;
      const episode = Number(match[3]) || 1;
      const episodeSlug = this.extractEpisodeSlugFromUrl(url);
      const blockHtml = match[4] || "";
      const title = this.cleanHtmlText(blockHtml) || `T${season} E${episode}`;
      const thumbnail = this.extractImageFromHtml(blockHtml) || posterFallback;

      if (!episodeSlug) {
        return null;
      }

      return {
        id: buildStremioId(this.id, "series", `${episodeSlug}:${season}:${episode}`),
        title,
        season,
        episode,
        thumbnail
      };
    }).filter(Boolean);
  }

  mergeEpisodeVideo(map, candidate) {
    const key = `${candidate.id}:${candidate.season}:${candidate.episode}`;
    const current = map.get(key);

    if (!current) {
      map.set(key, candidate);
      return;
    }

    const candidateScore = this.scoreEpisodeVideo(candidate);
    const currentScore = this.scoreEpisodeVideo(current);
    if (candidateScore > currentScore) {
      map.set(key, {
        ...current,
        ...candidate
      });
      return;
    }

    map.set(key, {
      ...candidate,
      ...current
    });
  }

  scoreEpisodeVideo(video) {
    let score = 0;
    if (video?.thumbnail) score += 2;
    if (video?.released) score += 1;
    if (video?.title && !/^T\d+\s+E\d+$/i.test(video.title)) score += 1;
    return score;
  }

  extractEpisodeSlugFromUrl(url) {
    const match = String(url || "").match(/\/series\/([^/]+)\/seasons\/\d+\/episodes\/\d+/i);
    return match?.[1] || null;
  }

  extractImageFromHtml(html) {
    const imgMatch = html.match(/<img[^>]+src=['"]([^'"]+)['"][^>]*>/i);
    return imgMatch?.[1] ? this.resolveMaybeRelativeUrl(imgMatch[1], this.baseUrl) : null;
  }

  cleanHtmlText(html) {
    const cleaned = String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned || cleaned.toLowerCase() === "undefined") {
      return "";
    }

    return cleaned;
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

  dedupeById(items) {
    return Array.from(new Map((items || []).map((item) => [item.id, item])).values());
  }

  normalizeGenreFilter(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
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
    try {
      return await fetchTextShared(url, {
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
    } catch (error) {
      const details = error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
      throw new Error(`No se pudo conectar con Gnula en ${url}. ${details}`);
    }
  }

  async fetchJson(url) {
    try {
      return await fetchJsonShared(url, {
        headers: {
          accept: "application/json,text/plain;q=0.9,*/*;q=0.8"
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
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${externalId}.json`;

    try {
      const payload = await this.fetchJson(url);
      return payload?.meta || null;
    } catch {
      return null;
    }
  }

  async fetchExternalSearchMetadata(type, externalId) {
    return this.fetchCinemetaMeta(type, externalId);
  }

  async fetchExpandedExternalMetadata(externalMeta) {
    if (!externalMeta?.id || !hasTmdbCredentials()) {
      return externalMeta;
    }

    try {
      const tmdbMeta = await getTmdbMeta(externalMeta.id);
      return {
        ...externalMeta,
        originalTitle: tmdbMeta?.originalTitle || externalMeta.originalTitle || externalMeta.name,
        aliases: Array.from(new Set([
          ...(Array.isArray(externalMeta.aliases) ? externalMeta.aliases : []),
          ...(Array.isArray(externalMeta.alternativeTitles) ? externalMeta.alternativeTitles : []),
          ...(Array.isArray(tmdbMeta?.aliases) ? tmdbMeta.aliases : []),
          tmdbMeta?.title,
          tmdbMeta?.originalTitle
        ].filter(Boolean)))
      };
    } catch {
      return externalMeta;
    }
  }
}

import { fetchJson as fetchJsonShared, fetchText as fetchTextShared } from "../../../shared/fetch.js";
