import { buildStremioId } from "../lib/ids.js";
import {
  absoluteUrl,
  buildSearchTerms,
  mapSearchItem,
  stripTags
} from "../lib/webstreamer/common.js";
import { fetchPage, fetchText } from "../lib/webstreamer/http.js";
import { resolveWebstreamCandidates } from "../lib/webstreamer/resolve.js";
import { WebstreamBaseProvider } from "./webstreambase.js";

const DEFAULT_HEADERS = {
  Referer: "https://www3.seriesmetro.net/",
  "Content-Type": "application/x-www-form-urlencoded"
};

const LANGUAGE_PRIORITY = ["latino", "lat", "castellano", "espanol", "espaol", "vose", "sub", "subtitulado"];
const LANGUAGE_MAP = {
  latino: "LAT",
  lat: "LAT",
  castellano: "CAST",
  espanol: "CAST",
  espaol: "CAST",
  vose: "SUB",
  sub: "SUB",
  subtitulado: "SUB"
};

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanText(value) {
  return stripTags(value)
    .replace(/\s+/g, " ")
    .trim();
}

export class SeriesMetroProvider extends WebstreamBaseProvider {
  constructor() {
    super({
      id: "seriesmetro",
      name: "SeriesMetro",
      supportedTypes: ["movie", "series"]
    });

    this.baseUrl = process.env.SERIESMETRO_BASE_URL || "https://www3.seriesmetro.net";
  }

  async search({ type, query }) {
    const directMatches = await this.probeCandidates(type, buildSearchTerms(query));
    return directMatches;
  }

  async getMeta({ type, slug }) {
    const path = this.decodePathToken(slug);
    const pageUrl = absoluteUrl(path, this.baseUrl);
    const html = await fetchText(pageUrl).catch(() => "");
    const title = this.extractTitle(html) || this.unslugify(path);

    let videos = [];
    if (type === "series") {
      videos = await this.buildEpisodeVideos(pageUrl, html);
    }

    return {
      id: buildStremioId(this.id, type, slug),
      type,
      name: title,
      poster: null,
      background: null,
      description: "",
      genres: [],
      cast: [],
      videos
    };
  }

  async getStreams({ type, slug }) {
    const path = this.decodePathToken(slug);
    const pageUrl = absoluteUrl(path, this.baseUrl);
    const pageHtml = await fetchText(pageUrl).catch(() => "");

    if (!pageHtml) {
      return [];
    }

    const rawCandidates = await this.extractRawCandidates(pageUrl, pageHtml, pageUrl);
    const streams = await resolveWebstreamCandidates(this.id, rawCandidates);
    return this.selectPreferredLanguageStreams(
      this.sortStreams(this.attachDisplayTitle(streams, this.extractTitle(pageHtml) || this.unslugify(path)))
    );
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

    let path = this.decodePathToken(bestMatch.id.split(":").slice(2).join(":"));
    let pageUrl = absoluteUrl(path, this.baseUrl);
    let pageHtml = await fetchText(pageUrl).catch(() => "");

    if (!pageHtml) {
      return [];
    }

    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const episodeUrl = await this.resolveEpisodeUrl(
        pageUrl,
        pageHtml,
        parsedExternal.season,
        parsedExternal.episode
      );

      if (!episodeUrl) {
        return [];
      }

      pageUrl = episodeUrl;
      pageHtml = await fetchText(pageUrl).catch(() => "");
      if (!pageHtml) {
        return [];
      }
    }

