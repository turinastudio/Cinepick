import cheerio from "cheerio-without-node-native";
import { buildStremioId } from "../lib/ids.js";
import {
  absoluteUrl,
  mapSearchItem,
  stripTags
} from "../lib/webstreamer/common.js";
import { fetchText } from "../lib/webstreamer/http.js";
import { resolveWebstreamCandidates } from "../lib/webstreamer/resolve.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

export class TioPlusProvider extends WebstreamBaseProvider {
  constructor() {
    super({
      id: "tioplus",
      name: "TioPlus",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.TIOPLUS_BASE_URL || "https://tioplus.app";
  }

  async search({ type, query }) {
    if (!query?.trim()) {
      return [];
    }

    const html = await fetchText(`${this.baseUrl}/api/search/${encodeURIComponent(query.trim())}`, {
      headers: {
        Referer: `${this.baseUrl}/search`,
        Accept: "text/html,*/*;q=0.8",
        "X-Requested-With": "XMLHttpRequest"
      }
    }).catch(() => "");

    if (!html || /No hay resultados/i.test(html)) {
      return [];
    }

    const $ = cheerio.load(`<div>${html}</div>`);
    const items = [];

    $("a.itemA[href]").each((_, el) => {
      const href = absoluteUrl($(el).attr("href"), this.baseUrl);
      const title = stripTags($(el).find("h2").text());
      const kind = stripTags($(el).find(".typeItem").text()).toLowerCase();
      const itemType = kind.includes("serie") ? "series" : "movie";
      if (!href || !title || itemType !== type) {
        return;
      }

      const year = title.match(/\((\d{4})\)/)?.[1] || "";
      items.push(mapSearchItem(this.id, itemType, new URL(href).pathname, title.replace(/\(\d{4}\)/, "").trim(), year));
    });

    return this.dedupeById(items);
  }

  async getMeta({ type, slug }) {
    const url = absoluteUrl(slug, this.baseUrl);
    const html = await fetchText(url, { headers: { Referer: this.baseUrl } }).catch(() => "");
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
      stripTags($(".overview, .description, .entry-content").first().text()) ||
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
    const html = await fetchText(pageUrl, { headers: { Referer: this.baseUrl } }).catch(() => "");
    if (!html) {
      return [];
    }

    const $ = cheerio.load(html);
    const title = stripTags($("meta[property='og:title']").attr("content") || $("title").text());
    const rawCandidates = [];

    $(".bg-tabs > div").each((_, section) => {
      const buttonText = stripTags($(section).find("button").first().text()).toLowerCase();
      if (!buttonText.includes("latino")) {
        return;
      }

      $(section)
        .find("li[data-server]")
        .each((__, el) => {
          const token = $(el).attr("data-server");
          if (!token) {
            return;
          }

          rawCandidates.push({
            source: "TioPlus",
            label: `[LAT] ${title || "TioPlus"}`,
            url: `${this.baseUrl}/player/${Buffer.from(token).toString("base64")}`,
            _needsResolve: true,
            referer: pageUrl
          });
        });
    });

    const resolvedCandidates = [];

    for (const candidate of rawCandidates) {
      const playerHtml = await fetchText(candidate.url, {
        headers: { Referer: candidate.referer || pageUrl }
      }).catch(() => "");
      const redirectUrl = playerHtml.match(/window\.location\.href\s*=\s*'([^']+)'/i)?.[1] ||
        playerHtml.match(/window\.location\.href\s*=\s*"([^"]+)"/i)?.[1] ||
        null;
      const finalUrl = absoluteUrl(redirectUrl, candidate.url);

      if (!finalUrl) {
        continue;
      }

      resolvedCandidates.push({
        source: candidate.source,
        label: candidate.label,
        url: finalUrl
      });
    }

    const streams = await resolveWebstreamCandidates(this.id, resolvedCandidates);
    return this.sortStreams(this.attachDisplayTitle(streams, title));
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
      const targetPath = `/serie/${pageUrl.split("/")[4]}/season/${parsedExternal.season}/episode/${parsedExternal.episode}`;
      const episodeHref = Array.from(html.matchAll(/<a\b[^>]*class="[^"]*itemA[^"]*"[^>]*href="([^"]+)"/gi))
        .map((item) => absoluteUrl(item[1], this.baseUrl))
        .find((href) => {
          try {
            return new URL(href).pathname === targetPath;
          } catch {
            return false;
          }
        });

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
      const html = await fetchText(pageUrl, { headers: { Referer: this.baseUrl } }).catch(() => "");
      const targetPath = `/serie/${pageUrl.split("/")[4]}/season/${parsedExternal.season}/episode/${parsedExternal.episode}`;
      const episodeHref = Array.from(html.matchAll(/<a\b[^>]*class="[^"]*itemA[^"]*"[^>]*href="([^"]+)"/gi))
        .map((item) => absoluteUrl(item[1], this.baseUrl))
        .find((href) => {
          try {
            return new URL(href).pathname === targetPath;
          } catch {
            return false;
          }
        });
      debug.episodeLookup = { targetPath, found: Boolean(episodeHref) };

      if (!episodeHref) {
        debug.status = "no_matching_episode";
        return debug;
      }

      slug = new URL(episodeHref).pathname;
    }

    const streams = await this.getStreams({ type, slug });
    debug.streamCount = streams.length;
    debug.streams = streams;
    debug.status = streams.length ? "ok" : "no_streams";
    return debug;
  }
}
