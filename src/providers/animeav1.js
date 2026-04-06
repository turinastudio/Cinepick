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

function decodeJsString(value) {
  return String(value || "")
    .replace(/\\"/g, "\"")
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\");
}

function normalizeServerName(value) {
  const text = cleanText(value);
  if (!text) return "";
  return text
    .replace(/\s+/g, " ")
    .trim();
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

function normalizeAnimeTitle(value) {
  return normalizeMediaTitle(String(value || ""))
    .replace(/\b(tv|anime|movie|pelicula|ova|special)\b/g, " ")
    .replace(/\bseason\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchAniListAliases(title, year) {
  const queryTitle = String(title || "").trim();
  if (!queryTitle) {
    return [];
  }

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
  if (!Array.isArray(media)) {
    return [];
  }

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
  if (!queryTitle) {
    return [];
  }

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

export class AnimeAv1Provider extends WebstreamBaseProvider {
  constructor() {
    super({
      id: "animeav1",
      name: "AnimeAV1",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.ANIMEAV1_BASE_URL || "https://animeav1.com";
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

    return this.dedupeById(items);
  }

  async search({ type, query }) {
    if (!query?.trim()) {
      return [];
    }

    const html = await fetchText(`${this.baseUrl}/catalogo?search=${encodeURIComponent(query.trim())}`).catch(() => "");
    return this.extractSearchItems(html, type);
  }

  async getMeta({ type, slug }) {
    const path = this.decodePathToken(slug);
    const pageUrl = absoluteUrl(path, this.baseUrl);
    const html = await fetchText(pageUrl).catch(() => "");
    const videos = type === "series" ? this.buildEpisodeVideos(pageUrl, html) : [];
    const title = this.extractTitle(html) || this.unslugify(path);
    const year = this.extractYear(html);
    const runtime = this.extractRuntime(html);
    const trailer = this.extractTrailer(html);
    const links = this.extractRelatedLinks(html);

    return {
      id: buildStremioId(this.id, type, slug),
      type,
      name: title,
      poster: this.extractPoster(html),
      background: this.extractPoster(html),
      description: this.extractDescription(html),
      genres: this.extractGenres(html),
      cast: [],
      videos,
      ...(year ? { releaseInfo: year } : {}),
      ...(runtime ? { runtime } : {}),
      ...(trailer ? { trailers: [{ source: trailer, type: "Trailer" }] } : {}),
      ...(links.length > 0 ? { links } : {}),
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
    return exact ? absoluteUrl(exact.path, this.baseUrl) : null;
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
    const script = this.extractNodeScript(html);
    const episodeListRegex = /episodes\s*:\s*\[([^\]]*)\]/i;
    const episodeRegex = /\{\s*id\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*number\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*\}/g;
    const listMatch = script.match(episodeListRegex);

    if (!listMatch) {
      return [];
    }

    const pagePath = new URL(pageUrl).pathname.replace(/\/+$/, "");
    const episodes = [];
    let match;
    while ((match = episodeRegex.exec(listMatch[1]))) {
      const number = match[2];
      episodes.push({
        number,
        path: `${pagePath}/${number}`
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
    const script = this.extractNodeScript(html);
    const players = [];
    const hasKnownDub = hasOtakuDub(this._currentOtakuMapping);

    for (const language of ["SUB", "DUB"]) {
      for (const sectionType of ["embeds", "downloads"]) {
        const sectionRegex = new RegExp(`${sectionType}\\s*:\\s*\\{[\\s\\S]*?${language}\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i");
        const sectionMatch = script.match(sectionRegex);
        if (!sectionMatch) {
          continue;
        }

        const itemRegex = /\{\s*server\s*:\s*"([^"]*)"\s*,\s*url\s*:\s*"([^"]*)"\s*\}/g;
        let itemMatch;
        while ((itemMatch = itemRegex.exec(sectionMatch[1]))) {
          const server = normalizeServerName(itemMatch[1]);
          const rawUrl = decodeJsString(itemMatch[2]).split("?embed")[0];
          if (!rawUrl) {
            continue;
          }

          players.push({
            language,
            server,
            url: rawUrl,
            referer,
            hasKnownDub
          });
        }
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
          "AnimeAV1",
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
      name: "AnimeAV1",
      subtitles: stream.subtitles || []
    }));
  }

  isDirectHls(player) {
    return /player\.zilla/i.test(player.url) || /\bHLS\b/i.test(player.server || "");
  }

  normalizePlayerUrl(url) {
    const value = String(url || "").trim();
    if (!value) {
      return "";
    }

    if (/player\.zilla/i.test(value)) {
      return value.replace("/play/", "/m3u8/");
    }

    return value;
  }

  extractSearchItems(html, type) {
    const $ = cheerio.load(String(html || ""));
    const items = [];
    $("article[class*='group/item']").each((_, element) => {
      const anchor = $(element).find("a[href]").first();
      const heading = $(element).find("header h3").first();
      const href = absoluteUrl(anchor.attr("href") || "", this.baseUrl);
      if (!href) {
        return;
      }

      const title = cleanText(heading.text());
      if (!title) {
        return;
      }

      const path = new URL(href).pathname;
      items.push(
        mapSearchItem(
          this.id,
          type,
          this.encodePathToken(path),
          title,
          ""
        )
      );
    });

    return this.dedupeById(items);
  }

  pickBestCandidate(candidates, externalMeta) {
    const searchTitles = this.buildSearchQueries(externalMeta, externalMeta?._searchTitles || []);
    const mapping = externalMeta?._animeMapping || null;
    const otakuMapping = externalMeta?._otakuMapping || null;
    const mappingTitles = getAnimeMappingTitles(mapping).map((value) => normalizeAnimeTitle(value));
    const otakuTitles = getOtakuMappingTitles(otakuMapping).map((value) => normalizeAnimeTitle(value));
    const expectedSlug = String(mapping?.slug || "").trim().toLowerCase();
    let best = null;

    for (const candidate of candidates) {
      const candidateTitle = normalizeAnimeTitle(candidate.name);
      const candidateSlug = this.extractCandidateSlug(candidate);
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
        if (!target || !candidateTitle) {
          continue;
        }

        let localScore = basicTitleSimilarity(candidateTitle, target);
        if (candidateTitle === target) {
          localScore = 1.2;
        } else if (candidateTitle.includes(target) || target.includes(candidateTitle)) {
          localScore = Math.max(localScore, 1);
        }

        score = Math.max(score, localScore);
      }

      for (const target of otakuTitles) {
        if (!target || !candidateTitle) {
          continue;
        }

        let localScore = basicTitleSimilarity(candidateTitle, target);
        if (candidateTitle === target) {
          localScore = 1.15;
        } else if (candidateTitle.includes(target) || target.includes(candidateTitle)) {
          localScore = Math.max(localScore, 0.98);
        }

        score = Math.max(score, localScore);
      }

      if (expectedSlug && candidateSlug) {
        if (candidateSlug === expectedSlug) {
          score = Math.max(score, 1.5);
        } else if (candidateSlug.includes(expectedSlug) || expectedSlug.includes(candidateSlug)) {
          score = Math.max(score, 1.15);
        }
      }

      if (!best || score > best.score) {
        best = { candidate, score };
      }
    }

    return best && best.score >= 0.6 ? best.candidate : null;
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

  extractCandidateSlug(candidate) {
    const encoded = String(candidate?.id || "").split(":").slice(2).join(":");
    const path = this.decodePathToken(encoded);
    return String(path.split("/").filter(Boolean).pop() || "").trim().toLowerCase();
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

    const enDetails = await fetchJson(
      `https://api.themoviedb.org/3/${externalMeta.type === "series" ? "tv" : "movie"}/${externalMeta.id.replace(/^tmdb:/, "")}?api_key=${this.tmdbApiKey}&language=en-US`
    ).catch(() => null);
    const jaDetails = await fetchJson(
      `https://api.themoviedb.org/3/${externalMeta.type === "series" ? "tv" : "movie"}/${externalMeta.id.replace(/^tmdb:/, "")}?api_key=${this.tmdbApiKey}&language=ja-JP`
    ).catch(() => null);

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

  extractNodeScript(html) {
    return String(html || "").match(/<script[^>]*>[\s\S]*?node_ids[\s\S]*?<\/script>/i)?.[0] || "";
  }

  extractYear(html) {
    return extractYear(
      html.match(/startDate:\s*"([^"]+)"/i)?.[1]
      || html.match(/endDate:\s*"([^"]+)"/i)?.[1]
      || html
    );
  }

  extractRuntime(html) {
    const runtime = html.match(/runtime:\s*([0-9]+)/i)?.[1];
    return runtime ? `${runtime}m` : "";
  }

  extractTrailer(html) {
    return cleanText(html.match(/trailer:\s*"([^"]+)"/i)?.[1] || "");
  }

  extractRelatedLinks(html) {
    const $ = cheerio.load(String(html || ""));
    const links = [];

    $("a[href*='/media/']").each((_, element) => {
      const href = $(element).attr("href") || "";
      const title = cleanText($(element).find("h3").first().text() || $(element).text());
      if (!href || !title) {
        return;
      }

      const relation = cleanText($(element).find("span").last().text());
      const slug = href.match(/\/media\/([^/]+)/)?.[1];
      if (!slug) {
        return;
      }

      links.push({
        name: title,
        category: relation || "Relacionado",
        url: `stremio:///detail/series/${buildStremioId(this.id, "series", this.encodePathToken(`/media/${slug}`))}`
      });
    });

    return Array.from(new Map(links.map((item) => [`${item.category}:${item.name}`, item])).values()).slice(0, 12);
  }

  extractEpisodeThumbnailBase(html) {
    const posterUrl = this.extractPoster(html);
    const posterId = String(posterUrl).match(/\/(\d+)\.(?:jpg|jpeg|png|webp)(?:\?|$)/i)?.[1];
    if (!posterId) {
      return "";
    }

    return `https://cdn.animeav1.com/screenshots/${posterId}/{episode}.jpg`;
  }

  extractTitle(html) {
    return cleanText(
      html.match(/<h1[^>]*line-clamp-2[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      || html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || ""
    );
  }

  extractPoster(html) {
    return absoluteUrl(
      html.match(/<img[^>]*object-cover[^>]*src="([^"]+)"/i)?.[1]
      || html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || "",
      this.baseUrl
    );
  }

  extractDescription(html) {
    return cleanText(html.match(/<div[^>]*class="[^"]*entry[^"]*"[^>]*>\s*<p>([\s\S]*?)<\/p>/i)?.[1] || "");
  }

  extractGenres(html) {
    return Array.from(
      new Set(
        Array.from(String(html || "").matchAll(/<header[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi), (match) => cleanText(match[1]))
          .filter(Boolean)
      )
    );
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
    return slugify(path)
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
}
