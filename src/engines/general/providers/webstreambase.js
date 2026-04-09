import { fetchJson } from "../../../lib/webstreamer/http.js";
import { buildYearFromMeta, parseExternalStremioId, stripTags } from "../../../lib/webstreamer/common.js";
import { scoreAndSelectStreams } from "../scoring.js";
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

    const itemId = item.id;
    if (itemId) {
      for (const language of ["es-MX", "es-ES", "en-US"]) {
        const details = await fetchJson(
          `https://api.themoviedb.org/3/${mediaType}/${itemId}?api_key=${this.tmdbApiKey}&language=${language}&append_to_response=alternative_titles,translations`
        ).catch(() => null);

        if (!details) {
          continue;
        }

        values.push(
          details.title,
          details.name,
          details.original_title,
          details.original_name
        );

        const alternativeTitles = Array.isArray(details.alternative_titles?.titles)
          ? details.alternative_titles.titles
          : Array.isArray(details.alternative_titles?.results)
            ? details.alternative_titles.results
            : [];

        for (const alternative of alternativeTitles) {
          values.push(alternative?.title, alternative?.name);
        }

        const translations = Array.isArray(details.translations?.translations)
          ? details.translations.translations
          : [];

        for (const translation of translations) {
          values.push(translation?.data?.title, translation?.data?.name);
        }
      }
    }

    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  }

  buildSearchQueries(externalMeta, extraTitles = []) {
    const queries = [];
    const candidateTitles = [
      externalMeta?.name,
      externalMeta?.originalTitle,
      ...(Array.isArray(externalMeta?.aliases) ? externalMeta.aliases : []),
      ...extraTitles
    ];

    for (const rawTitle of candidateTitles) {
      const titleValue = String(rawTitle || "").trim();
      if (!titleValue) {
        continue;
      }

      queries.push(titleValue);
      queries.push(titleValue.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim());
      queries.push(titleValue.split(":")[0].trim());
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
    let secondBest = null;

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
        secondBest = best;
        best = { candidate, score };
      } else if (!secondBest || score > secondBest.score) {
        secondBest = { candidate, score };
      }
    }

    if (!best) {
      return null;
    }

    if (best.score >= 5) {
      return best.candidate;
    }

    if (candidates.length === 1 && best.score >= 3) {
      return best.candidate;
    }

    const secondScore = secondBest?.score ?? Number.NEGATIVE_INFINITY;
    if (best.score >= 4 && best.score - secondScore >= 3) {
      return best.candidate;
    }

    return null;
  }

  sortStreams(streams) {
    return scoreAndSelectStreams(this.id, streams, {
      cleanTitle: (title) => this.cleanStreamTitle(title)
    });
  }

  attachDisplayTitle(streams, displayTitle) {
    const normalized = String(displayTitle || "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return streams;
    }

    return (Array.isArray(streams) ? streams : []).map((stream) => ({
      ...stream,
      _displayTitle: stream._displayTitle || normalized
    }));
  }

  cleanStreamTitle(title) {
    return String(title || "").replace(/\s+/g, " ").trim();
  }

  dedupeById(items) {
    return Array.from(new Map(items.map((item) => [item.id, item])).values());
  }
}
