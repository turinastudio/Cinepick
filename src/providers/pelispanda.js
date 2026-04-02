import crypto from "node:crypto";
import { buildStremioId } from "../lib/ids.js";
import { buildTorrentTitle } from "../lib/torrent-format.js";
import { Provider } from "./base.js";

const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.cyberia.is:6969/announce",
  "udp://exodus.desync.com:6969/announce"
];

export class PelispandaProvider extends Provider {
  constructor() {
    super({
      id: "pelispanda",
      name: "PelisPanda",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.PELISPANDA_BASE_URL || "https://pelispanda.org";
  }

  async search({ type, query }) {
    const trimmedQuery = String(query || "").trim();
    if (!trimmedQuery) {
      return [];
    }

    const apiResults = await this.searchApi(type, trimmedQuery);
    if (apiResults.length > 0) {
      return apiResults;
    }

    const searchUrls = this.buildSearchUrls(trimmedQuery);
    const items = new Map();

    for (const url of searchUrls) {
      const html = await this.fetchTextMaybe(url);
      if (!html) {
        continue;
      }

      for (const item of this.extractCards(html, type)) {
        items.set(item.id, item);
      }
    }

    return Array.from(items.values());
  }

  async getMeta({ type, slug }) {
    const target = this.parseSlug(slug);
    const apiMeta = await this.fetchDetailApi(type, target.path);
    if (apiMeta) {
      return this.buildMetaFromApi(type, slug, apiMeta);
    }

    const html = await this.fetchText(target.url);
    const title = this.extractTitle(html) || this.unslugify(target.path);
    const poster = this.extractPoster(html);
    const description = this.extractDescription(html);
    const genres = this.extractGenres(html);
    const releaseInfo = this.extractYear(html);

    return {
      id: buildStremioId(this.id, type, slug),
      type,
      name: title,
      poster,
      background: poster,
      description,
      genres,
      cast: [],
      releaseInfo,
      videos: []
    };
  }

  async getStreams({ type, slug }) {
    const target = this.parseSlug(slug);
    const apiMeta = await this.fetchDetailApi(type, target.path);
    if (apiMeta) {
      return this.extractTorrentStreamsFromApi(apiMeta, {
        type,
        name: apiMeta.title || this.unslugify(target.path),
        languageTag: "[LAT]"
      });
    }

    const html = await this.fetchText(target.url);
    return this.extractTorrentStreams(html, {
      type,
      name: this.extractTitle(html) || this.unslugify(target.path),
      languageTag: "[LAT]"
    });
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
    const bestMatch = this.pickBestCandidate(typeCandidates.length > 0 ? typeCandidates : candidates, externalMeta);
    if (!bestMatch) {
      return [];
    }

    const slug = bestMatch.id.split(":").slice(2).join(":");
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

    debug.queries = this.buildSearchQueries(externalMeta);
    const candidates = await this.searchWithFallbackQueries({ type, externalMeta });
    debug.candidates = candidates.map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      name: candidate.name,
      releaseInfo: candidate.releaseInfo || ""
    }));

    if (!candidates.length) {
      debug.searchDebug = await this.debugSearchQueries(type, debug.queries);
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

    const slug = bestMatch.id.split(":").slice(2).join(":");
    const target = this.parseSlug(slug);
    const apiMeta = await this.fetchDetailApi(bestMatch.type, target.path);
    if (apiMeta) {
      const streams = this.extractTorrentStreamsFromApi(apiMeta, {
        type: bestMatch.type,
        name: apiMeta.title || bestMatch.name,
        languageTag: "[LAT]"
      });

      debug.targetUrl = target.url;
      debug.apiDebug = {
        slug: apiMeta.slug || "",
        title: apiMeta.title || "",
        type: apiMeta.type || "",
        downloadCount: Array.isArray(apiMeta.downloads) ? apiMeta.downloads.length : 0
      };
      debug.torrentCount = streams.length;
      debug.torrents = streams.map((stream) => ({
        title: stream.title,
        infoHash: stream.infoHash,
        fileIdx: stream.fileIdx ?? null,
        seeders: stream.seeders ?? null,
        sources: stream.sources || []
      }));
      debug.streams = streams;
      debug.status = streams.length > 0 ? "ok" : "no_streams";
      return debug;
    }

    const html = await this.fetchText(target.url);
    const streams = await this.extractTorrentStreams(html, {
      type: bestMatch.type,
      name: this.extractTitle(html) || bestMatch.name,
      languageTag: "[LAT]"
    });

    debug.targetUrl = target.url;
    debug.htmlDebug = this.buildHtmlDebug(html);
    debug.torrentCount = streams.length;
    debug.torrents = streams.map((stream) => ({
      title: stream.title,
      infoHash: stream.infoHash,
      fileIdx: stream.fileIdx ?? null,
      seeders: stream.seeders ?? null,
      sources: stream.sources || []
    }));
    debug.streams = streams;
    debug.status = streams.length > 0 ? "ok" : "no_streams";

    return debug;
  }

