import { fetchJson } from "../lib/webstreamer/http.js";
import { buildYearFromMeta, parseExternalStremioId, stripTags } from "../lib/webstreamer/common.js";
import { scoreAndSelectStreams } from "../lib/stream-scoring.js";
import { Provider } from "./base.js";

function tokenizeTitle(value) {
  return stripTags(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

export class WebstreamBaseProvider extends Provider {
  constructor(config) {
    super(config);
    this.tmdbApiKey = process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c";
  }

  parseExternalStremioId(type, externalId) {
    return parseExternalStremioId(type, externalId);
  }

  async fetchCinemetaMeta(type, externalId) {
    const payload = await fetchJson(
      `https://v3-cinemeta.strem.io/meta/${type}/${externalId}.json`
    ).catch(() => null);

    return payload?.meta || null;
  }

  async fetchTmdbSearchTitles(type, externalId) {
    const mediaType = type === "series" ? "tv" : "movie";
    const payload = await fetchJson(
      `https://api.themoviedb.org/3/find/${externalId}?api_key=${this.tmdbApiKey}&external_source=imdb_id&language=es-ES`
    ).catch(() => null);

    if (!payload) {
      return [];
    }

    const results = mediaType === "tv" ? payload.tv_results : payload.movie_results;
    const item = Array.isArray(results) ? results[0] : null;
    if (!item) {
      return [];
    }

    const values = [
      item.title,
      item.name,
      item.original_title,
      item.original_name
    ];

    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  }

  buildSearchQueries(externalMeta, extraTitles = []) {
    const queries = [];
    const title = String(externalMeta?.name || "").trim();
    if (title) {
      queries.push(title);
      const stripped = title.replace(/^(the|a|an)\s+/i, "").trim();
      if (stripped && stripped !== title) {
        queries.push(stripped);
      }
    }

    for (const extraTitle of extraTitles) {
      const titleValue = String(extraTitle || "").trim();
      if (!titleValue) {
        continue;
      }

      queries.push(titleValue);
      const stripped = titleValue.replace(/^(the|a|an)\s+/i, "").trim();
      if (stripped && stripped !== titleValue) {
        queries.push(stripped);
      }
    }

    return [...new Set(queries.filter(Boolean))];
  }

  async searchWithFallbackQueries({ type, externalMeta }) {
    const extraTitles = await this.fetchTmdbSearchTitles(type, externalMeta.id || "").catch(() => []);
    externalMeta._searchTitles = extraTitles;
    const items = [];

    for (const query of this.buildSearchQueries(externalMeta, extraTitles)) {
      const results = await this.search({ type, query }).catch(() => []);
      if (results.length > 0) {
        items.push(...results);
      }
    }

    return this.dedupeById(items);
  }

  pickBestCandidate(candidates, externalMeta) {
    const searchTitles = this.buildSearchQueries(externalMeta, externalMeta?._searchTitles || []);
    const expectedYear = buildYearFromMeta(externalMeta);
    let best = null;

    for (const candidate of candidates) {
      const name = String(candidate?.name || "").trim().toLowerCase();
      const year = String(candidate?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
      const nameTokens = tokenizeTitle(name);
      let score = 0;

      for (const rawTarget of searchTitles) {
        const target = String(rawTarget || "").trim().toLowerCase();
        const targetTokens = tokenizeTitle(target);
        let localScore = 0;

        if (name === target) {
          localScore += 12;
        } else if (targetTokens.length > 1 && (name.includes(target) || target.includes(name))) {
          localScore += 7;
        }

        localScore += Math.min(targetTokens.filter((token) => nameTokens.includes(token)).length, 4);

        if (targetTokens.length === 1 && targetTokens[0] && !nameTokens.includes(targetTokens[0])) {
          localScore -= 8;
        }

        if (targetTokens.length > 0 && nameTokens.length > targetTokens.length + 2) {
          localScore -= 2;
        }

        score = Math.max(score, localScore);
      }

      if (expectedYear && year) {
        score += expectedYear === year ? 4 : -3;
      }

      if (!best || score > best.score) {
        best = { candidate, score };
      }
    }

    return best && best.score >= 5 ? best.candidate : null;
  }

  sortStreams(streams) {
    return scoreAndSelectStreams(this.id, streams, {
      cleanTitle: (title) => this.cleanStreamTitle(title)
    });
  }

  cleanStreamTitle(title) {
    return String(title || "").replace(/\s+/g, " ").trim();
  }

  dedupeById(items) {
    return Array.from(new Map(items.map((item) => [item.id, item])).values());
  }
}
