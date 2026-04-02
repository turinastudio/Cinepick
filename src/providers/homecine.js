import cheerio from "cheerio-without-node-native";
import { buildStremioId } from "../lib/ids.js";
import {
  absoluteUrl,
  mapSearchItem,
  normalizeTitle,
  scoreSearchCandidate,
  stripTags
} from "../lib/webstreamer/common.js";
import { fetchText } from "../lib/webstreamer/http.js";
import { resolveWebstreamCandidates } from "../lib/webstreamer/resolve.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

export class HomeCineProvider extends WebstreamBaseProvider {
  constructor() {
    super({
      id: "homecine",
      name: "HomeCine",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.HOMECINE_BASE_URL || "https://www3.homecine.to";
  }

  async search({ type, query }) {
    if (!query?.trim()) {
      return [];
    }

    const html = await fetchText(`${this.baseUrl}/?s=${encodeURIComponent(query.trim())}`).catch(() => "");
    if (!html) {
      return [];
    }

    const $ = cheerio.load(html);
    const items = [];

    $("a[oldtitle]").each((_, el) => {
      const href = absoluteUrl($(el).attr("href"), this.baseUrl);
      const title = stripTags($(el).attr("oldtitle"));
      if (!href || !title) {
        return;
      }

      const itemType = /\/series\//i.test(href) ? "series" : "movie";
      if (itemType !== type) {
        return;
      }

      if (scoreSearchCandidate(query, title, "", "") < 5) {
        return;
      }

      items.push(mapSearchItem(this.id, itemType, new URL(href).pathname, title));
    });

    return this.dedupeById(items);
  }

  async getMeta({ type, slug }) {
    const url = absoluteUrl(slug, this.baseUrl);
    const html = await fetchText(url).catch(() => "");
    const $ = cheerio.load(html);
    const name =
      stripTags($("meta[property='og:title']").attr("content")) ||
      stripTags($("title").text());
    const poster =
      $("meta[property='og:image']").attr("content") ||
      $("img[src]").first().attr("src") ||
      null;
    const description =
      stripTags($("meta[property='og:description']").attr("content")) ||
      stripTags($(".sinopsis, .entry-content, .post-content").first().text()) ||
      "";

    return {
      id: buildStremioId(this.id, type, slug),
      type,
      name,
      poster,
      background: poster,
      description,
      genres: [],
      cast: [],
      videos: []
    };
  }

  async getStreams({ type, slug }) {
    let pageUrl = absoluteUrl(slug, this.baseUrl);
    let pageHtml = await fetchText(pageUrl).catch(() => "");

    if (!pageHtml) {
      return [];
    }

    const $ = cheerio.load(pageHtml);
    const pageTitle = stripTags($("meta[property='og:title']").attr("content") || $("title").text());
    const rawCandidates = this.extractRawCandidates(pageHtml, pageUrl, pageTitle);

    const streams = await resolveWebstreamCandidates(this.id, rawCandidates);
    return this.sortStreams(streams);
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
    const bestMatch = this.pickBestCandidate(candidates, externalMeta);
    if (!bestMatch) {
      return [];
    }

    let slug = bestMatch.id.split(":").slice(2).join(":");

    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const pageUrl = absoluteUrl(slug, this.baseUrl);
      const html = await fetchText(pageUrl).catch(() => "");
      const suffix = `-temporada-${parsedExternal.season}-capitulo-${parsedExternal.episode}`;
      const episodeHref = Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/gi))
        .map((item) => absoluteUrl(item[1], pageUrl))
        .find((href) => href && href.endsWith(suffix));

      if (!episodeHref) {
        return [];
      }

      slug = new URL(episodeHref).pathname;
    }

    return this.getStreams({ type, slug });
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
          releaseInfo: externalMeta.releaseInfo || "",
          type: externalMeta.type
        }
      : null;

    if (!externalMeta?.name) {
      debug.status = "missing_external_meta";
      return debug;
    }

    const candidates = await this.searchWithFallbackQueries({ type, externalMeta });
    debug.candidates = candidates.map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      name: candidate.name,
      releaseInfo: candidate.releaseInfo || ""
    }));

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
      debug.status = candidates.length ? "no_best_match" : "no_candidates";
      return debug;
    }

    let slug = bestMatch.id.split(":").slice(2).join(":");

    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const pageUrl = absoluteUrl(slug, this.baseUrl);
      const html = await fetchText(pageUrl).catch(() => "");
      const suffix = `-temporada-${parsedExternal.season}-capitulo-${parsedExternal.episode}`;
      const episodeHref = Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/gi))
        .map((item) => absoluteUrl(item[1], pageUrl))
        .find((href) => href && href.endsWith(suffix));
      debug.episodeLookup = { suffix, found: Boolean(episodeHref) };

      if (!episodeHref) {
        debug.status = "no_matching_episode";
        return debug;
      }

      slug = new URL(episodeHref).pathname;
    }

    const pageUrl = absoluteUrl(slug, this.baseUrl);
    const pageHtml = await fetchText(pageUrl).catch(() => "");
    const $ = cheerio.load(pageHtml);
    const pageTitle = stripTags($("meta[property='og:title']").attr("content") || $("title").text());
    const rawCandidates = this.extractRawCandidates(pageHtml, pageUrl, pageTitle);
    const streams = await resolveWebstreamCandidates(this.id, rawCandidates);
    const selectedStreams = this.sortStreams(streams);
    debug.rawCandidateCount = rawCandidates.length;
    debug.rawCandidateSample = rawCandidates.slice(0, 10).map((item) => item.url);
    debug.streamCount = selectedStreams.length;
    debug.streams = selectedStreams;
    debug.status = selectedStreams.length ? "ok" : "no_streams";
    return debug;
  }

  extractRawCandidates(pageHtml, pageUrl, pageTitle) {
    const $ = cheerio.load(pageHtml);
    const rawCandidates = [];
    const pushRaw = (rawUrl) => {
      const finalUrl = absoluteUrl(rawUrl, pageUrl);
      if (!finalUrl) {
        return;
      }

      rawCandidates.push({
        source: "HomeCine",
        label: `[LAT] ${pageTitle || "HomeCine"}`,
        url: finalUrl
      });
    };

    const extractEmbedsFromChunk = (chunk) => {
      const html = String(chunk || "");
      const iframeMatches = [
        ...html.matchAll(/<iframe[^>]*src=["']([^"']+)["']/gi),
        ...html.matchAll(/data-(?:src|link)=["']([^"']+)["']/gi)
      ];

      iframeMatches.forEach((match) => pushRaw(match[1]));
    };

    $(".les-content a, .tab-content a, .options a, a[href]").each((_, el) => {
      const text = stripTags($(el).text()).toLowerCase();
      const href = String($(el).attr("href") || "");
      const title = String($(el).attr("title") || "").toLowerCase();
      const context = `${text} ${title}`;

      if (!context.includes("latino")) {
        return;
      }

      if (href.startsWith("#")) {
        extractEmbedsFromChunk($(href).html() || "");
        return;
      }

      extractEmbedsFromChunk(href);
      if (/^https?:\/\//i.test(href) || /^\/\//.test(href)) {
        pushRaw(href);
      }
    });

    for (const match of pageHtml.matchAll(/latino[\s\S]{0,2000}?(<iframe[^>]*src=["'][^"']+["'][\s\S]{0,500}?<\/iframe>|data-(?:src|link)=["'][^"']+["'])/gi)) {
      extractEmbedsFromChunk(match[0]);
    }

    return Array.from(new Map(rawCandidates.map((item) => [item.url, item])).values());
  }
}