  async debugInternalStreams({ type, slug }) {
    const target = this.parseSlug(slug);
    const apiMeta = await this.fetchDetailApi(type, target.path);
    if (apiMeta) {
      const streams = this.extractTorrentStreamsFromApi(apiMeta, {
        type,
        name: apiMeta.title || this.unslugify(target.path),
        languageTag: "[LAT]"
      });

      return {
        targetUrl: target.url,
        resolvedType: type,
        title: apiMeta.title || this.unslugify(target.path),
        apiDebug: {
          slug: apiMeta.slug || "",
          title: apiMeta.title || "",
          type: apiMeta.type || "",
          downloadCount: Array.isArray(apiMeta.downloads) ? apiMeta.downloads.length : 0
        },
        torrentCount: streams.length,
        torrents: streams.map((stream) => ({
          title: stream.title,
          infoHash: stream.infoHash,
          fileIdx: stream.fileIdx ?? null,
          seeders: stream.seeders ?? null,
          size: stream.size ?? null,
          sources: stream.sources || []
        })),
        status: streams.length > 0 ? "ok" : "no_torrents"
      };
    }

    const html = await this.fetchText(target.url);
    const title = this.extractTitle(html) || this.unslugify(target.path);
    const streams = await this.extractTorrentStreams(html, {
      type,
      name: title,
      languageTag: "[LAT]"
    });

    return {
      targetUrl: target.url,
      resolvedType: type,
      title,
      htmlDebug: this.buildHtmlDebug(html),
      torrentCount: streams.length,
      torrents: streams.map((stream) => ({
        title: stream.title,
        infoHash: stream.infoHash,
        fileIdx: stream.fileIdx ?? null,
        seeders: stream.seeders ?? null,
        size: stream.size ?? null,
        sources: stream.sources || []
      })),
      status: streams.length > 0 ? "ok" : "no_torrents"
    };
  }

  extractCards(html, requestedType) {
    const items = [];

    for (const match of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = this.normalizePath(match[1]);
      const block = match[2] || "";
      const type = this.resolveTypeFromPath(href);
      if (!href || !type || type !== requestedType) {
        continue;
      }

      const title = this.cleanText(
        this.extractFirstMatch(block, /<h3[^>]*>([\s\S]*?)<\/h3>/i) ||
        this.extractFirstMatch(block, /<h2[^>]*>([\s\S]*?)<\/h2>/i) ||
        this.extractFirstMatch(block, /title=["']([^"']+)["']/i) ||
        block
      );
      const releaseInfo = this.extractYearValue(block);
      const poster = this.toAbsoluteUrl(
        this.extractFirstMatch(block, /<img[^>]+(?:data-src|src)=["']([^"']+)["']/i)
      );

      if (!title || title.length < 2) {
        continue;
      }

      items.push({
        id: buildStremioId(this.id, type, this.encodePathToken(href)),
        type,
        name: title,
        poster,
        posterShape: "poster",
        description: "",
        genres: [],
        releaseInfo
      });
    }

    return this.dedupeById(items);
  }

  async extractTorrentStreams(html, context) {
    const title = String(context?.name || "PelisPanda").trim();
    const languageTag = context?.languageTag || "[LAT]";
    const torrents = [];

    for (const rawUrl of this.extractTorrentUrls(html)) {
      const torrent = this.buildTorrentStream(rawUrl, title, languageTag);
      if (torrent) {
        torrents.push(torrent);
      }
    }

    return this.dedupeTorrentStreams(torrents);
  }

