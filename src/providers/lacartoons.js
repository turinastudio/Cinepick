import cheerio from "cheerio-without-node-native";
import { buildStream, resolveExtractorStream } from "../lib/extractors.js";
import { buildStremioId } from "../lib/ids.js";
import { absoluteUrl, mapSearchItem, stripTags } from "../lib/webstreamer/common.js";
import { fetchJson } from "../lib/webstreamer/http.js";
import { fetchText } from "../lib/webstreamer/http.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

function cleanText(value) {
  return stripTags(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeServerName(value) {
  const lower = cleanText(value).toLowerCase();
  if (!lower) return "Server";
  if (lower.includes("streamwish")) return "StreamWish";
  if (lower.includes("filelions") || lower.includes("lion")) return "FileLions";
  if (lower.includes("yourupload") || lower.includes("upload")) return "YourUpload";
  if (lower.includes("streamhide") || lower.includes("vidhide")) return "StreamHideVid";
  if (lower.includes("sendvid")) return "Sendvid";
  if (lower.includes("okru") || lower.includes("ok.ru")) return "Okru";
  if (lower.includes("voe")) return "Voe";
  return cleanText(value);
}

function buildEpisodeLabel(season, episode, title) {
  const bits = [`T${season}`, `E${episode}`];
  const cleanTitle = cleanText(title);
  if (cleanTitle) {
    bits.push(cleanTitle);
  }
  return bits.join(" - ");
}

function buildLanguageTag() {
  return "LAT";
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export class LaCartoonsProvider extends WebstreamBaseProvider {
  constructor() {
    super({
      id: "lacartoons",
      name: "LACartoons",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.LACARTOONS_BASE_URL || "https://www.lacartoons.com";
  }

  buildSearchQueries(externalMeta, extraTitles = []) {
    const baseQueries = super.buildSearchQueries(externalMeta, extraTitles);
    const expanded = new Set(baseQueries);

    for (const value of baseQueries) {
      const cleaned = cleanText(value)
        .replace(/[,:;!?.]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned) {
        expanded.add(cleaned);
      }
    }

    return [...expanded].slice(0, 6);
  }

  async search({ type, query }) {
    if (!query?.trim()) {
      return [];
    }

    const html = await fetchText(`${this.baseUrl}/?utf8=%E2%9C%93&Titulo=${encodeURIComponent(query.trim())}`).catch(() => "");
    const directResults = this.extractSearchItems(html, type);
    if (directResults.length > 0) {
      return directResults;
    }

    const homeHtml = await fetchText(`${this.baseUrl}/`).catch(() => "");
    return this.extractSearchItems(homeHtml, type, query);
  }

  async getMeta({ type, slug }) {
    const path = this.decodePathToken(slug);
    const pageUrl = absoluteUrl(path, this.baseUrl);
    const html = await fetchText(pageUrl).catch(() => "");
    const videos = type === "series"
      ? this.extractEpisodeEntries(html).map((item) => ({
          id: buildStremioId(this.id, "series", this.encodePathToken(item.path)),
          title: buildEpisodeLabel(item.season, item.episode, item.title),
          season: item.season,
          episode: item.episode
        }))
      : [];

    return {
      id: buildStremioId(this.id, type, slug),
      type,
      name: this.extractTitle(html) || this.unslugify(path),
      poster: this.extractPoster(html),
      background: this.extractPoster(html),
      description: this.extractDescription(html),
      genres: this.extractGenres(html),
      cast: [],
      videos
    };
  }

  async getStreams({ type, slug }) {
    const path = this.decodePathToken(slug);
    let pageUrl = absoluteUrl(path, this.baseUrl);
    let html = await fetchText(pageUrl).catch(() => "");

    if (!html) {
      return [];
    }

    if (type === "movie") {
      const playback = await this.resolvePlaybackPage(type, pageUrl, html);
      pageUrl = playback.pageUrl;
      html = playback.html;
    }

    const streams = await this.extractStreamsFromPage(pageUrl, html);
    return this.sortStreams(this.attachDisplayTitle(streams, this.extractTitle(html) || this.unslugify(path)));
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

    const candidates = await this.searchWithFallbackQueries({ type, externalMeta });
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
      const episodeUrl = this.resolveEpisodeUrl(html, parsedExternal.season, parsedExternal.episode);
      debug.episodeTargetUrl = episodeUrl || null;

      if (!episodeUrl) {
        debug.status = "no_matching_episode";
        return debug;
      }

      pageUrl = absoluteUrl(episodeUrl, this.baseUrl);
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
      server: player.server,
      pageUrl: player.url
    }));

    const tmdbId = await this.findTmdbIdFromImdb(type, parsedExternal.baseId);

    this._currentExternalContext = {
      type,
      imdbId: parsedExternal.baseId,
      tmdbId,
      season: parsedExternal.season,
      episode: parsedExternal.episode
    };
    const streams = await this.extractStreamsFromPage(pageUrl, html);
    this._currentExternalContext = null;
    debug.streamCount = streams.length;
    debug.streams = includeStreams ? streams : [];
    debug.status = streams.length > 0 ? "ok" : "no_streams";

    return debug;
  }

  async resolvePlaybackPage(type, pageUrl, html) {
    if (this.extractRawPlayers(html, pageUrl).length > 0) {
      return { pageUrl, html };
    }

    if (type !== "movie") {
      return { pageUrl, html };
    }

    const entries = this.extractEpisodeEntries(html);
    const fallbackEntry = entries[0] || null;
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

  resolveEpisodeUrl(html, seasonNumber, episodeNumber) {
    const entries = this.extractEpisodeEntries(html);
    const exact = entries.find((entry) =>
      Number(entry.season) === Number(seasonNumber) &&
      Number(entry.episode) === Number(episodeNumber)
    );

    if (exact) {
      return exact.path;
    }

    const singleSeason = new Set(entries.map((entry) => Number(entry.season))).size <= 1;
    if (singleSeason || Number(seasonNumber) === 1) {
      const episodeOnly = entries.find((entry) => Number(entry.episode) === Number(episodeNumber));
      if (episodeOnly) {
        return episodeOnly.path;
      }
    }

    return null;
  }

  extractEpisodeEntries(html) {
    const $ = cheerio.load(String(html || ""));
    const entries = [];

    $(".estilo-temporada").each((seasonIndex, seasonElement) => {
      const seasonText = cleanText($(seasonElement).text() || $(seasonElement).contents().first().text() || "");
      const seasonNumber = Number.parseInt(seasonText.replace(/\D+/g, ""), 10) || seasonIndex + 1;
      const panel = $(".episodio-panel").eq(seasonIndex);

      panel.find("ul > li > a").each((_, linkElement) => {
        const link = $(linkElement);
        const href = absoluteUrl(link.attr("href") || "", this.baseUrl);
        const episodeSpan = cleanText(link.find("span").text());
        const episodeNumber = Number.parseInt(episodeSpan.replace(/\D+/g, ""), 10);
        const title = cleanText(link.clone().find("span").remove().end().text());

        if (!href || !Number.isFinite(episodeNumber)) {
          return;
        }

        entries.push({
          season: seasonNumber,
          episode: episodeNumber,
          title,
          path: new URL(href).pathname
        });
      });
    });

    return entries;
  }

  extractRawPlayers(html, referer) {
    const $ = cheerio.load(String(html || ""));
    const players = [];

    $("iframe").each((_, element) => {
      const src = $(element).attr("src") || "";
      const normalized = this.normalizePlayerUrl(src);
      if (!normalized) {
        return;
      }

      players.push({
        server: normalizeServerName(new URL(normalized).hostname),
        url: normalized,
        referer
      });
    });

    return Array.from(new Map(players.map((item) => [item.url, item])).values());
  }

  async extractStreamsFromPage(pageUrl, html) {
    const players = this.extractRawPlayers(html, pageUrl);
    const groups = await Promise.all(players.map((player) => this.resolvePlayer(player)));
    return groups.flat().filter(Boolean);
  }

  async resolvePlayer(player) {
    const label = `[${buildLanguageTag()}] ${player.server}`.trim();
    const normalizedUrl = this.normalizePlayerUrl(player.url);
    if (!normalizedUrl) {
      return [];
    }

    if (/\.m3u8(\?|$)/i.test(normalizedUrl)) {
      return [
        buildStream(
          "LACartoons",
          `${label} HLS`.trim(),
          normalizedUrl,
          { Referer: player.referer || `${this.baseUrl}/` },
          true
        )
      ];
    }

    let streams = await resolveExtractorStream(normalizedUrl, label, true).catch(() => []);

    if ((!streams || streams.length === 0) && /rpmvid|cubeembed/i.test(normalizedUrl)) {
      for (const rpmvidUrl of this.buildRpmVidFallbackUrls()) {
        streams = await resolveExtractorStream(rpmvidUrl, label, true).catch(() => []);
        if (streams.length > 0) {
          break;
        }
      }
    }

    return streams.map((stream) => ({
      ...stream,
      name: "LACartoons",
      subtitles: stream.subtitles || []
    }));
  }

  buildRpmVidFallbackUrls() {
    const ctx = this._currentExternalContext || null;
    if (!ctx) {
      return [];
    }

    const ids = [ctx.imdbId, ctx.tmdbId].map((value) => String(value || "").trim()).filter(Boolean);
    const urls = [];

    if (ctx.type === "series" && ctx.season && ctx.episode) {
      for (const id of ids) {
        urls.push(`https://rpmvid.win/embed/tv/${id}/${ctx.season}/${ctx.episode}`);
      }
      return urls;
    }

    if (ctx.type === "movie") {
      for (const id of ids) {
        urls.push(`https://rpmvid.win/embed/movie/${id}`);
      }
      return urls;
    }

    return [];
  }

  async findTmdbIdFromImdb(type, imdbId) {
    const mediaType = type === "series" ? "tv" : "movie";
    const payload = await fetchJson(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=${this.tmdbApiKey}&external_source=imdb_id`
    ).catch(() => null);

    const list = mediaType === "tv" ? payload?.tv_results : payload?.movie_results;
    const item = Array.isArray(list) ? list[0] : null;
    return item?.id ? String(item.id) : "";
  }

  extractSearchItems(html, type, query = "") {
    const $ = cheerio.load(String(html || ""));
    const items = [];
    const queryTokens = tokenize(query);

    $(".conjuntos-series a").each((_, element) => {
      const entry = $(element);
      const href = absoluteUrl(entry.attr("href") || "", this.baseUrl);
      const title = cleanText(entry.find(".serie .informacion-serie .nombre-serie").text());
      if (!href || !title) {
        return;
      }

       if (queryTokens.length > 0) {
        const titleTokens = tokenize(title);
        const overlap = queryTokens.filter((token) => titleTokens.includes(token)).length;
        const ratio = overlap / queryTokens.length;
        if (overlap === 0 || ratio < 0.45) {
          return;
        }
      }

      items.push(mapSearchItem(this.id, type, this.encodePathToken(new URL(href).pathname), title, ""));
    });

    return this.dedupeById(items);
  }

  extractTitle(html) {
    const $ = cheerio.load(String(html || ""));
    return cleanText($(".subtitulo-serie-seccion").first().text());
  }

  extractPoster(html) {
    const $ = cheerio.load(String(html || ""));
    return absoluteUrl(
      $("div.h-thumb figure img").attr("src") ||
      $('meta[property="og:image"]').attr("content") ||
      "",
      this.baseUrl
    );
  }

  extractDescription(html) {
    const $ = cheerio.load(String(html || ""));
    return cleanText($(".informacion-serie-seccion p").text());
  }

  extractGenres(html) {
    const $ = cheerio.load(String(html || ""));
    return Array.from(new Set($(".marcador-cartoon").map((_, element) => cleanText($(element).text())).get().filter(Boolean)));
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

  normalizePlayerUrl(url) {
    const value = String(url || "").trim();
    if (!value) {
      return "";
    }

    if (value.startsWith("//")) {
      return `https:${value}`;
    }

    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    return absoluteUrl(value, this.baseUrl);
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
