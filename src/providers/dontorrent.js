import crypto from "node:crypto";
import { buildStremioId } from "../lib/ids.js";
import { buildTorrentTitle } from "../lib/torrent-format.js";
import { scoreAndSelectTorrents } from "../lib/torrent-scoring.js";
import { Provider } from "./base.js";

const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.cyberia.is:6969/announce",
  "udp://exodus.desync.com:6969/announce"
];

export class DonTorrentProvider extends Provider {
  constructor() {
    super({
      id: "dontorrent",
      name: "DonTorrent",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.DONTORRENT_BASE_URL || "https://dontorrent.pink";
    this.lastSearchDebug = [];
  }

  async search({ type, query }) {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      this.lastSearchDebug = [];
      return [];
    }

    const items = new Map();
    const searchDebug = [];

    for (const request of this.buildSearchRequests(trimmed, type)) {
      const html = await this.fetchTextMaybe(request.url, request.init);
      const extractedItems = html ? this.extractSearchItems(html, type) : [];

      searchDebug.push({
        method: request.init?.method || "GET",
        url: request.url,
        status: html ? "ok" : "empty",
        candidateCount: extractedItems.length
      });

      if (!html) {
        continue;
      }

      for (const item of extractedItems) {
        items.set(item.id, item);
      }
    }

    this.lastSearchDebug = searchDebug;
    return Array.from(items.values());
  }

  async getMeta({ type, slug }) {
    const target = this.parseSlug(slug);
    const html = await this.fetchText(target.url);

    return {
      id: buildStremioId(this.id, type, slug),
      type,
      name: this.extractTitle(html) || this.unslugify(target.path),
      poster: this.extractPoster(html),
      background: this.extractPoster(html),
      description: this.extractDescription(html),
      genres: this.extractGenres(html),
      cast: [],
      releaseInfo: this.extractYearValue(html),
      videos: []
    };
  }

  async getStreams({ type, slug }) {
    const target = this.parseSlug(slug);
    const html = await this.fetchText(target.url);
    const torrents = await this.extractTorrentStreams(html, {
      baseTitle: this.extractTitle(html) || this.unslugify(target.path),
      detailUrl: target.url
    });

    return scoreAndSelectTorrents(this.id, torrents, { maxResults: 5 });
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

    const validCandidates = candidates.filter((candidate) => candidate.type === type);
    const bestMatch = this.pickBestCandidate(validCandidates.length > 0 ? validCandidates : candidates, externalMeta);
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
    debug.searchDebug = this.lastSearchDebug;
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

    const validCandidates = candidates.filter((candidate) => candidate.type === type);
    debug.validCandidates = (validCandidates.length > 0 ? validCandidates : candidates).map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      name: candidate.name,
      releaseInfo: candidate.releaseInfo || ""
    }));

    const bestMatch = this.pickBestCandidate(validCandidates.length > 0 ? validCandidates : candidates, externalMeta);
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
    const html = await this.fetchText(target.url);
    const torrents = await this.extractTorrentStreams(html, {
      baseTitle: this.extractTitle(html) || bestMatch.name,
      detailUrl: target.url
    });

    debug.targetUrl = target.url;
    debug.torrentDebug = this.buildTorrentDebug(html);
    debug.torrentCount = torrents.length;
    debug.torrents = torrents.map((stream) => ({
      title: stream.title,
      infoHash: stream.infoHash,
      fileIdx: stream.fileIdx ?? null,
      seeders: stream.seeders ?? null,
      peers: stream.peers ?? null,
      size: stream.size || "",
      sources: stream.sources || []
    }));
    debug.streams = torrents;
    debug.status = torrents.length > 0 ? "ok" : "no_streams";
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

  buildSearchRequests(query, type) {
    const value = String(query || "").trim();
    const encoded = encodeURIComponent(String(query || "").trim());
    const requests = [
      {
        url: `${this.baseUrl}/buscar`,
        init: {
          method: "POST",
          body: new URLSearchParams({ valor: value }).toString()
        }
      },
      {
        url: `${this.baseUrl}/peliculas/buscar`,
        init: {
          method: "POST",
          body: new URLSearchParams({ campo: "titulo", valor: value }).toString()
        }
      },
      {
        url: `${this.baseUrl}/buscar/${encoded}`,
        init: {}
      }
    ];

    if (type === "series") {
      requests.splice(2, 0, {
        url: `${this.baseUrl}/series/buscar`,
        init: {
          method: "POST",
          body: new URLSearchParams({ campo: "titulo", valor: value }).toString()
        }
      });
    }

    return requests;
  }

  extractSearchItems(html, requestedType) {
    const items = [];
    const seen = new Set();
    const matches = html.matchAll(/<a[^>]+href=["']([^"']*\/(?:pelicula|serie|documental)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);

    for (const match of matches) {
      const href = this.decodeHtmlEntities(match[1]);
      const block = match[0];
      const slug = this.extractSlugFromUrl(href);
      const imageSrc = this.extractFirstMatch(block, /<img[^>]+src=["']([^"']+)["']/i);
      const rawAttrTitle = this.decodeHtmlEntities(
        this.extractFirstMatch(block, /\btitle=["']([^"']+)["']/i)
          || this.extractFirstMatch(block, /\balt=["']([^"']+)["']/i)
      );
      const attrTitle = this.isGenericAnchorTitle(rawAttrTitle) ? "" : rawAttrTitle;
      const title = attrTitle
        || this.extractTitleFromImageUrl(imageSrc)
        || this.cleanText(match[2])
        || this.unslugify(slug);

      if (!href || !title) {
        continue;
      }

      const type = this.resolveTypeFromPath(href, requestedType);
      if (!slug || !type || this.isGenericSearchResult(slug, title)) {
        continue;
      }

      const item = {
        id: buildStremioId(this.id, type, slug),
        type,
        name: this.cleanTitle(title),
        poster: this.toAbsoluteUrl(this.extractFirstMatch(block, /<img[^>]+src=["']([^"']+)["']/i)) || null,
        posterShape: "poster",
        description: "",
        genres: [],
        releaseInfo: this.extractYearValue(block)
      };

      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }

    return items;
  }

  async extractTorrentStreams(html, context = {}) {
    const downloadData = this.extractProtectedDownloadData(html);
    if (!downloadData.contentId || !downloadData.tabla) {
      return [];
    }

    const torrentUrl = await this.resolveDownloadUrl(context.detailUrl || this.baseUrl, downloadData.contentId, downloadData.tabla);
    if (!torrentUrl) {
      return [];
    }

    const torrentResult = await this.torrentUrlToTorrentStream(torrentUrl, {
      baseTitle: context.baseTitle || "DonTorrent",
      quality: this.extractQuality(context.baseTitle || this.extractTitle(html) || ""),
      language: this.extractLanguage(context.baseTitle || this.extractTitle(html) || ""),
      size: this.extractFileSize(html),
      seeds: 0,
      peers: 0
    });

    return torrentResult ? [torrentResult] : [];
  }

  extractProtectedDownloadData(html) {
    const button = this.extractFirstMatch(html, /<[^>]*class=["'][^"']*\bprotected-download\b[^"']*["'][^>]*>/i);
    const source = button || html;
    return {
      contentId: Number(this.extractFirstMatch(source, /\bdata-content-id=["'](\d+)["']/i)) || 0,
      tabla: this.extractFirstMatch(source, /\bdata-tabla=["']([^"']+)["']/i).trim()
    };
  }

  async resolveDownloadUrl(detailUrl, contentId, tabla) {
    try {
      const baseOrigin = new URL(String(detailUrl || this.baseUrl), this.baseUrl).origin;
      const apiUrl = `${baseOrigin}/api_validate_pow.php`;
      const headers = {
        "content-type": "application/json",
        referer: baseOrigin,
        origin: baseOrigin,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "application/json,text/plain;q=0.9,*/*;q=0.8"
      };

      const generateResponse = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "generate", content_id: contentId, tabla })
      });
      if (!generateResponse.ok) {
        return "";
      }

      const generateData = await generateResponse.json();
      if (!generateData?.success || !generateData?.challenge) {
        return "";
      }

      const nonce = this.computePoW(String(generateData.challenge), 3);
      const validateResponse = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "validate", challenge: generateData.challenge, nonce })
      });
      if (!validateResponse.ok) {
        return "";
      }

      const validateData = await validateResponse.json();
      if (!validateData?.success || !validateData?.download_url) {
        return "";
      }

      const downloadUrl = String(validateData.download_url || "").trim();
      if (downloadUrl.startsWith("//")) {
        return `https:${downloadUrl}`;
      }

      return this.toAbsoluteUrl(downloadUrl);
    } catch {
      return "";
    }
  }

  computePoW(challenge, difficulty = 3) {
    const target = "0".repeat(difficulty);
    let nonce = 0;

    while (true) {
      const hash = crypto.createHash("sha256").update(String(challenge) + nonce).digest("hex");
      if (hash.startsWith(target)) {
        return nonce;
      }
      nonce += 1;
    }
  }

  async torrentUrlToTorrentStream(torrentUrl, context = {}) {
    try {
      const normalizedUrl = String(torrentUrl || "").startsWith("//") ? `https:${torrentUrl}` : String(torrentUrl || "");
      const response = await fetch(normalizedUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "*/*"
        }
      });

      if (!response.ok) {
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const infoHash = this.extractInfoHashFromTorrentBuffer(buffer);
      if (!infoHash) {
        return null;
      }

      const trackers = DEFAULT_TRACKERS;
      const title = buildTorrentTitle({
        languageTag: "[CAST]",
        baseTitle: context.baseTitle,
        rawName: `${context.baseTitle} ${context.quality || ""}`.trim(),
        size: context.size
      });
      return {
        name: "DonTorrent",
        title,
        infoHash: infoHash.toUpperCase(),
        fileIdx: 0,
        sources: trackers.map((tracker) => `tracker:${tracker}`),
        seeders: Number(context.seeds) || 0,
        peers: Number(context.peers) || 0,
        size: context.size || "",
        behaviorHints: {
          bingeGroup: "torrent"
        }
      };
    } catch {
      return null;
    }
  }

  extractInfoHashFromTorrentBuffer(buf) {
    try {
      const marker = Buffer.from("4:info");
      const index = buf.indexOf(marker);
      if (index === -1) {
        return "";
      }

      const infoStart = index + marker.length;
      const infoEnd = this.findBencodeEnd(buf, infoStart);
      if (infoEnd === -1) {
        return "";
      }

      const infoDict = buf.slice(infoStart, infoEnd);
      return crypto.createHash("sha1").update(infoDict).digest("hex");
    } catch {
      return "";
    }
  }

  findBencodeEnd(buf, offset) {
    if (offset >= buf.length) return -1;
    const char = String.fromCharCode(buf[offset]);

    if (char === "d") {
      let index = offset + 1;
      while (index < buf.length && String.fromCharCode(buf[index]) !== "e") {
        const keyEnd = this.findBencodeEnd(buf, index);
        if (keyEnd === -1) return -1;
        const valueEnd = this.findBencodeEnd(buf, keyEnd);
        if (valueEnd === -1) return -1;
        index = valueEnd;
      }
      return index + 1;
    }

    if (char === "l") {
      let index = offset + 1;
      while (index < buf.length && String.fromCharCode(buf[index]) !== "e") {
        const end = this.findBencodeEnd(buf, index);
        if (end === -1) return -1;
        index = end;
      }
      return index + 1;
    }

    if (char === "i") {
      const end = buf.indexOf(0x65, offset + 1);
      return end === -1 ? -1 : end + 1;
    }

    if (char >= "0" && char <= "9") {
      const colon = buf.indexOf(0x3a, offset);
      if (colon === -1) return -1;
      const length = parseInt(buf.slice(offset, colon).toString(), 10);
      return colon + 1 + length;
    }

    return -1;
  }

  buildTorrentDebug(html) {
    const downloadData = this.extractProtectedDownloadData(html);
    return {
      protectedDownloadFound: Boolean(downloadData.contentId && downloadData.tabla),
      contentId: downloadData.contentId || null,
      tabla: downloadData.tabla || "",
      quality: this.extractQuality(this.extractTitle(html) || ""),
      language: this.extractLanguage(this.extractTitle(html) || ""),
      size: this.extractFileSize(html)
    };
  }

  extractTitle(html) {
    return this.cleanText(
      this.extractFirstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      this.extractFirstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      this.extractFirstMatch(html, /<title>([^<]+)<\/title>/i)
    ).replace(/\s*[-|]\s*DonTorrent.*$/i, "").trim();
  }

  extractPoster(html) {
    return this.toAbsoluteUrl(
      this.extractFirstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      this.extractFirstMatch(html, /<img[^>]+src=["']([^"']+)["']/i)
    );
  }

  extractDescription(html) {
    return this.cleanText(
      this.extractFirstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      this.extractFirstMatch(html, /<div[^>]+class=["'][^"']*(?:sinopsis|description|summary)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
    );
  }

  extractGenres(html) {
    return Array.from(
      html.matchAll(/<a[^>]+href=["'][^"']*(?:genero|categoria)[^"']*["'][^>]*>([^<]+)<\/a>/gi),
      (match) => this.cleanText(match[1])
    ).filter(Boolean);
  }

  extractQuality(text) {
    const value = String(text || "");
    if (/\b(2160p|4k)\b/i.test(value)) return "2160p";
    if (/\b1080p\b/i.test(value)) return "1080p";
    if (/\b720p\b/i.test(value)) return "720p";
    if (/\b480p\b/i.test(value)) return "480p";
    if (/\b(sd|dvdrip)\b/i.test(value)) return "SD";
    return "";
  }

  extractLanguage(text) {
    const value = String(text || "");
    if (/\b(lat|latino)\b/i.test(value)) return "Latino";
    if (/\bdual\b/i.test(value)) return "Dual";
    if (/\bmulti|multiaudio\b/i.test(value)) return "Multiaudio";
    return "Castellano";
  }

  extractFileSize(html) {
    return this.extractSizeLabel(
      this.extractFirstMatch(this.cleanText(html), /Tama(?:ñ|Ã±)o:\s*([^\n]+)/i) ||
      this.cleanText(html)
    );
  }

  pickBestCandidate(candidates, externalMeta) {
    const targetTitle = this.normalizeTitle(externalMeta.name);
    const targetYear = this.extractYearValue(externalMeta.releaseInfo || externalMeta.year || "");

    const scored = candidates.map((candidate) => {
      const candidateTitle = this.normalizeTitle(candidate.name);
      const candidateYear = this.extractYearValue(candidate.releaseInfo || "");
      const similarity = this.stringSimilarity(candidateTitle, targetTitle);
      const overlap = this.countWordOverlap(candidateTitle, targetTitle);

      let score = 0;
      if (candidateTitle === targetTitle) score += 100;
      else if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) score += 35;
      if (similarity >= 0.92) score += 55;
      else if (similarity >= 0.84) score += 30;
      else if (similarity < 0.45) score -= 80;
      if (targetYear && candidateYear && targetYear === candidateYear) score += 20;
      if (overlap === 0) score -= 45;
      else score += Math.min(24, overlap * 8);
      if (this.isGenericSearchResult(candidate.id, candidate.name)) score -= 120;

      return { candidate, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.score >= 35 ? scored[0].candidate : null;
  }

  countWordOverlap(left, right) {
    const a = new Set(String(left || "").split(/\s+/).filter((word) => word.length >= 3));
    const b = new Set(String(right || "").split(/\s+/).filter((word) => word.length >= 3));
    let count = 0;
    for (const word of a) {
      if (b.has(word)) count += 1;
    }
    return count;
  }

  isGenericSearchResult(slug, title) {
    const slugValue = String(slug || "").toLowerCase();
    const titleValue = this.normalizeTitle(title);
    return !slugValue
      || slugValue === "/"
      || /^\/?(peliculas?|series?|documentales?)\/?$/i.test(slugValue)
      || /\b(?:peliculas? torrent|series torrent|descargar torrent)\b/i.test(titleValue);
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
    return {
      path: String(slug || ""),
      url: this.toAbsoluteUrl(String(slug || ""))
    };
  }

  resolveTypeFromPath(path, fallbackType) {
    const value = String(path || "").toLowerCase();
    if (value.includes("/serie/")) return "series";
    if (value.includes("/pelicula/") || value.includes("/documental/")) return fallbackType === "series" ? "series" : "movie";
    return fallbackType || "movie";
  }

  extractSlugFromUrl(url) {
    try {
      const parsed = new URL(url, this.baseUrl);
      return parsed.pathname;
    } catch {
      return "";
    }
  }

  toAbsoluteUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    try {
      return new URL(raw, this.baseUrl).toString();
    } catch {
      return "";
    }
  }

  extractSizeLabel(text) {
    const match = String(text || "").match(/(\d+(?:[.,]\d+)?)\s*(tb|gb|mb|kb)\b/i);
    return match ? `${match[1].replace(",", ".")} ${match[2].toUpperCase()}` : "";
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
    if (longer.length === 0) {
      return 1;
    }

    return (longer.length - this.levenshtein(longer, shorter)) / longer.length;
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

  extractTitleFromImageUrl(value) {
    const raw = this.decodeHtmlEntities(String(value || "").trim());
    if (!raw) {
      return "";
    }

    const source = raw.split("url=").at(-1) || raw;
    const filename = source.split("/").at(-1)?.replace(/\.(jpe?g|png|webp)$/i, "") || "";
    if (!filename) {
      return "";
    }

    return filename
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/-DonTorrent-.*/i, " ")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  isGenericAnchorTitle(value) {
    const normalized = this.normalizeTitle(value);
    return !normalized || normalized.includes("haz click para ver los detalles");
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

  cleanTitle(value) {
    return this.cleanText(String(value || "").replace(/\s*[-|]\s*DonTorrent.*$/i, "").replace(/^descargar\s+/i, ""));
  }

  extractFirstMatch(text, pattern) {
    return pattern.exec(String(text || ""))?.[1] || "";
  }

  async fetchText(url, init = {}) {
    let response;
    const method = String(init?.method || "GET").toUpperCase();
    const headers = {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...(method === "POST" ? {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        origin: new URL(url, this.baseUrl).origin,
        referer: this.baseUrl
      } : {}),
      ...(init?.headers || {})
    };

    try {
      response = await fetch(url, {
        ...init,
        headers
      });
    } catch (error) {
      const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new Error(`No se pudo conectar con DonTorrent en ${url}. ${details}`);
    }

    if (!response.ok) {
      throw new Error(`DonTorrent respondio ${response.status} para ${url}`);
    }

    return response.text();
  }

  async fetchTextMaybe(url, init = {}) {
    try {
      return await this.fetchText(url, init);
    } catch {
      return "";
    }
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
    } catch {
      return null;
    }

    if (!response.ok) {
      return null;
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