  extractTorrentStreamsFromApi(payload, context) {
    const downloads = Array.isArray(payload?.downloads) ? payload.downloads : [];
    const torrents = [];

    for (const download of downloads) {
      const url = String(download?.download_link || download?.url || "").trim();
      const quality = String(download?.quality || "").trim();
      const language = String(download?.language || "").trim();
      const size = String(download?.size || "").trim();
      const torrent = this.buildTorrentStream(url, [context?.name, quality, language, size].filter(Boolean).join(" "), context?.languageTag || "[LAT]");
      if (torrent) {
        torrents.push(torrent);
      }
    }

    return this.dedupeTorrentStreams(torrents);
  }

  extractTorrentUrls(html) {
    const urls = new Set();

    for (const match of html.matchAll(/(?:href|data-href|data-url|data-download|action)=["']([^"']+)["']/gi)) {
      const url = this.decodeHtmlEntities(match[1] || "").trim();
      if (this.isInterestingDownloadUrl(url)) {
        urls.add(url);
      }
    }

    for (const match of html.matchAll(/(magnet:\?xt=urn:btih:[^"'\\<\s]+)/gi)) {
      urls.add(this.decodeHtmlEntities(match[1]));
    }

    return Array.from(urls);
  }

  buildHtmlDebug(html) {
    const links = Array.from(
      new Set(
        Array.from(
          html.matchAll(/(?:href|data-href|data-url|data-download|action)=["']([^"']+)["']/gi),
          (match) => this.decodeHtmlEntities(match[1] || "").trim()
        ).filter(Boolean)
      )
    );
    const interestingLinks = links.filter((link) => this.isInterestingDownloadUrl(link));

    return {
      title: this.extractTitle(html),
      totalLinkCount: links.length,
      interestingLinkCount: interestingLinks.length,
      interestingLinkSample: interestingLinks.slice(0, 20),
      magnetCount: (html.match(/magnet:\?xt=urn:btih:/gi) || []).length,
      torrentHrefCount: (html.match(/\.torrent(\?|["'])/gi) || []).length,
      downloadWordCount: (html.match(/download|descargar|torrent/gi) || []).length
    };
  }

  buildMetaFromApi(type, slug, payload) {
    return {
      id: buildStremioId(this.id, type, slug),
      type,
      name: payload?.title || this.unslugify(slug),
      poster: payload?.featured || "",
      background: payload?.background_image || payload?.featured || "",
      description: payload?.overview || "",
      genres: Array.isArray(payload?.genres) ? payload.genres : [],
      cast: [],
      releaseInfo: String(payload?.year || "").trim(),
      videos: []
    };
  }

  buildTorrentStream(rawUrl, baseTitle, languageTag) {
    const decodedUrl = this.decodeHtmlEntities(String(rawUrl || "").trim());
    const infoHash = this.extractInfoHash(decodedUrl);

    if (!infoHash) {
      return null;
    }

    const parsedMagnet = /^magnet:/i.test(decodedUrl) ? this.parseMagnet(decodedUrl) : null;
    const displayName = this.cleanText(parsedMagnet?.dn || this.filenameFromUrl(decodedUrl) || baseTitle);
    const trackers = this.normalizeTrackers(parsedMagnet?.tr?.length ? parsedMagnet.tr : DEFAULT_TRACKERS);
    const infoText = `${displayName} ${baseTitle}`.toLowerCase();
    const size = this.extractSizeLabel(infoText);
    const fullTitle = buildTorrentTitle({
      languageTag,
      baseTitle,
      rawName: displayName,
      size
    });

    return {
      name: "PelisPanda",
      title: fullTitle,
      infoHash,
      fileIdx: 0,
      sources: trackers.map((tracker) => `tracker:${tracker}`),
      seeders: this.extractFirstNumber(infoText, /\b(\d+)\s*(?:seed|seeder|semillas)\b/i),
      peers: this.extractFirstNumber(infoText, /\b(\d+)\s*(?:peer|leech|leecher)\b/i),
      size,
      behaviorHints: {
        bingeGroup: "torrent"
      }
    };
  }

  parseMagnet(url) {
    const query = url.split("?")[1] || "";
    const params = new URLSearchParams(query);
    return {
      dn: params.get("dn") || "",
      tr: params.getAll("tr")
    };
  }

  normalizeTrackers(trackers) {
    const values = Array.isArray(trackers) ? trackers : [];
    const normalized = new Set();

    for (const tracker of values) {
      const value = decodeURIComponent(String(tracker || "").trim());
      if (!value) {
        continue;
      }

      if (!/^(?:udp|https?):\/\/.+\/announce$/i.test(value)) {
        continue;
      }

      normalized.add(value);
    }

    if (normalized.size === 0) {
      for (const tracker of DEFAULT_TRACKERS) {
        normalized.add(tracker);
      }
    }

    return Array.from(normalized);
  }

  extractInfoHash(url) {
    const magnetMatch = String(url || "").match(/xt=urn:btih:([a-f0-9]{40}|[a-z2-7]{32})/i);
    if (magnetMatch) {
      return magnetMatch[1].toUpperCase();
    }

    if (/\.torrent(\?|$)/i.test(String(url || ""))) {
      return crypto.createHash("sha1").update(String(url)).digest("hex").toUpperCase();
    }

    return "";
  }

  extractTitle(html) {
    return this.cleanText(
      this.extractFirstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      this.extractFirstMatch(html, /<title>([^<]+)<\/title>/i)
    )
      .replace(/\s*[-|]\s*PelisPanda.*$/i, "")
      .trim();
  }

  extractPoster(html) {
    return this.toAbsoluteUrl(
      this.extractFirstMatch(html, /<img[^>]+(?:data-src|src)=["']([^"']+)["']/i)
    );
  }

  extractDescription(html) {
    return this.cleanText(
      this.extractFirstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      this.extractFirstMatch(html, /<div[^>]+class=["'][^"']*\b(?:overview|description|sinopsis|summary)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
    );
  }

  extractGenres(html) {
    return Array.from(
      html.matchAll(/<a[^>]+href=["'][^"']*(?:genero|genre|categoria)[^"']*["'][^>]*>([^<]+)<\/a>/gi),
      (match) => this.cleanText(match[1])
    ).filter(Boolean);
  }

  extractYear(html) {
    return this.extractYearValue(html);
  }

  searchWithFallbackQueries({ type, externalMeta }) {
    return this.runSearchQueries(type, this.buildSearchQueries(externalMeta));
  }

  async debugSearchQueries(type, queries) {
    const samples = [];

    for (const query of queries.slice(0, 4)) {
      for (const url of this.buildSearchUrls(query)) {
        const html = await this.fetchTextMaybe(url);
        if (!html) {
          samples.push({ query, url, status: "unavailable" });
          continue;
        }

        const cards = this.extractCards(html, type);
        samples.push({
          query,
          url,
          status: "ok",
          candidateCount: cards.length,
          hrefSample: this.extractSearchHrefSample(html)
        });
      }
    }

    return samples;
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

  buildSearchUrls(query) {
    const encoded = encodeURIComponent(String(query || "").trim());
    return [
      `${this.baseUrl}/search?query=${encoded}`,
      `${this.baseUrl}/?s=${encoded}`,
      `${this.baseUrl}/buscar?query=${encoded}`,
      `${this.baseUrl}/buscar/${encoded}`
    ];
  }

  async searchApi(type, query) {
    const encoded = encodeURIComponent(String(query || "").trim());
    const url = `${this.baseUrl}/wp-json/wpreact/v1/search?query=${encoded}&posts_per_page=100&page=1`;

    try {
      const payload = await this.fetchJson(url);
      const results = Array.isArray(payload?.results) ? payload.results : [];
      const wantedType = type === "movie" ? "pelicula" : "serie";

      return this.dedupeById(
        results
          .filter((item) => String(item?.type || "").toLowerCase() === wantedType)
          .map((item) => ({
            id: buildStremioId(this.id, type, this.encodePathToken(`/${wantedType}/${item.slug || ""}`)),
            type,
            name: String(item?.title || "").trim(),
            poster: String(item?.featured || "").trim(),
            posterShape: "poster",
            description: "",
            genres: [],
            releaseInfo: String(item?.year || "").trim()
          }))
          .filter((item) => item.name)
      );
    } catch {
      return [];
    }
  }

  async fetchDetailApi(type, path) {
    const slug = String(path || "").split("/").filter(Boolean).at(-1) || "";
    if (!slug) {
      return null;
    }

    const candidates = type === "movie"
      ? [`${this.baseUrl}/wp-json/wpreact/v1/movie/${encodeURIComponent(slug)}`]
      : [
          `${this.baseUrl}/wp-json/wpreact/v1/serie/${encodeURIComponent(slug)}`,
          `${this.baseUrl}/wp-json/wpreact/v1/series/${encodeURIComponent(slug)}`
        ];

    for (const url of candidates) {
      try {
        const payload = await this.fetchJson(url);
        if (payload && typeof payload === "object" && (payload.title || payload.slug || payload.downloads)) {
          return payload;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  pickBestCandidate(candidates, externalMeta) {
    const targetTitle = this.normalizeTitle(externalMeta.name);
    const targetYear = this.extractYear(externalMeta.releaseInfo || externalMeta.year || "");

    const scored = candidates.map((candidate) => {
      const candidateTitle = this.normalizeTitle(candidate.name);
      const candidateYear = this.extractYear(candidate.releaseInfo || "");
      const titleSimilarity = this.stringSimilarity(candidateTitle, targetTitle);

      let score = 0;
      if (candidateTitle === targetTitle) score += 100;
      if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) score += 35;
      if (titleSimilarity >= 0.92) score += 55;
      else if (titleSimilarity >= 0.84) score += 30;
      if (targetYear && candidateYear && targetYear === candidateYear) score += 20;

      return { candidate, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.score > 0 ? scored[0].candidate : candidates[0] || null;
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

  parseSlug(slug) {
    const path = this.decodePathToken(String(slug || ""));
    return {
      path,
      url: this.toAbsoluteUrl(path)
    };
  }

  resolveTypeFromPath(path) {
    const value = String(path || "").toLowerCase();
    if (value.includes("/pelicula/")) return "movie";
    if (value.includes("/serie/")) return "series";
    return "";
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
      return parsed.pathname;
    } catch {
      return "";
    }
  }

  toAbsoluteUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }

    try {
      return new URL(raw, this.baseUrl).toString();
    } catch {
      return "";
    }
  }

  filenameFromUrl(value) {
    const path = String(value || "").split("?")[0];
    return decodeURIComponent(path.split("/").pop() || "").replace(/\.torrent$/i, "");
  }

  extractSizeLabel(text) {
    const match = String(text || "").match(/(\d+(?:[.,]\d+)?)\s*(tb|gb|mb|kb)\b/i);
    return match ? `${match[1].replace(",", ".")} ${match[2].toUpperCase()}` : "";
  }

  extractFirstNumber(text, pattern) {
    const match = pattern.exec(String(text || ""));
    return match ? Number(match[1]) || 0 : 0;
  }

  isInterestingDownloadUrl(url) {
    const value = String(url || "");
    return /^(?:magnet:|https?:\/\/)/i.test(value) &&
      /(magnet:|\.torrent\b|torrent|download|descargar|btih)/i.test(value);
  }

  extractSearchHrefSample(html) {
    return Array.from(
      new Set(
        Array.from(
          html.matchAll(/href=["']([^"']+)["']/gi),
          (match) => this.decodeHtmlEntities(match[1] || "").trim()
        )
      )
    )
      .filter((href) => /\/(?:pelicula|serie)\//i.test(href))
      .slice(0, 12);
  }

  dedupeById(items) {
    return Array.from(new Map(items.map((item) => [item.id, item])).values());
  }

  dedupeTorrentStreams(streams) {
    return Array.from(new Map(streams.map((stream) => [`${stream.infoHash}:${stream.fileIdx ?? 0}`, stream])).values());
  }

  unslugify(value) {
    return String(value || "")
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "";
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

  extractYearValue(value) {
    return String(value || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
  }

  normalizeTitle(value) {
    return String(value || "")
      .normalize("NFD")
      .replaceAll(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, " ")
      .trim();
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

  async fetchText(url) {
    let response;

    try {
      response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "es-ES,es;q=0.9,en;q=0.8",
          referer: `${this.baseUrl}/`
        }
      });
    } catch (error) {
      const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new Error(`No se pudo conectar con PelisPanda en ${url}. ${details}`);
    }

    if (!response.ok) {
      throw new Error(`PelisPanda respondio ${response.status} para ${url}`);
    }

    return response.text();
  }

  async fetchTextMaybe(url) {
    try {
      return await this.fetchText(url);
    } catch {
      return "";
    }
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
