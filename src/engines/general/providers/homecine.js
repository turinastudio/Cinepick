import cheerio from "cheerio-without-node-native";
import { buildStremioId } from "../../../lib/ids.js";
import {
  absoluteUrl,
  stripTags
} from "../../../lib/webstreamer/common.js";
import { fetchText } from "../../../lib/webstreamer/http.js";
import { resolveWebstreamCandidates } from "../../../lib/webstreamer/resolve.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

/**
 * Levenshtein distance for fuzzy string matching.
 * Based on WebStreamrMBG HomeCine reference implementation.
 * Returns the minimum number of single-character edits to transform str1 into str2.
 */
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

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

    const html = await fetchText(`${this.baseUrl}/?s=${encodeURIComponent(query.trim())}`, {
      headers: { Referer: `${this.baseUrl}/` }
    }).catch(() => "");

    if (!html) {
      return [];
    }

    const $ = cheerio.load(html);
    const items = [];

    $('a[oldtitle]').each((_, el) => {
      const href = absoluteUrl($(el).attr("href"), this.baseUrl);
      const title = stripTags($(el).attr("oldtitle") || "");
      if (!href || !title) {
        return;
      }

      const itemType = /\/series\//i.test(href) ? "series" : "movie";
      if (itemType !== type) {
        return;
      }

      items.push({
        id: buildStremioId(this.id, itemType, new URL(href).pathname),
        type: itemType,
        name: title,
        releaseInfo: ""
      });
    });

    return this.dedupeById(items);
  }

  async getMeta({ type, slug }) {
    const url = absoluteUrl(slug, this.baseUrl);
    const html = await fetchText(url, { headers: { Referer: `${this.baseUrl}/` } }).catch(() => "");
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
    const html = await fetchText(pageUrl, { headers: { Referer: `${this.baseUrl}/` } }).catch(() => "");
    if (!html) return [];

    const $ = cheerio.load(html);
    const rawCandidates = [];

    // Based on WebStreamrMBG reference: .les-content a with language detection
    $(".les-content a").each((_, el) => {
      const $el = $(el);
      const linkText = $el.text().toLowerCase();

      let countryCode;
      if (linkText.includes("latino")) {
        countryCode = "mx";
      } else if (linkText.includes("castellano")) {
        countryCode = "es";
      } else {
        return;
      }

      // Extract iframe src from the href attribute
      const href = $el.attr("href") || "";
      if (!href) return;

      // Try to extract iframe src from href
      let iframeSrc = "";
      const iframeMatch = href.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframeMatch) {
        iframeSrc = iframeMatch[1];
      } else if (href.startsWith("http")) {
        iframeSrc = href;
      }

      if (!iframeSrc) return;

      const rawUrl = absoluteUrl(iframeSrc, pageUrl);
      if (!rawUrl) return;

      rawCandidates.push({
        source: "HomeCine",
        label: countryCode === "mx" ? "[LAT] HomeCine" : "[CAST] HomeCine",
        url: rawUrl
      });
    });

    const streams = await resolveWebstreamCandidates(this.id, rawCandidates);
    const title = stripTags($("meta[property='og:title']").attr("content") || $("title").text());
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

    // Try to find the page using fuzzy matching (Levenshtein distance)
    // Based on WebStreamrMBG HomeCine reference implementation
    const pageUrl = await this.fetchPageUrl(externalMeta.name, type, parsedExternal.season);
    if (!pageUrl) {
      // Fallback: try with original title if different
      if (externalMeta.originalName && externalMeta.originalName !== externalMeta.name) {
        const altUrl = await this.fetchPageUrl(externalMeta.originalName, type, parsedExternal.season);
        if (!altUrl) return [];
        return this.getStreams({ type, slug: new URL(altUrl).pathname });
      }
      return [];
    }

    let slug = new URL(pageUrl).pathname;

    // For series, navigate to the specific episode
    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const episodeUrl = await this.fetchEpisodeUrl(pageUrl, parsedExternal.season, parsedExternal.episode);
      if (!episodeUrl) return [];
      slug = new URL(episodeUrl).pathname;
    }

    return this.getStreams({ type, slug });
  }

  /**
   * Fetch page URL using fuzzy matching with Levenshtein distance.
   * Based on WebStreamrMBG HomeCine reference implementation.
   */
  async fetchPageUrl(name, type, season) {
    const searchUrl = `${this.baseUrl}/?s=${encodeURIComponent(name)}`;
    const html = await fetchText(searchUrl, { headers: { Referer: `${this.baseUrl}/` } }).catch(() => "");
    if (!html) return null;

    const $ = cheerio.load(html);
    const keywords = [...new Set([name, name.replace("-", "–"), name.replace("–", "-")])];

    // Exact match first
    for (const keyword of keywords) {
      const href = $(`a[oldtitle="${keyword}"]`).first().attr("href");
      if (href) {
        const url = absoluteUrl(href, this.baseUrl);
        // Filter by type (movie vs series)
        const isSeries = /\/series\//i.test(url);
        if ((type === "series" && isSeries) || (type === "movie" && !isSeries)) {
          return url;
        }
      }
    }

    // Fuzzy match using Levenshtein distance (threshold < 5)
    const candidates = [];
    $('a[oldtitle]').each((_, el) => {
      const title = ($(el).attr("oldtitle") || "").trim();
      const href = $(el).attr("href") || "";
      if (!title || !href) return;

      const url = absoluteUrl(href, this.baseUrl);
      const isSeries = /\/series\//i.test(url);

      // Filter by type
      if (!((type === "series" && isSeries) || (type === "movie" && !isSeries))) return;

      // Check Levenshtein distance for each keyword
      for (const keyword of keywords) {
        const distance = levenshteinDistance(title, keyword);
        if (distance < 5) {
          candidates.push({ url, distance });
          break;
        }
      }
    });

    // Return the best match (lowest distance)
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0]?.url || null;
  }

  /**
   * Fetch episode URL for series.
   * Based on WebStreamrMBG reference implementation.
   */
  async fetchEpisodeUrl(pageUrl, season, episode) {
    const html = await fetchText(pageUrl, { headers: { Referer: `${this.baseUrl}/` } }).catch(() => "");
    if (!html) return null;

    const $ = cheerio.load(html);
    const targetSlug = `-temporada-${season}-capitulo-${episode}`;

    // Look for links ending with the episode slug
    const href = $('#seasons a').toArray()
      .map(el => $(el).attr("href") || "")
      .find(h => h.endsWith(targetSlug));

    return href ? absoluteUrl(href, this.baseUrl) : null;
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

    const streams = await this.getStreamsFromExternalId({ type, externalId });
    debug.streamCount = streams.length;
    debug.streams = streams;
    debug.status = streams.length ? "ok" : "no_streams";
    return debug;
  }
}
