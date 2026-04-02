import crypto from "node:crypto";
import { buildStremioId } from "../lib/ids.js";
import { Provider } from "./base.js";

const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.cyberia.is:6969/announce",
  "udp://exodus.desync.com:6969/announce"
];

export class MitorrentProvider extends Provider {
  constructor() {
    super({
      id: "mitorrent",
      name: "MiTorrent",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.MITORRENT_BASE_URL || "https://mitorrent.mx";
  }

  async search({ type, query }) {
    const trimmedQuery = String(query || "").trim();
    const url = trimmedQuery
      ? `${this.baseUrl}/?s=${encodeURIComponent(trimmedQuery)}`
      : type === "series"
        ? `${this.baseUrl}/series/`
        : `${this.baseUrl}/peliculas/`;

    const html = await this.fetchText(url);
    return this.extractCards(html, type);
  }

  async getMeta({ type, slug }) {
    const target = this.parseSlug(slug);
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
    const html = await this.fetchText(target.url);
    return this.extractTorrentStreams(html, {
      type,
      name: this.extractTitle(html) || this.unslugify(target.path)
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

    const slug = bestMatch.id.split(":").slice(2).join(":");
    const target = this.parseSlug(slug);
    const html = await this.fetchText(target.url);
    const htmlDebug = this.buildHtmlDebug(html);
    htmlDebug.protectedTargetDebug = await this.inspectProtectedTargets(
      htmlDebug.encodedDownloadTargetSample || []
    );
    const streams = await this.extractTorrentStreams(html, {
      type: bestMatch.type,
      name: this.extractTitle(html) || bestMatch.name
    });

    debug.targetUrl = target.url;
    debug.htmlDebug = htmlDebug;
    debug.torrentCount = streams.length;
    debug.torrents = streams.map((stream) => ({
      title: stream.title,
      infoHash: stream.infoHash,
      fileIdx: stream.fileIdx ?? null,
      seeders: stream.seeders ?? null,
      sources: stream.sources || [],
      behaviorHints: stream.behaviorHints || null
    }));
    debug.streams = streams;
    debug.status = streams.length > 0 ? "ok" : "no_streams";

    return debug;
  }

  async debugInternalStreams({ type, slug }) {
    const target = this.parseSlug(slug);
    const html = await this.fetchText(target.url);
    const title = this.extractTitle(html) || this.unslugify(target.path);
    const htmlDebug = this.buildHtmlDebug(html);
    htmlDebug.protectedTargetDebug = await this.inspectProtectedTargets(
      htmlDebug.encodedDownloadTargetSample || []
    );
    const streams = await this.extractTorrentStreams(html, { type, name: title });

    return {
      targetUrl: target.url,
      resolvedType: type,
      title,
      htmlDebug,
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
      if (!href || !type || type !== requestedType || !this.isDetailPath(href)) {
        continue;
      }

      const title = this.cleanText(
        this.extractFirstMatch(block, /<h2[^>]*>([\s\S]*?)<\/h2>/i) ||
        this.extractFirstMatch(block, /<h3[^>]*>([\s\S]*?)<\/h3>/i) ||
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
    const title = String(context?.name || "MiTorrent").trim();
    const torrents = [];

    for (const rawUrl of await this.extractTorrentUrls(html)) {
      const torrent = this.buildTorrentStream(rawUrl, title);
      if (torrent) {
        torrents.push(torrent);
      }
    }

    return this.dedupeTorrentStreams(torrents);
  }

  buildHtmlDebug(html) {
    const links = Array.from(
      new Set(
        Array.from(
          html.matchAll(/(?:href|data-href|data-url|data-download|data-target-url|action)=["']([^"']+)["']/gi),
          (match) => this.decodeHtmlEntities(match[1] || "").trim()
        ).filter(Boolean)
      )
    );

    const onclickScripts = Array.from(
      new Set(
        Array.from(
          html.matchAll(/\bonclick=["']([^"']+)["']/gi),
          (match) => this.decodeHtmlEntities(match[1] || "").trim()
        ).filter(Boolean)
      )
    );
    const extractedScriptUrls = Array.from(
      new Set(onclickScripts.flatMap((script) => this.extractUrlsFromScript(script)))
    );
    const interestingLinks = links.filter((link) => this.isInterestingDownloadUrl(link));
    const interestingScriptUrls = extractedScriptUrls.filter((link) => this.isInterestingDownloadUrl(link));
    const encodedDownloadTargets = this.extractEncodedDownloadTargets(html);
    const keywordSnippets = this.extractKeywordSnippets(html, [
      "descargar",
      "download",
      "torrent",
      "magnet",
      "btih"
    ]);
    const dataAttributeSample = Array.from(
      new Set(
        Array.from(
          html.matchAll(/\b(data-[a-z0-9_-]+)=["']([^"']{1,300})["']/gi),
          (match) => `${match[1]}=${match[2]}`
        )
      )
    )
      .filter((value) => /(torrent|magnet|download|descargar|hash|post|link|url|target|id)/i.test(value))
      .slice(0, 20);

    return {
      title: this.extractTitle(html),
      totalLinkCount: links.length,
      interestingLinkCount: interestingLinks.length,
      interestingLinkSample: interestingLinks.slice(0, 20),
      onclickCount: onclickScripts.length,
      onclickSample: onclickScripts.slice(0, 20),
      interestingScriptUrlCount: interestingScriptUrls.length,
      interestingScriptUrlSample: interestingScriptUrls.slice(0, 20),
      encodedDownloadTargetCount: encodedDownloadTargets.length,
      encodedDownloadTargetSample: encodedDownloadTargets.slice(0, 20),
      keywordSnippets,
      dataAttributeSample,
      magnetCount: (html.match(/magnet:\?xt=urn:btih:/gi) || []).length,
      torrentHrefCount: (html.match(/\.torrent(\?|["'])/gi) || []).length,
      downloadWordCount: (html.match(/download|descargar/gi) || []).length
    };
  }

  extractKeywordSnippets(html, keywords) {
    const source = String(html || "");
    const snippets = [];

    for (const keyword of keywords) {
      const pattern = new RegExp(`.{0,120}${keyword}.{0,160}`, "gi");
      for (const match of source.matchAll(pattern)) {
        const snippet = this.cleanText(match[0]);
        if (snippet) {
          snippets.push(snippet);
        }
        if (snippets.length >= 20) {
          return snippets;
        }
      }
    }

    return snippets;
  }

  async extractTorrentUrls(html) {
    const urls = new Set();

    for (const match of html.matchAll(/(?:href|data-href|data-url|data-download|data-target-url|action)=["']([^"']+)["']/gi)) {
      const url = this.decodeHtmlEntities(match[1] || "").trim();
      if (!url) {
        continue;
      }

      if (this.isInterestingDownloadUrl(url)) {
        urls.add(url);
      }
    }

    for (const match of html.matchAll(/\bonclick=["']([^"']+)["']/gi)) {
      const script = this.decodeHtmlEntities(match[1] || "");
      for (const url of this.extractUrlsFromScript(script)) {
        if (this.isInterestingDownloadUrl(url)) {
          urls.add(url);
        }
      }
    }

    for (const match of html.matchAll(/(magnet:\?xt=urn:btih:[^"'\\<\s]+)/gi)) {
      urls.add(this.decodeHtmlEntities(match[1]));
    }

    for (const target of this.extractEncodedDownloadTargets(html)) {
      if (target.decoded && this.isInterestingDownloadUrl(target.decoded)) {
        urls.add(target.decoded);
      }
    }

    const resolvedUrls = new Set();

    for (const url of urls) {
      resolvedUrls.add(url);

      for (const candidate of await this.resolveProtectedDownloadUrl(url)) {
        resolvedUrls.add(candidate);
      }
    }

    return Array.from(resolvedUrls);
  }

  async resolveProtectedDownloadUrl(url, depth = 0) {
    const value = String(url || "").trim();
    if (!value || depth >= 3) {
      return [];
    }

    if (!/acortalink\.net/i.test(value)) {
      return [];
    }

    const results = new Set();

    try {
      const response = await fetch(value, {
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "es-ES,es;q=0.9,en;q=0.8",
          referer: `${this.baseUrl}/`
        }
      });

      const finalUrl = response.url || "";
      if (finalUrl && finalUrl !== value) {
        results.add(finalUrl);
      }

      const html = await response.text();

      for (const match of html.matchAll(/(?:href|data-href|data-url|action)=["']([^"']+)["']/gi)) {
        const candidate = this.decodeHtmlEntities(match[1] || "").trim();
        if (this.isInterestingDownloadUrl(candidate) || /^magnet:/i.test(candidate) || /\.torrent(\?|$)/i.test(candidate)) {
          results.add(candidate);
        }
      }

      for (const match of html.matchAll(/(magnet:\?xt=urn:btih:[^"'\\<\s]+)/gi)) {
        results.add(this.decodeHtmlEntities(match[1]));
      }

      for (const match of html.matchAll(/https?:\/\/[^"'()\s]+/gi)) {
        const candidate = this.decodeHtmlEntities(match[0]);
        if (this.isInterestingDownloadUrl(candidate) || /^magnet:/i.test(candidate) || /\.torrent(\?|$)/i.test(candidate)) {
          results.add(candidate);
        }
      }
    } catch {
      return [];
    }

    const expanded = new Set(results);

    for (const candidate of results) {
      if (/acortalink\.net/i.test(candidate) && candidate !== value) {
        for (const nested of await this.resolveProtectedDownloadUrl(candidate, depth + 1)) {
          expanded.add(nested);
        }
      }
    }

    return Array.from(expanded);
  }

  async inspectProtectedTargets(targets) {
    const sample = Array.isArray(targets) ? targets.slice(0, 2) : [];
    const results = [];

    for (const target of sample) {
      const url = String(target?.decoded || target?.raw || "").trim();
      if (!url) {
        continue;
      }

      try {
        const response = await fetch(url, {
          redirect: "follow",
          headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "es-ES,es;q=0.9,en;q=0.8",
            referer: `${this.baseUrl}/`
          }
        });

        const html = await response.text();
        const scriptSrcSample = Array.from(
          new Set(
            Array.from(
              html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi),
              (match) => this.decodeHtmlEntities(match[1] || "").trim()
            ).filter(Boolean)
          )
        ).slice(0, 15);

        results.push({
          url,
          finalUrl: response.url || "",
          status: response.status,
          scriptSrcSample,
          keywordSnippets: this.extractKeywordSnippets(html, [
            "gibberishaes",
            "decrypt",
            "cryptojs",
            "u2fsdgvkx1",
            "salted__",
            "download"
          ]).slice(0, 12),
          hiddenInputSample: Array.from(
            new Set(
              Array.from(
                html.matchAll(/<input[^>]+type=["']hidden["'][^>]+(?:name|id)=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi),
                (match) => `${match[1]}=${match[2]}`
              )
            )
          ).slice(0, 15)
        });
      } catch (error) {
        results.push({
          url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return results;
  }

  extractEncodedDownloadTargets(html) {
    const targets = [];

    for (const match of html.matchAll(/href=["']([^"']+)["'][^>]*class=["'][^"']*(?:quality-download|download-torrent)[^"']*["']/gi)) {
      const raw = this.decodeHtmlEntities(match[1] || "").trim();
      const decoded = this.decodeBase64Value(raw);
      targets.push({
        raw,
        decoded
      });
    }

    return targets.filter((target) => target.raw);
  }

  decodeBase64Value(value) {
    const raw = String(value || "").trim();
    if (!raw || /^(?:https?:\/\/|magnet:|\/)/i.test(raw)) {
      return raw;
    }

    try {
      const normalized = raw.replaceAll("-", "+").replaceAll("_", "/");
      const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
      const decoded = Buffer.from(`${normalized}${padding}`, "base64").toString("utf8").trim();
      return decoded || "";
    } catch {
      return "";
    }
  }

  extractUrlsFromScript(script) {
    const urls = new Set();
    const source = String(script || "");

    for (const match of source.matchAll(/https?:\/\/[^"'()\s]+/gi)) {
      urls.add(this.decodeHtmlEntities(match[0]));
    }

    for (const match of source.matchAll(/(?:location(?:\.href)?|window\.open)\s*=?\s*['"]([^'"]+)['"]/gi)) {
      urls.add(this.decodeHtmlEntities(match[1]));
    }

    return Array.from(urls);
  }

  isInterestingDownloadUrl(url) {
    const value = String(url || "");
    return /^(?:magnet:|https?:\/\/)/i.test(value) &&
      /(magnet:|\.torrent\b|torrent|download|descargar|btih|acortador|ouo|shrink|exe\.io|linkvertise|adf\.ly|mega|mediafire|1fichier|uptobox|protect|protector)/i.test(value);
  }

  buildTorrentStream(rawUrl, baseTitle) {
    const decodedUrl = this.decodeHtmlEntities(String(rawUrl || "").trim());
    const infoHash = this.extractInfoHash(decodedUrl);

    if (!infoHash) {
      return null;
    }

    const parsedMagnet = /^magnet:/i.test(decodedUrl) ? this.parseMagnet(decodedUrl) : null;
    const displayName = this.cleanText(parsedMagnet?.dn || this.filenameFromUrl(decodedUrl) || baseTitle);
    const fullTitle = `[TORRENT] ${displayName || baseTitle}`.trim();
    const trackers = parsedMagnet?.tr?.length ? parsedMagnet.tr : DEFAULT_TRACKERS;
    const qualityText = `${fullTitle} ${baseTitle}`.toLowerCase();
    const seeders = this.extractFirstNumber(qualityText, /\b(\d+)\s*(?:seed|seeder|semillas)\b/i);
    const peers = this.extractFirstNumber(qualityText, /\b(\d+)\s*(?:peer|leech|leecher)\b/i);
    const size = this.extractSizeLabel(qualityText);

    return {
      name: "MiTorrent",
      title: fullTitle,
      infoHash,
      fileIdx: 0,
      sources: trackers.map((tracker) => `tracker:${tracker}`),
      seeders,
      peers,
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
      .replace(/\s*[-|]\s*Mitorrent.*$/i, "")
      .trim();
  }

  extractPoster(html) {
    return this.toAbsoluteUrl(
      this.extractFirstMatch(html, /<img[^>]+(?:data-src|src)=["']([^"']+)["'][^>]*>/i)
    );
  }

  extractDescription(html) {
    return this.cleanText(
      this.extractFirstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      this.extractFirstMatch(html, /<div[^>]+class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
    );
  }

  extractGenres(html) {
    return Array.from(
      html.matchAll(/<a[^>]+href=["'][^"']*(?:genero|genre)[^"']*["'][^>]*>([^<]+)<\/a>/gi),
      (match) => this.cleanText(match[1])
    ).filter(Boolean);
  }

  extractYear(html) {
    return this.extractYearValue(html);
  }

  searchWithFallbackQueries({ type, externalMeta }) {
    return this.runSearchQueries(type, this.buildSearchQueries(externalMeta));
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
    if (value.includes("/peliculas/")) return "movie";
    if (value.includes("/series/") || value.includes("/animes/")) return "series";
    return "";
  }

  isDetailPath(path) {
    const value = String(path || "").toLowerCase();
    if (!value) {
      return false;
    }

    if (value === "/peliculas/" || value === "/series/" || value === "/animes/") {
      return false;
    }

    return value.split("/").filter(Boolean).length >= 2;
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
      return parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
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
      throw new Error(`No se pudo conectar con MiTorrent en ${url}. ${details}`);
    }

    if (!response.ok) {
      throw new Error(`MiTorrent respondio ${response.status} para ${url}`);
    }

    return response.text();
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
