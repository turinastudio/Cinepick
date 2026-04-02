import crypto from "node:crypto";
import { buildStremioId } from "../lib/ids.js";
import { scoreAndSelectTorrents } from "../lib/torrent-scoring.js";
import { Provider } from "./base.js";

const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.cyberia.is:6969/announce",
  "udp://exodus.desync.com:6969/announce"
];

export class EliteTorrentProvider extends Provider {
  constructor() {
    super({
      id: "elitetorrent",
      name: "EliteTorrent",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.ELITETORRENT_BASE_URL || "https://www.elitetorrent.wf";
  }

  async search({ type, query }) {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      return [];
    }

    const url = `${this.baseUrl}/?s=${encodeURIComponent(trimmed).replace(/%20/g, "+")}&x=0&y=0`;
    const html = await this.fetchText(url);
    return this.extractSearchItems(html, type);
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
    const torrents = this.extractTorrentStreams(html, {
      baseTitle: this.extractTitle(html) || this.unslugify(target.path)
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
    const torrents = this.extractTorrentStreams(html, {
      baseTitle: this.extractTitle(html) || bestMatch.name
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

  searchWithFallbackQueries({ type, externalMeta }) {
    const queries = this.buildSearchQueries(externalMeta);
    const deduped = new Map();

    return (async () => {
      for (const query of queries) {
        const results = await this.search({ type, query });
        for (const result of results) {
          if (!deduped.has(result.id)) {
            deduped.set(result.id, result);
          }
        }
      }
      return Array.from(deduped.values());
    })();
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

  extractSearchItems(html, requestedType) {
    const items = [];
    const seen = new Set();
    const listPattern = /<li[\s\S]*?<div[^>]*class=["'][^"']*\bimagen\b[^"']*["'][\s\S]*?<\/li>/gi;

    for (const match of html.matchAll(listPattern)) {
      const block = match[0];
      const href = this.decodeHtmlEntities(this.extractFirstMatch(block, /<a[^>]+href=["']([^"']+)["']/i));
      const title = this.decodeHtmlEntities(this.extractFirstMatch(block, /<a[^>]+title=["']([^"']+)["']/i));
      if (!href || !title) {
        continue;
      }

      const resolvedType = this.resolveTypeFromPath(href, requestedType);
      const slug = this.extractSlugFromUrl(href);
      if (!slug || !resolvedType) {
        continue;
      }

      if (this.isGenericSearchResult(slug, title)) {
        continue;
      }

      const item = {
        id: buildStremioId(this.id, resolvedType, slug),
        type: resolvedType,
        name: this.cleanTitle(title),
        poster: this.extractFirstMatch(block, /<img[^>]+src=["']([^"']+)["']/i) || null,
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

  extractTorrentStreams(html, context = {}) {
    const magnetLinks = Array.from(
      new Set(
        Array.from(
          html.matchAll(/<a[^>]+href=["'](magnet:\?xt=urn:btih:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi),
          (match) => ({
            magnet: this.decodeHtmlEntities(match[1]),
            label: this.cleanText(match[2])
          })
        )
      )
    );

    const detailText = this.cleanText(html);
    const seeds = this.extractFirstNumber(detailText, /Semillas:\s*(\d+)/i);
    const peers = this.extractFirstNumber(detailText, /Clientes:\s*(\d+)/i);
    const size = this.extractSizeLabel(
      this.extractFirstMatch(detailText, /Tama(?:ñ|Ã±)o:\s*([^\n]+)/i) || detailText
    );

    return this.dedupeTorrentStreams(
      magnetLinks.map((entry) => this.buildTorrentStream(entry.magnet, {
        baseTitle: context.baseTitle || "EliteTorrent",
        label: entry.label,
        seeds,
        peers,
        size
      })).filter(Boolean)
    );
  }

  buildTorrentStream(rawUrl, context = {}) {
    const decodedUrl = this.decodeHtmlEntities(String(rawUrl || "").trim());
    const infoHash = this.extractInfoHash(decodedUrl);
    if (!infoHash) {
      return null;
    }

    const parsedMagnet = this.parseMagnet(decodedUrl);
    const displayName = this.cleanText(parsedMagnet?.dn || context.label || context.baseTitle || "EliteTorrent");
    const title = `[TORRENT][CAST] ${displayName}`.replace(/\s+/g, " ").trim();
    const trackers = this.normalizeTrackers(parsedMagnet?.tr?.length ? parsedMagnet.tr : DEFAULT_TRACKERS);

    return {
      name: "EliteTorrent",
      title,
      infoHash,
      fileIdx: 0,
      sources: trackers.map((tracker) => `tracker:${tracker}`),
      seeders: Number(context.seeds) || 0,
      peers: Number(context.peers) || 0,
      size: context.size || "",
      behaviorHints: {
        bingeGroup: "torrent"
      }
    };
  }

  buildTorrentDebug(html) {
    return {
      magnetCount: (html.match(/magnet:\?xt=urn:btih:/gi) || []).length,
      magnetLabelSample: Array.from(
        html.matchAll(/<a[^>]+href=["']magnet:\?xt=urn:btih:[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi),
        (match) => this.cleanText(match[1])
      ).slice(0, 10),
      seeds: this.extractFirstNumber(this.cleanText(html), /Semillas:\s*(\d+)/i),
      peers: this.extractFirstNumber(this.cleanText(html), /Clientes:\s*(\d+)/i),
      size: this.extractSizeLabel(this.cleanText(html))
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
      if (value && /^(?:udp|https?):\/\/.+\/announce$/i.test(value)) {
        normalized.add(value);
      }
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

  parseSlug(slug) {
    return {
      path: String(slug || ""),
      url: this.toAbsoluteUrl(String(slug || ""))
    };
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

  resolveTypeFromPath(path, fallbackType) {
    const value = String(path || "").toLowerCase();
    if (/(serie|temporada|capitulo)/i.test(value)) return "series";
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

  extractTitle(html) {
    return this.cleanText(
      this.extractFirstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      this.extractFirstMatch(html, /<title>([^<]+)<\/title>/i)
    ).replace(/\s*[-|]\s*EliteTorrent.*$/i, "").trim();
  }

  extractPoster(html) {
    return this.toAbsoluteUrl(this.extractFirstMatch(html, /<img[^>]+src=["']([^"']+)["']/i));
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

  pickBestCandidate(candidates, externalMeta) {
    const targetTitle = this.normalizeTitle(externalMeta.name);
    const targetYear = this.extractYearValue(externalMeta.releaseInfo || externalMeta.year || "");
    const targetLooksLatin = this.usesMostlyLatinScript(externalMeta.name);

    const scored = candidates.map((candidate) => {
      const candidateTitle = this.normalizeTitle(candidate.name);
      const candidateYear = this.extractYearValue(candidate.releaseInfo || "");
      const similarity = this.stringSimilarity(candidateTitle, targetTitle);
      const candidateLooksLatin = this.usesMostlyLatinScript(candidate.name);
      const wordOverlap = this.countWordOverlap(candidateTitle, targetTitle);

      let score = 0;
      if (candidateTitle === targetTitle) score += 100;
      else if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) score += 35;
      if (similarity >= 0.92) score += 55;
      else if (similarity >= 0.84) score += 30;
      else if (similarity < 0.45) score -= 80;
      if (targetYear && candidateYear && targetYear === candidateYear) score += 20;
      if (wordOverlap === 0) score -= 45;
      else score += Math.min(24, wordOverlap * 8);
      if (targetLooksLatin && !candidateLooksLatin) score -= 70;
      if (candidateTitle.length < 3) score -= 80;
      if (this.isGenericSearchResult(candidate.id, candidate.name)) score -= 120;

      return { candidate, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.score >= 35 ? scored[0].candidate : null;
  }

  isGenericSearchResult(slug, title) {
    const slugValue = String(slug || "").toLowerCase();
    const titleValue = this.normalizeTitle(title);

    if (!slugValue || slugValue === "/" || slugValue === "/peliculas/" || slugValue === "/series/") {
      return true;
    }

    if (/^\/?(peliculas?|series?)\/?$/i.test(slugValue)) {
      return true;
    }

    if (/\b(?:peliculas? torrent|series torrent|descargar torrent)\b/i.test(titleValue)) {
      return true;
    }

    return false;
  }

  countWordOverlap(left, right) {
    const a = new Set(String(left || "").split(/\s+/).filter((word) => word.length >= 3));
    const b = new Set(String(right || "").split(/\s+/).filter((word) => word.length >= 3));
    let count = 0;

    for (const word of a) {
      if (b.has(word)) {
        count += 1;
      }
    }

    return count;
  }

  usesMostlyLatinScript(value) {
    const letters = Array.from(String(value || "").normalize("NFC")).filter((char) => /\p{L}/u.test(char));
    if (letters.length === 0) {
      return true;
    }

    const latinCount = letters.filter((char) => /\p{Script=Latin}/u.test(char)).length;
    return latinCount / letters.length >= 0.7;
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

  dedupeTorrentStreams(streams) {
    return Array.from(new Map(streams.map((stream) => [`${stream.infoHash}:${stream.fileIdx ?? 0}`, stream])).values());
  }

  extractFirstNumber(text, pattern) {
    const match = pattern.exec(String(text || ""));
    return match ? Number(match[1]) || 0 : 0;
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
    return this.cleanText(String(value || "").replace(/\s*[-|]\s*EliteTorrent.*$/i, "").replace(/^descargar\s+/i, ""));
  }

  extractFirstMatch(text, pattern) {
    return pattern.exec(String(text || ""))?.[1] || "";
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
      const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new Error(`No se pudo conectar con EliteTorrent en ${url}. ${details}`);
    }

    if (!response.ok) {
      throw new Error(`EliteTorrent respondio ${response.status} para ${url}`);
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
