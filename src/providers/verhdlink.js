import cheerio from "cheerio-without-node-native";
import { buildStremioId } from "../lib/ids.js";
import { absoluteUrl, stripTags } from "../lib/webstreamer/common.js";
import { fetchText } from "../lib/webstreamer/http.js";
import { resolveWebstreamCandidates } from "../lib/webstreamer/resolve.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

export class VerHdLinkProvider extends WebstreamBaseProvider {
  constructor() {
    super({
      id: "verhdlink",
      name: "VerHdLink",
      supportedTypes: ["movie"]
    });

    this.baseUrl = process.env.VERHDLINK_BASE_URL || "https://verhdlink.cam";
  }

  async search() {
    return [];
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
    const html = await fetchText(pageUrl).catch(() => "");
    const $ = cheerio.load(html);
    const pageTitle =
      stripTags($("meta[property='og:title']").attr("content")) ||
      stripTags($("title").text()) ||
      "VerHdLink";
    const rawCandidates = [];
    const latinoBlock = html.match(/_player-mirrors[^"']*latino[\s\S]{0,6000}?(?:<\/section>|<\/div>)/i)?.[0] || "";

    for (const match of latinoBlock.matchAll(/data-link=["']([^"']+)["']/gi)) {
      const rawUrl = absoluteUrl(match[1], pageUrl);
      if (!rawUrl || /verhdlink/i.test(rawUrl)) {
        continue;
      }

      rawCandidates.push({
        source: "VerHdLink",
        label: "[LAT] VerHdLink",
        url: rawUrl
      });
    }

    const streams = await resolveWebstreamCandidates(this.id, rawCandidates);
    return this.sortStreams(this.attachDisplayTitle(streams, pageTitle));
  }

  async getStreamsFromExternalId({ type, externalId }) {
    if (type !== "movie" || !externalId?.startsWith("tt")) {
      return [];
    }

    return this.getStreams({
      type,
      slug: `/movie/${externalId}`
    });
  }

  async debugStreamsFromExternalId({ type, externalId }) {
    const debug = {
      provider: this.id,
      type,
      externalId,
      supported: type === "movie" && externalId?.startsWith("tt")
    };

    if (!debug.supported) {
      return debug;
    }

    debug.bestMatch = {
      id: buildStremioId(this.id, type, `/movie/${externalId}`),
      type,
      name: externalId,
      releaseInfo: ""
    };

    const streams = await this.getStreams({
      type,
      slug: `/movie/${externalId}`
    });

    debug.streamCount = streams.length;
    debug.streams = streams;
    debug.status = streams.length ? "ok" : "no_streams";
    return debug;
  }
}