    const rawCandidates = await this.extractRawCandidates(pageUrl, pageHtml, pageUrl);
    const streams = await resolveWebstreamCandidates(this.id, rawCandidates);
    return this.selectPreferredLanguageStreams(
      this.sortStreams(this.attachDisplayTitle(streams, this.extractTitle(pageHtml) || this.unslugify(path)))
    );
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
      debug.status = "no_best_match";
      return debug;
    }

    let path = this.decodePathToken(bestMatch.id.split(":").slice(2).join(":"));
    let pageUrl = absoluteUrl(path, this.baseUrl);
    let pageHtml = await fetchText(pageUrl).catch(() => "");
    debug.targetUrl = pageUrl;

    if (!pageHtml) {
      debug.status = "missing_page";
      return debug;
    }

    if (type === "series" && parsedExternal.season && parsedExternal.episode) {
      const episodeUrl = await this.resolveEpisodeUrl(
        pageUrl,
        pageHtml,
        parsedExternal.season,
        parsedExternal.episode
      );
      debug.episodeTargetUrl = episodeUrl || null;

      if (!episodeUrl) {
        debug.status = "no_matching_episode";
        return debug;
      }

      pageUrl = episodeUrl;
      pageHtml = await fetchText(pageUrl).catch(() => "");
      debug.targetUrl = pageUrl;

      if (!pageHtml) {
        debug.status = "missing_episode_page";
        return debug;
      }
    }

    const rawCandidates = await this.extractRawCandidates(pageUrl, pageHtml, pageUrl);
    const streams = await resolveWebstreamCandidates(this.id, rawCandidates);
    const selected = this.selectPreferredLanguageStreams(this.sortStreams(streams));

    debug.rawCandidateCount = rawCandidates.length;
    debug.rawCandidateSample = rawCandidates.slice(0, 10).map((item) => item.url);
    debug.streamCount = selected.length;
    debug.streams = selected.map((stream) => ({
      name: stream.name,
      title: stream.title,
      url: stream.url || null,
      behaviorHints: stream.behaviorHints || null
    }));
    debug.status = selected.length > 0 ? "ok" : "no_streams";

    return debug;
  }

  async searchWithFallbackQueries({ type, externalMeta }) {
    const extraTitles = await this.fetchTmdbSearchTitles(type, externalMeta.id || "").catch(() => []);
    const queries = this.buildSearchQueries(externalMeta, extraTitles);
    return this.probeCandidates(type, queries, externalMeta);
  }

  async probeCandidates(type, queries, externalMeta = null) {
    const category = type === "movie" ? "pelicula" : "serie";
    const year = this.extractYear(externalMeta?.releaseInfo || externalMeta?.year || "");
    const items = [];

    for (const query of queries) {
      const slugBase = slugify(query);
      if (!slugBase) {
        continue;
      }

      const slugCandidates = new Set([slugBase]);
      if (year) {
        slugCandidates.add(`${slugBase}-${year}`);
      }

      for (const slug of slugCandidates) {
        const path = `/${category}/${slug}/`;
        const url = `${this.baseUrl}${path}`;
        const html = await fetchText(url).catch(() => "");
        if (!html || !(html.includes("trembed=") || html.includes("data-post="))) {
          continue;
        }

        items.push(
          mapSearchItem(
            this.id,
            type,
            this.encodePathToken(path),
            this.extractTitle(html) || this.unslugify(slug),
            year
          )
        );
      }
    }

    return this.dedupeById(items);
  }

  async buildEpisodeVideos(seriesUrl, seriesHtml) {
    const postId = this.extractPostId(seriesHtml);
    if (!postId) {
      return [];
    }

    const seasonNumbers = this.extractSeasonNumbers(seriesHtml);
    const videos = [];

    for (const seasonNumber of seasonNumbers) {
      const seasonHtmlChunk = await this.fetchSeasonHtml(postId, seasonNumber, seriesUrl).catch(() => "");
      if (!seasonHtmlChunk) {
        continue;
      }

      for (const match of seasonHtmlChunk.matchAll(/href="([^"]+\/capitulo\/[^"]+)"/gi)) {
        const episodeUrl = absoluteUrl(match[1], this.baseUrl);
        if (!episodeUrl) {
          continue;
        }

        const parsed = episodeUrl.match(/temporada-(\d+)-capitulo-(\d+)/i);
        if (!parsed) {
          continue;
        }

        const episodeSeason = Number(parsed[1]) || seasonNumber;
        const episodeNumber = Number(parsed[2]) || 0;
        videos.push({
          id: buildStremioId(
            this.id,
            "series",
            this.encodePathToken(new URL(episodeUrl).pathname)
          ),
          title: `Temporada ${episodeSeason} - Capitulo ${episodeNumber}`,
          season: episodeSeason,
          episode: episodeNumber
        });
      }
    }

    return this.dedupeEpisodeVideos(videos);
  }

  async resolveEpisodeUrl(seriesUrl, seriesHtml, season, episode) {
    const postId = this.extractPostId(seriesHtml);
    if (!postId) {
      return null;
    }

    const seasonHtml = await this.fetchSeasonHtml(postId, season, seriesUrl).catch(() => "");
    if (!seasonHtml) {
      return null;
    }

    const episodeUrls = Array.from(
      seasonHtml.matchAll(/href="([^"]+\/capitulo\/[^"]+)"/gi),
      (match) => absoluteUrl(match[1], this.baseUrl)
    ).filter(Boolean);

    return episodeUrls.find((url) => {
      const parsed = url.match(/temporada-(\d+)-capitulo-(\d+)/i);
      return parsed && Number(parsed[1]) === Number(season) && Number(parsed[2]) === Number(episode);
    }) || null;
  }

  async fetchSeasonHtml(postId, season, referer) {
    const body = new URLSearchParams({
      action: "action_select_season",
      post: String(postId),
      season: String(season)
    }).toString();

    const page = await fetchPage(`${this.baseUrl}/wp-admin/admin-ajax.php`, {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        Referer: referer || `${this.baseUrl}/`
      },
      body
    });

    return page.text;
  }

  async extractRawCandidates(pageUrl, pageHtml, referer) {
    const options = Array.from(
      pageHtml.matchAll(/href="#options-(\d+)"[^>]*>[\s\S]*?<span class="server">([\s\S]*?)<\/span>/gi)
    );
    const tridMatch = pageHtml.match(/\?trembed=(\d+)(?:&#038;|&)trid=(\d+)(?:&#038;|&)trtype=(\d+)/i);

    if (!options.length || !tridMatch) {
      return [];
    }

    const trid = tridMatch[2];
    const trtype = tridMatch[3];
    const sortedOptions = options
      .map((match) => {
        const index = match[1];
        const serverText = cleanText(match[2]);
        const langRaw = slugify(serverText.split("-").pop() || serverText).replace(/-/g, "");
        const langRank = LANGUAGE_PRIORITY.indexOf(langRaw);
        return {
          index,
          serverText,
          languageCode: LANGUAGE_MAP[langRaw] || "",
          rank: langRank === -1 ? 99 : langRank
        };
      })
      .sort((left, right) => left.rank - right.rank);

    const rawCandidates = [];

    for (const option of sortedOptions) {
      const embedPage = await fetchText(
        `${this.baseUrl}/?trembed=${option.index}&trid=${trid}&trtype=${trtype}`,
        {
          headers: {
            Referer: referer || pageUrl
          }
        }
      ).catch(() => "");

      if (!embedPage) {
        continue;
      }

      const fastreamUrl = embedPage.match(/<iframe[^>]*src="(https?:\/\/fastream\.to\/[^"]+)"/i)?.[1];
      if (!fastreamUrl) {
        continue;
      }

      rawCandidates.push({
        source: "SeriesMetro",
        label: `[${option.languageCode || "UNK"}] ${option.serverText || "Fastream"}`,
        url: fastreamUrl
      });

      if (option.languageCode === "LAT") {
        break;
      }
    }

    return this.dedupeRawCandidates(rawCandidates);
  }

  selectPreferredLanguageStreams(streams) {
    const latino = streams.filter((stream) => /\bLAT\b/i.test(String(stream.title || "")));
    return latino.length > 0 ? latino : streams;
  }

  dedupeRawCandidates(items) {
    return Array.from(new Map(items.map((item) => [item.url, item])).values());
  }

  dedupeEpisodeVideos(items) {
    return Array.from(new Map(items.map((item) => [`${item.season}:${item.episode}`, item])).values());
  }

  encodePathToken(path) {
    return Buffer.from(String(path || ""), "utf-8").toString("base64url");
  }

  decodePathToken(value) {
    try {
      return Buffer.from(String(value || ""), "base64url").toString("utf-8");
    } catch {
      return String(value || "");
    }
  }

  extractPostId(html) {
    return html.match(/data-post="(\d+)"/i)?.[1] || "";
  }

  extractSeasonNumbers(html) {
    const matches = Array.from(
      html.matchAll(/temporada-(\d+)/gi),
      (match) => Number(match[1]) || 0
    ).filter(Boolean);

    return [...new Set(matches)].sort((a, b) => a - b).slice(0, 30).length
      ? [...new Set(matches)].sort((a, b) => a - b).slice(0, 30)
      : [1];
  }

  extractTitle(html) {
    return cleanText(
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<title>([^<]+)<\/title>/i)?.[1]
      || ""
    ).replace(/\|\s*SeriesMetro.*$/i, "").trim();
  }

  unslugify(path) {
    return String(path || "")
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "";
  }

  extractYear(value) {
    return String(value || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
  }
}
