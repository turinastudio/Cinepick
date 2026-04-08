import cheerio from "cheerio-without-node-native";
import { buildStremioId } from "../../../lib/ids.js";
import {
  absoluteUrl,
  buildSearchTerms,
  mapSearchItem,
  scoreSearchCandidate,
  stripTags
} from "../../../lib/webstreamer/common.js";
import { fetchText } from "../../../lib/webstreamer/http.js";
import { resolveWebstreamCandidates } from "../../../lib/webstreamer/resolve.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

export class CineHdPlusProvider extends WebstreamBaseProvider {
  constructor() {
    super({
      id: "cinehdplus",
      name: "CineHDPlus",
      supportedTypes: ["series"]
    });

    this.baseUrl = process.env.CINEHDPLUS_BASE_URL || "https://cinehdplus.gratis";
  }

  async search({ type, query }) {
    if (type !== "series" || !query?.trim()) {
      return [];
    }

    const html = await fetchText(
      `${this.baseUrl}/series/?story=${encodeURIComponent(query.trim())}&do=search&subaction=search`,
      { headers: { Referer: `${this.baseUrl}/series/` } }
    ).catch(() => "");

    if (!html) {
      return [];
    }

    const $ = cheerio.load(html);
    const items = [];

    $(".card__title a[href]").each((_, el) => {
      const href = absoluteUrl($(el).attr("href"), this.baseUrl);
      const title = stripTags($(el).text());
      if (!href || !title) {
        return;
      }

      items.push(mapSearchItem(this.id, "series", new URL(href).pathname, title));
    });

    return this.dedupeById(items);
  }

  async getMeta({ type, slug }) {
    const url = absoluteUrl(slug, this.baseUrl);
    const html = await fetchText(url, { headers: { Referer: `${this.baseUrl}/series/` } }).catch(() => "");
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
    const pageUrl = absoluteUrl(slug, this.baseUrl);
    const html = await fetchText(pageUrl, { headers: { Referer: `${this.baseUrl}/series/` } }).catch(() => "");
    if (!html || !/details__langs[\s\S]{0,200}latino/i.test(html)) {
      return [];
    }

    const targetMatch = slug.match(/@(\d+)x(\d+)$/);
    if (!targetMatch) {
      return [];
    }

    const targetEpisode = `${targetMatch[1]}x${targetMatch[2]}`;
    const episodeBlock = html.match(
      new RegExp(`data-num=["']${targetEpisode}["'][\\s\\S]{0,3000}?class=["'][^"']*mirrors[^"']*["'][\\s\\S]{0,5000}?<\/div>`, "i")
    )?.[0] || "";
    const rawCandidates = [];

    for (const match of episodeBlock.matchAll(/data-link=["']([^"']+)["']/gi)) {
      const rawUrl = absoluteUrl(match[1], pageUrl);
      if (!rawUrl || /cinehdplus/i.test(rawUrl)) {
        continue;
      }

      rawCandidates.push({
        source: "CineHDPlus",
        label: "[LAT] CineHDPlus",
        url: rawUrl
      });
    }

    const streams = await resolveWebstreamCandidates(this.id, rawCandidates);
    const title = stripTags(cheerio.load(html)("meta[property='og:title']").attr("content") || cheerio.load(html)("title").text());
    return this.sortStreams(this.attachDisplayTitle(streams, title));
  }

  async getStreamsFromExternalId({ type, externalId }) {
    if (type !== "series" || !externalId?.startsWith("tt")) {
      return [];
    }

    const parsedExternal = this.parseExternalStremioId(type, externalId);
    if (!parsedExternal.season || !parsedExternal.episode) {
      return [];
    }

    const externalMeta = await this.fetchCinemetaMeta(type, parsedExternal.baseId);
    if (!externalMeta?.name) {
      return [];
    }

    const queryTerms = buildSearchTerms(parsedExternal.baseId, externalMeta.name);
    const candidates = [];

    for (const term of queryTerms) {
      const html = await fetchText(
        `${this.baseUrl}/series/?story=${encodeURIComponent(term)}&do=search&subaction=search`,
        { headers: { Referer: `${this.baseUrl}/series/` } }
      ).catch(() => "");

      if (!html) {
        continue;
      }

      const $ = cheerio.load(html);
      $(".card__title a[href]").each((_, el) => {
        const href = absoluteUrl($(el).attr("href"), this.baseUrl);
        const title = stripTags($(el).text());
        if (!href || !title) {
          return;
        }

        candidates.push({
          id: buildStremioId(this.id, "series", `${new URL(href).pathname}@${parsedExternal.season}x${parsedExternal.episode}`),
          type: "series",
          name: title,
          releaseInfo: "",
          _href: href,
          _score: scoreSearchCandidate(externalMeta.name, title, externalMeta.releaseInfo || "", "")
        });
      });
    }

    const bestMatch = candidates.sort((a, b) => b._score - a._score)[0];
    if (!bestMatch) {
      return [];
    }

    return this.getStreams({
      type,
      slug: bestMatch.id.split(":").slice(2).join(":")
    });
  }

  async debugStreamsFromExternalId({ type, externalId }) {
    const debug = {
      provider: this.id,
      type,
      externalId,
      supported: type === "series" && externalId?.startsWith("tt")
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

    const streams = await this.getStreamsFromExternalId({ type, externalId });
    debug.streamCount = streams.length;
    debug.streams = streams;
    debug.status = streams.length ? "ok" : "no_streams";
    return debug;
  }
}

