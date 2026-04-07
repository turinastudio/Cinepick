import cheerio from "cheerio-without-node-native";
import { buildStremioId } from "../lib/ids.js";
import {
  absoluteUrl,
  buildEpisodeTag,
  buildSearchTerms,
  mapSearchItem,
  scoreSearchCandidate,
  stripTags
} from "../lib/webstreamer/common.js";
import { fetchText } from "../lib/webstreamer/http.js";
import { resolveWebstreamCandidates } from "../lib/webstreamer/resolve.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

export class CuevanaProvider extends WebstreamBaseProvider {
  constructor() {
    super({
      id: "cuevana",
      name: "Cuevana",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.CUEVANA_BASE_URL || "https://ww1.cuevana3.is";
  }

  async search({ type, query }) {
    if (!query?.trim()) {
      return [];
    }

    const html = await fetchText(`${this.baseUrl}/search/${encodeURIComponent(query.trim())}/`, {
      headers: { Referer: this.baseUrl }
    }).catch(() => "");

    if (!html) {
      return [];
    }

    const $ = cheerio.load(html);
    const items = [];

    $(".MovieList.Rows > li .TPost").each((_, card) => {
      const href = absoluteUrl($(card).find("a[href]").first().attr("href"), this.baseUrl);
      const title = stripTags($(card).find(".Title").first().text());
      const year = stripTags($(card).find(".Year, .Date").first().text());
      if (!href || !title) {
        return;
      }

      const itemType = /\/serie\//i.test(href) ? "series" : "movie";
      if (itemType !== type) {
        return;
      }

      const slug = new URL(href).pathname;
      items.push(mapSearchItem(this.id, itemType, slug, title, year));
    });

    return this.dedupeById(items);
  }

  async getMeta({ type, slug }) {
    const url = absoluteUrl(slug, this.baseUrl);
    const html = await fetchText(url, { headers: { Referer: this.baseUrl } });
    const $ = cheerio.load(html);
    const name = stripTags($("meta[property='og:title']").attr("content") || $("title").text());
    const poster =
      $("meta[property='og:image']").attr("content") ||
      $(".Image img").attr("src") ||
      null;
    const description =
      $("meta[property='og:description']").attr("content") ||
      stripTags($(".Description").text()) ||
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
    const url = absoluteUrl(slug, this.baseUrl);
    const html = await fetchText(url, { headers: { Referer: this.baseUrl } });
    const $ = cheerio.load(html);
    const pageTitle = stripTags($("meta[property='og:title']").attr("content") || $("title").text());
    const rawCandidates = [];

    $(".open_submenu").each((_, el) => {
      const text = stripTags($(el).text());
      if (!/latino/i.test(text)) {
        return;
      }

      $(el)
        .find("[data-tr], [data-video]")
        .each((__, node) => {
          const rawUrl = absoluteUrl($(node).attr("data-tr") || $(node).attr("data-video"), url);
          if (!rawUrl || /youtube\.com\/embed/i.test(rawUrl)) {
            return;
          }

          rawCandidates.push({
            source: "Cuevana",
            label: `[LAT] ${pageTitle || "Cuevana"}`,
            url: rawUrl
          });
        });
    });

    const streams = await resolveWebstreamCandidates(this.id, rawCandidates);
    return this.sortStreams(this.attachDisplayTitle(streams, pageTitle));
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
      const html = await fetchText(pageUrl, { headers: { Referer: this.baseUrl } }).catch(() => "");
      const $ = cheerio.load(html);
      const target = `${parsedExternal.season}x${parsedExternal.episode}`;
      const episodeHref = $(".TPost .Year")
        .filter((_, el) => stripTags($(el).text()).toLowerCase() === target.toLowerCase())
        .closest("a")
        .attr("href");

      if (!episodeHref) {
        return [];
      }

      slug = new URL(episodeHref, this.baseUrl).pathname;
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

    debug.queries = this.buildSearchQueries(externalMeta);
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
      const html = await fetchText(pageUrl, { headers: { Referer: this.baseUrl } }).catch(() => "");
      const $ = cheerio.load(html);
      const target = `${parsedExternal.season}x${parsedExternal.episode}`;
      const episodeHref = $(".TPost .Year")
        .filter((_, el) => stripTags($(el).text()).toLowerCase() === target.toLowerCase())
        .closest("a")
        .attr("href");
      debug.episodeLookup = { target, found: Boolean(episodeHref) };

      if (!episodeHref) {
        debug.status = "no_matching_episode";
        return debug;
      }

      slug = new URL(episodeHref, this.baseUrl).pathname;
    }

    const streams = await this.getStreams({ type, slug });
    debug.streamCount = streams.length;
    debug.streams = streams;
    debug.status = streams.length ? "ok" : "no_streams";
    return debug;
  }
}
