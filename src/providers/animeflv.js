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
import {
  isSupportedAnimeExternalId,
  parseAnimeExternalId,
  resolveAnimeImdbId
} from "../lib/anime-relations.js";
import { buildStream, resolveExtractorStream } from "../lib/extractors.js";
import { buildStremioId } from "../lib/ids.js";
import { basicTitleSimilarity, normalizeMediaTitle } from "../lib/tmdb.js";
import { absoluteUrl, mapSearchItem, stripTags } from "../lib/webstreamer/common.js";
import { fetchJson, fetchText } from "../lib/webstreamer/http.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanText(value) {
  return stripTags(value)
    .replace(/\s+/g, " ")
    .trim();
}

function buildUniqueAnimeTitles(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function expandAnimeTitleVariants(values = []) {
  const variants = new Set();

  for (const rawValue of values) {
    const value = String(rawValue || "").trim();
    if (!value) {
      continue;
    }

    variants.add(value);

    const noPunctuation = value.replace(/[!?:]/g, " ").replace(/\s+/g, " ").trim();
    if (noPunctuation) {
      variants.add(noPunctuation);
    }

    const beforeColon = value.split(":")[0]?.trim();
    if (beforeColon) {
      variants.add(beforeColon);
      variants.add(beforeColon.replace(/[!?:]/g, " ").replace(/\s+/g, " ").trim());
    }

    const beforeDash = value.split(" - ")[0]?.trim();
    if (beforeDash) {
      variants.add(beforeDash);
    }
  }

  return [...variants].filter(Boolean);
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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

function extractYear(value) {
  return String(value || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
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

    this.baseUrl = process.env.ANIMEFLV_BASE_URL || "https://www4.animeflv.net";
  }

  buildSearchQueries(externalMeta, extraTitles = []) {
    const baseQueries = super.buildSearchQueries(externalMeta, extraTitles);
    return buildUniqueAnimeTitles(expandAnimeTitleVariants(baseQueries)).slice(0, 8);
  }

  async searchWithFallbackQueries({ type, externalMeta }) {
    const mapping = await this.findAnimeMapping(externalMeta);
    externalMeta._animeMapping = mapping;
    const otakuMapping = this.findOtakuMapping(externalMeta, mapping);
    externalMeta._otakuMapping = otakuMapping;
    const eligible = await this.isAnimeEligible(externalMeta, mapping, otakuMapping);
    externalMeta._animeEligible = eligible;
    if (!eligible) {
      externalMeta._searchTitles = [];
      return [];
    }
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

    if (!items.length) {
      items.push(...this.buildDirectCandidates(type, externalMeta));
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

  buildDirectCandidates(type, externalMeta) {
    const titles = buildUniqueAnimeTitles(expandAnimeTitleVariants([
      externalMeta?.name,
      ...(Array.isArray(externalMeta?._searchTitles) ? externalMeta._searchTitles : [])
    ]));
    const slugs = buildUniqueAnimeTitles(
      titles
        .map((value) => slugify(value))
        .filter(Boolean)
    );

    return slugs.map((slug, index) => mapSearchItem(
      this.id,
      type,
      this.encodePathToken(`/anime/${slug}`),
      titles[index] || this.unslugify(slug),
      ""
    ));
  }

  async getMeta({ type, slug }) {
    const path = this.decodePathToken(slug);
    const pageUrl = absoluteUrl(path, this.baseUrl);
    const html = await fetchText(pageUrl).catch(() => "");
    const info = this.extractAnimeInfoData(pageUrl, html);
    const videos = type === "series"
      ? info.episodes.map((item) => ({
          id: buildStremioId(this.id, "series", this.encodePathToken(item.path)),
          title: `Episodio ${buildEpisodeLabel(item.number)}`,
          season: 1,
          episode: Number.parseInt(String(item.number), 10) || 0,
          ...(info.thumbnailBase ? { thumbnail: info.thumbnailBase.replace("{episode}", String(item.number)) } : {})
        }))
      : [];
    const title = info.title || this.extractTitle(html) || this.unslugify(path);
    const poster = info.cover || this.extractPoster(html);
    const description = info.synopsis || this.extractDescription(html);
    const genres = info.genres?.length ? info.genres : this.extractGenres(html);
    const releaseInfo = info.releaseInfo || this.extractYear(html);
    const links = (info.related || []).map((item) => ({
      name: item.title,
      category: item.relation || "Relacionado",
      url: `stremio:///detail/series/${buildStremioId(this.id, "series", this.encodePathToken(`/anime/${item.slug}`))}`
    }));

    return {
      id: buildStremioId(this.id, type, slug),
      type,
      name: title,
      poster,
      background: poster,
      description,
      genres,
      cast: [],
      videos,
      ...(releaseInfo ? { releaseInfo } : {}),
      ...(links.length ? { links } : {}),
      ...(videos.length === 1 ? { behaviorHints: { defaultVideoId: videos[0].id } } : {})
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
      supported: isSupportedAnimeExternalId(externalId)
    };

    if (!debug.supported) {
      return debug;
    }

    const parsedExternal = parseAnimeExternalId(type, externalId);
    debug.parsedExternal = parsedExternal;
    if (!parsedExternal?.baseId) {
      debug.status = "invalid_external_id";
      return debug;
    }

    const externalMeta = await this.resolveExternalMeta(type, externalId, parsedExternal);
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
    const episodes = this.extractEpisodeEntries(pageUrl, html);
    const thumbnailBase = this.extractEpisodeThumbnailBase(html);
    return episodes.map((item) => ({
      id: buildStremioId(this.id, "series", this.encodePathToken(item.path)),
      title: `Episodio ${buildEpisodeLabel(item.number)}`,
      season: 1,
      episode: Number.parseInt(String(item.number), 10) || 0,
      ...(thumbnailBase ? { thumbnail: thumbnailBase.replace("{episode}", String(item.number)) } : {})
    }));
  }

  resolveEpisodeUrl(pageUrl, html, targetEpisode) {
    const entries = this.extractEpisodeEntries(pageUrl, html);
    const exact = entries.find((item) => Number.parseFloat(String(item.number)) === Number(targetEpisode));
    if (exact) {
      return absoluteUrl(exact.path, this.baseUrl);
    }

    const pathname = new URL(pageUrl).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const slug = segments.length >= 2 ? segments[1] : "";
    if (slug && targetEpisode) {
      return absoluteUrl(`/ver/${slug}-${targetEpisode}`, this.baseUrl);
    }

    return null;
  }

  async resolvePlaybackPage(type, pageUrl, html) {
    if (this.extractRawPlayers(html, pageUrl).length > 0) {
      return { pageUrl, html };
    }

    const entries = this.extractEpisodeEntries(pageUrl, html);
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

  extractEpisodeEntries(pageUrl, html) {
    const script = this.extractAnimeInfoScript(html);
    const episodeSection = script.match(/var\s+episodes\s*=\s*\[([\s\S]*?)\];/i)?.[1] || "";
    const slug = new URL(pageUrl).pathname.split("/").filter(Boolean).pop() || "";

    if (!slug || !episodeSection) {
      return [];
    }

    const episodes = [];
    const episodeRegex = /\[\s*([0-9]+(?:\.[0-9]+)?)\s*,/g;
    let match;
    while ((match = episodeRegex.exec(episodeSection))) {
      const number = match[1];
      episodes.push({
        number,
        path: `/ver/${slug}-${number}`
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

  async resolveExternalMeta(type, externalId, parsedExternal) {
    if (parsedExternal.kind === "tmdb") {
      return this.buildMetaFromTmdb(type, parsedExternal.baseId);
    }

    if (parsedExternal.kind === "imdb") {
      return this.fetchCinemetaMeta(type, parsedExternal.baseId);
    }

    const imdbId = await resolveAnimeImdbId(externalId).catch(() => null);
    if (imdbId) {
      return this.fetchCinemetaMeta(type, imdbId);
    }

    return null;
  }

  extractRawPlayers(html, referer) {
    const script = this.extractVideosScript(html);
    const rawJson = script.match(/var\s+videos\s*=\s*(\{[\s\S]*?\});/i)?.[1] || "";
    if (!rawJson) {
      return [];
    }

    const parsed = safeJsonParse(rawJson, {});
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
    $("body > div.Wrapper > div > div > main > ul > li").each((_, element) => {
      const entry = $(element);
      const href = absoluteUrl(entry.find("a[href*='/anime/']").first().attr("href") || "", this.baseUrl);
      const title = cleanText(entry.find("h3").first().text());
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
    const primaryTitles = buildUniqueAnimeTitles([externalMeta?.name]);
    const primaryNormalizedTitles = primaryTitles.map((value) => normalizeAnimeTitle(value));
    const primarySlugs = primaryTitles.map((value) => slugify(value)).filter(Boolean);
    const mapping = externalMeta?._animeMapping || null;
    const otakuMapping = externalMeta?._otakuMapping || null;
    const mappingTitles = getAnimeMappingTitles(mapping).map((value) => normalizeAnimeTitle(value));
    const otakuTitles = getOtakuMappingTitles(otakuMapping).map((value) => normalizeAnimeTitle(value));
    let best = null;

    for (const candidate of candidates) {
      const candidateTitle = normalizeAnimeTitle(candidate.name);
      const encodedPath = String(candidate?.id || "").split(":").slice(2).join(":");
      const decodedSlug = encodedPath
        ? this.decodePathToken(encodedPath).split("/").filter(Boolean).pop() || ""
        : "";
      let score = 0;

      for (const target of primaryNormalizedTitles) {
        if (!target || !candidateTitle) {
          continue;
        }

        let localScore = basicTitleSimilarity(candidateTitle, target);
        if (candidateTitle === target) {
          localScore = 1.45;
        } else if (candidateTitle.includes(target) || target.includes(candidateTitle)) {
          localScore = Math.max(localScore, 1.2);
        }
        score = Math.max(score, localScore);
      }

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

      for (const target of primarySlugs) {
        if (!target || !decodedSlug) {
          continue;
        }

        if (decodedSlug === target) {
          score = Math.max(score, 1.55);
        } else if (decodedSlug.includes(target) || target.includes(decodedSlug)) {
          score = Math.max(score, 1.25);
        }
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

  async isAnimeEligible(externalMeta, animeMapping = null, otakuMapping = null) {
    if (animeMapping || otakuMapping) {
      return true;
    }

    const tmdbSignals = await this.fetchTmdbAnimeSignals(externalMeta);
    externalMeta._animeSignals = tmdbSignals;
    return Boolean(tmdbSignals?.isAnime);
  }

  async fetchTmdbAnimeSignals(externalMeta) {
    if (externalMeta?._animeSignals) {
      return externalMeta._animeSignals;
    }

    const rawId = String(externalMeta?.id || "");
    const mediaType = externalMeta?.type === "series" ? "tv" : "movie";
    let itemId = "";

    if (rawId.startsWith("tmdb:")) {
      itemId = rawId.replace(/^tmdb:/, "").split(":")[0];
    } else if (rawId.startsWith("tt")) {
      const findPayload = await fetchJson(
        `https://api.themoviedb.org/3/find/${rawId}?api_key=${this.tmdbApiKey}&external_source=imdb_id`
      ).catch(() => null);
      const results = mediaType === "tv" ? findPayload?.tv_results : findPayload?.movie_results;
      itemId = Array.isArray(results) && results[0]?.id ? String(results[0].id) : "";
    }

    if (!itemId) {
      return { isAnime: false };
    }

    const details = await fetchJson(
      `https://api.themoviedb.org/3/${mediaType}/${itemId}?api_key=${this.tmdbApiKey}&language=en-US`
    ).catch(() => null);

    if (!details) {
      return { isAnime: false };
    }

    const genreNames = Array.isArray(details.genres)
      ? details.genres.map((genre) => String(genre?.name || "").toLowerCase())
      : [];
    const originalLanguage = String(details.original_language || "").toLowerCase();
    const originCountries = Array.isArray(details.origin_country)
      ? details.origin_country.map((country) => String(country || "").toUpperCase())
      : [];
    const titleBlob = [
      details.name,
      details.title,
      details.original_name,
      details.original_title
    ].join(" ");
    const hasJapaneseScript = /[\u3040-\u30ff\u3400-\u9fff]/.test(titleBlob);
    const isAnimated = genreNames.includes("animation");
    const isJapaneseOrigin = originalLanguage === "ja" || originCountries.includes("JP");

    return {
      isAnime: Boolean(isAnimated && (isJapaneseOrigin || hasJapaneseScript)),
      isAnimated,
      isJapaneseOrigin,
      hasJapaneseScript
    };
  }

  extractVideosScript(html) {
    return String(html || "").match(/<script[^>]*>[\s\S]*?var\s+videos\s*=\s*\{[\s\S]*?<\/script>/i)?.[0] || "";
  }

  extractAnimeInfoScript(html) {
    return String(html || "").match(/<script[^>]*>[\s\S]*?var\s+anime_info\s*=\s*\[[\s\S]*?var\s+episodes\s*=\s*\[[\s\S]*?<\/script>/i)?.[0] || "";
  }

  extractYear(html) {
    const script = this.extractAnimeInfoScript(html);
    const rawAnimeInfo = script.match(/var\s+anime_info\s*=\s*\[([^\]]+)\]/i)?.[1] || "";
    const values = rawAnimeInfo
      .split(",")
      .map((part) => String(part || "").trim().replace(/^"|"$/g, ""));

    for (const value of values) {
      const year = extractYear(value);
      if (year) {
        return year;
      }
    }

    return extractYear(html);
  }

  extractAnimeInfoData(pageUrl, html) {
    const $ = cheerio.load(String(html || ""));
    const script = this.extractAnimeInfoScript(html);
    const rawAnimeInfo = script.match(/var\s+anime_info\s*=\s*(\[[\s\S]*?\])/i)?.[1] || "";
    const rawEpisodes = script.match(/var\s+episodes\s*=\s*(\[[\s\S]*?\]);/i)?.[1] || "";
    const pathname = new URL(pageUrl).pathname;
    const slug = pathname.split("/").filter(Boolean).pop() || "";
    const animeInfo = Array.isArray(safeJsonParse(rawAnimeInfo, null)) ? safeJsonParse(rawAnimeInfo, []) : [];
    const episodesSource = Array.isArray(safeJsonParse(rawEpisodes, null)) ? safeJsonParse(rawEpisodes, []) : [];
    const episodes = episodesSource.map((entry) => ({
      number: entry?.[0],
      path: `/ver/${slug}-${entry?.[0]}`
    })).filter((entry) => entry.number);

    const related = [];
    $("ul.ListAnmRel > li").each((_, element) => {
      const anchor = $(element).find("a").first();
      const href = anchor.attr("href") || "";
      const relatedSlug = href.match(/\/anime\/([^/]+)/)?.[1];
      const title = cleanText(anchor.text());
      const relation = cleanText($(element).text().match(/\(([^)]+)\)\s*$/)?.[1] || "");
      if (!relatedSlug || !title) {
        return;
      }

      related.push({
        title,
        relation,
        slug: relatedSlug
      });
    });

    const thumbnailBase = this.extractEpisodeThumbnailBase(html);
    const releaseInfo = animeInfo[3]
      ? extractYear(String(animeInfo[3]))
      : this.extractYear(html);

    return {
      title: cleanText($("h1.Title").first().text()),
      cover: absoluteUrl(
        $("div.AnimeCover div.Image figure img").attr("src")
          || $("div.AnimeCover div.Image figure img").attr("data-cfsrc")
          || "",
        this.baseUrl
      ),
      synopsis: cleanText($("div.Description > p").first().text() || $("div.Description").first().text()),
      genres: $("nav.Nvgnrs a").map((_, element) => cleanText($(element).text())).get().filter(Boolean),
      episodes: episodes.reverse(),
      related,
      releaseInfo,
      thumbnailBase
    };
  }

  extractEpisodeThumbnailBase(html) {
    const posterUrl = this.extractPoster(html);
    const posterId = String(posterUrl).match(/\/(\d+)\.(?:jpg|jpeg|png|webp)(?:\?|$)/i)?.[1];
    if (!posterId) {
      return "";
    }

    return `https://cdn.animeflv.net/screenshots/${posterId}/{episode}/th_3.jpg`;
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
