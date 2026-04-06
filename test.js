import { debugProviderStreamsFromExternalId, getProviderById } from "./src/providers/index.js";

const TMDB_API_KEY = process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c";

function normalizeType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "tv" || raw === "series" || raw === "serie") return "series";
  return "movie";
}

function isNullishArg(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || normalized === "null" || normalized === "x" || normalized === "-";
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} para ${url}`);
  }

  return response.json();
}

async function resolveImdbId(tmdbId, type) {
  const mediaType = type === "series" ? "tv" : "movie";

  if (mediaType === "movie") {
    const payload = await fetchJson(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`);
    return payload?.imdb_id || null;
  }

  const payload = await fetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
  return payload?.imdb_id || null;
}

function providerSupportsTmdbFallback(providerId) {
  return ["animeav1"].includes(String(providerId || "").trim().toLowerCase());
}

function buildExternalId(imdbId, type, season, episode) {
  if (type === "series" && season && episode) {
    return `${imdbId}:${season}:${episode}`;
  }

  return imdbId;
}

function printHeader(providerId, tmdbId, type, season, episode) {
  const seasonTag = type === "series" && season && episode
    ? ` | S${season}E${episode}`
    : "";

  console.log(`\nTesting ${providerId} provider...`);
  console.log(`TMDB: ${tmdbId} | Tipo: ${type}${seasonTag}\n`);
}

function normalizeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "advanced" ? "advanced" : "basic";
}

function printResult(result, mode = "basic") {
  if (!result) {
    console.log("ERROR: No hubo resultado\n");
    return;
  }

  if (result.status !== "ok") {
    console.log(`ERROR: ${result.status}${result.error ? `: ${result.error}` : ""}\n`);

    if (mode === "advanced") {
      if (result.externalMeta) {
        console.log(`externalMeta: ${JSON.stringify(result.externalMeta, null, 2)}`);
      }
      if (result.queries) {
        console.log(`queries: ${JSON.stringify(result.queries, null, 2)}`);
      }
      if (result.candidates) {
        console.log(`candidates: ${JSON.stringify(result.candidates, null, 2)}`);
      }
      if (result.bestMatch) {
        console.log(`bestMatch: ${JSON.stringify(result.bestMatch, null, 2)}`);
      }
      if (result.searchAttempts) {
        console.log(`searchAttempts: ${JSON.stringify(result.searchAttempts, null, 2)}`);
      }
      if (result.searchDiagnostics) {
        console.log(`searchDiagnostics: ${JSON.stringify(result.searchDiagnostics, null, 2)}`);
      }
      if (result.tmdbInfo) {
        console.log(`tmdbInfo: ${JSON.stringify(result.tmdbInfo, null, 2)}`);
      }
      if (result.players) {
        console.log(`players: ${JSON.stringify(result.players, null, 2)}`);
      }
      if (result.trackSummary) {
        console.log(`trackSummary: ${JSON.stringify(result.trackSummary, null, 2)}`);
      }
      if (result.subtitleLanguages) {
        console.log(`subtitleLanguages: ${JSON.stringify(result.subtitleLanguages, null, 2)}`);
      }
    }

    console.log("");
    return;
  }

  console.log(`OK: ${result.streamCount || result.streams?.length || 0} streams encontrados:\n`);

  (result.streams || []).forEach((stream, index) => {
    console.log(`[${index + 1}] ${stream.title || stream.name}`);
    console.log(`    URL: ${String(stream.url || "").slice(0, 120)}${String(stream.url || "").length > 120 ? "..." : ""}`);
    if (stream.behaviorHints) {
      console.log(`    Hints: ${JSON.stringify(stream.behaviorHints)}`);
    }
    console.log("");
  });

  if (mode === "advanced") {
    if (result.externalMeta) {
      console.log(`externalMeta: ${JSON.stringify(result.externalMeta, null, 2)}`);
    }
    if (result.queries) {
      console.log(`queries: ${JSON.stringify(result.queries, null, 2)}`);
    }
    if (result.bestMatch) {
      console.log(`bestMatch: ${JSON.stringify(result.bestMatch, null, 2)}`);
    }
    if (result.candidates) {
      console.log(`candidates: ${JSON.stringify(result.candidates, null, 2)}`);
    }
    if (result.players) {
      console.log(`players: ${JSON.stringify(result.players, null, 2)}`);
    }
    if (result.trackSummary) {
      console.log(`trackSummary: ${JSON.stringify(result.trackSummary, null, 2)}`);
    }
    if (result.subtitleLanguages) {
      console.log(`subtitleLanguages: ${JSON.stringify(result.subtitleLanguages, null, 2)}`);
    }
    console.log("");
  }
}

async function run() {
  const [, , tmdbId, rawType, rawSeason, rawEpisode, providerId, rawMode] = process.argv;

  if (!tmdbId || !rawType) {
    console.log("Uso:");
    console.log("  node test.js <tmdbId> <movie|tv> [season] [episode] [provider] [basic|advanced]");
    console.log("");
    console.log("Ejemplos:");
    console.log("  node test.js 550 movie null null cinecalidad");
    console.log("  node test.js 1396 tv 1 1 lamovie");
    console.log("  node test.js 1396 tv 1 1 netmirror advanced");
    process.exit(1);
  }

  const type = normalizeType(rawType);
  const season = isNullishArg(rawSeason) ? null : Number(rawSeason);
  const episode = isNullishArg(rawEpisode) ? null : Number(rawEpisode);
  const mode = normalizeMode(rawMode);
  const targetProviders = providerId
    ? [String(providerId).trim().toLowerCase()]
    : [];

  const providerIds = targetProviders.length > 0
    ? targetProviders
    : ["animeav1", "lamovie", "cinecalidad", "seriesmetro", "netmirror", "castle"];

  for (const id of providerIds) {
    const provider = getProviderById(id);
    if (!provider) {
      console.log(`ERROR: Provider no encontrado: ${id}\n`);
      continue;
    }

    const imdbId = await resolveImdbId(tmdbId, type).catch(() => null);
    const externalId = imdbId
      ? buildExternalId(imdbId, type, season, episode)
      : providerSupportsTmdbFallback(id)
        ? (type === "series" && season && episode ? `tmdb:${tmdbId}:${season}:${episode}` : `tmdb:${tmdbId}`)
        : null;

    if (!externalId) {
      console.log(`\nTesting ${id} provider...`);
      console.log(`TMDB: ${tmdbId} | Tipo: ${type}${type === "series" && season && episode ? ` | S${season}E${episode}` : ""}\n`);
      console.log(`ERROR: No se pudo resolver IMDb desde TMDB ${tmdbId}\n`);
      continue;
    }

    printHeader(id, tmdbId, type, season, episode);
    const result = await debugProviderStreamsFromExternalId(id, type, externalId);
    printResult(result, mode);
  }
}

run().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
