import cheerio from "cheerio-without-node-native";
import { buildStremioId } from "../../../lib/ids.js";
import {
  absoluteUrl,
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

      items.push({
        id: buildStremioId(this.id, "series", new URL(href).pathname),
        type: "series",
        name: title,
        releaseInfo: ""
      });
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
    // Slug format: /series/show-name/@SxE
    const episodeMatch = slug.match(/@(\d+)x(\d+)$/);
    if (!episodeMatch) {
      return [];
    }

    const pageUrl = absoluteUrl(slug.replace(/@\d+x\d+$/, ""), this.baseUrl);
    const html = await fetchText(pageUrl, { headers: { Referer: `${this.baseUrl}/series/` } }).catch(() => "");
    if (!html) return [];

    const $ = cheerio.load(html);

    // Check for Latino language
    const langsHtml = $(".details__langs").html() || "";
    if (!langsHtml.toLowerCase().includes("latino")) {
      return [];
    }

    const targetEpisode = `${episodeMatch[1]}x${episodeMatch[2]}`;
    const rawCandidates = [];

    // Based on WebStreamrMBG reference: use cheerio selectors with data-num attribute
    $(`[data-num="${targetEpisode}"]`).siblings(".mirrors").children("[data-link]").each((_, el) => {
      const dataLink = $(el).attr("data-link") || "";
      if (!dataLink || dataLink.trim() === "") return;

      // Normalize URL
      const normalizedUrl = dataLink.replace(/^(https:)?\/\//, "https://");
      const rawUrl = absoluteUrl(normalizedUrl, pageUrl);

      if (!rawUrl || /cinehdplus/i.test(rawUrl)) return;

      rawCandidates.push({
        source: "CineHDPlus",
        label: "[LAT] CineHDPlus",
        url: rawUrl
      });
    });

    const streams = await resolveWebstreamCandidates(this.id, rawCandidates);
    const title = stripTags($("meta[property='og:title']").attr("content") || $("title").text());
    return this.sortStreams(this.attachDisplayTitle(streams, `${title} ${targetEpisode}`));
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

    // Search for the series
    const searchHtml = await fetchText(
      `${this.baseUrl}/series/?story=${encodeURIComponent(externalMeta.name)}&do=search&subaction=search`,
      { headers: { Referer: `${this.baseUrl}/series/` } }
    ).catch(() => "");

    if (!searchHtml) return [];

    const $ = cheerio.load(searchHtml);
    const firstLink = $(".card__title a[href]").first();
    if (!firstLink.length) return [];

    const seriesUrl = absoluteUrl(firstLink.attr("href"), this.baseUrl);
    const slug = `${new URL(seriesUrl).pathname}@${parsedExternal.season}x${parsedExternal.episode}`;

    return this.getStreams({ type, slug });
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
