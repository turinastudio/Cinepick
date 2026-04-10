import { parseStremioId } from "../../../lib/ids.js";
import { analyzeScoredStreams, scoreAndSelectStreams } from "../scoring.js";
import { streamResultCache } from "../../../shared/cache.js";
import requestContextShared from "../../../config/request-context.cjs";
import { LaCartoonsProvider } from "./lacartoons.js";
import { CinecalidadProvider } from "./cinecalidad.js";
import { Cineplus123Provider } from "./cineplus123.js";
import { CastleProvider } from "./castle.js";
import { CuevanaProvider } from "./cuevana.js";
import { GnulaProvider } from "./gnula.js";
import { HomeCineProvider } from "./homecine.js";
import { LaMovieProvider } from "./lamovie.js";
import { MhdflixProvider } from "./mhdflix.js";
import { NetMirrorProvider } from "./netmirror.js";
import { SeriesMetroProvider } from "./seriesmetro.js";
import { SerieskaoProvider } from "./serieskao.js";
import { TioPlusProvider } from "./tioplus.js";
import { VerSeriesOnlineProvider } from "./verseriesonline.js";

export const providers = [
  new LaCartoonsProvider(),
  new GnulaProvider(),
  new CinecalidadProvider(),
  new NetMirrorProvider(),
  new CastleProvider(),
  new CuevanaProvider(),
  new HomeCineProvider(),
  new TioPlusProvider(),
  new MhdflixProvider(),
  new SeriesMetroProvider(),
  new VerSeriesOnlineProvider(),
  new Cineplus123Provider(),
  new LaMovieProvider(),
  new SerieskaoProvider()
];
const { getSelectionMode, isProviderEnabled } = requestContextShared;
const activeProviderFilter = String(
  process.env.ACTIVE_PROVIDERS ||
  process.env.ENABLED_PROVIDERS ||
  ""
)
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const availableProviders = activeProviderFilter.length > 0
  ? providers.filter((provider) => activeProviderFilter.includes(provider.id))
  : providers;
const providerTimeoutMs = Math.max(1000, Number(process.env.PROVIDER_TIMEOUT_MS || 12000) || 12000);
const providerDebugTimeoutMs = Math.max(providerTimeoutMs, Number(process.env.PROVIDER_DEBUG_TIMEOUT_MS || 18000) || 18000);

function getActiveProviders() {
  return availableProviders.filter((provider) => isProviderEnabled("general", provider.id));
}

export function getProviderById(providerId) {
  return getActiveProviders().find((provider) => provider.id === providerId) ?? null;
}

export function getAllProviders() {
  return [...providers];
}

export function getAvailableProviders() {
  return [...availableProviders];
}

export function resolveProviderFromMetaId(id) {
  const parsed = parseStremioId(id);

  if (!parsed) {
    return null;
  }

  const provider = getProviderById(parsed.providerId);

  if (!provider) {
    return null;
  }

  return {
    provider,
    type: parsed.type,
    slug: parsed.slug
  };
}

export async function resolveStreamsFromExternalId(type, id) {
  const cacheKey = `streams:general:${type}:${id}`;
  const cached = streamResultCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const providers = getActiveProviders();
  const routing = buildDefaultRouting(type, id);
  const collected = await collectStreamsFromProviders(providers, type, id);
  const streamSelectionMode = getSelectionMode(String(process.env.STREAM_SELECTION_MODE || "global"));

  let result;
  if (streamSelectionMode === "off") {
    result = collected.map((stream) => {
      const { _providerId, ...rest } = stream;
      return rest;
    });
  } else if (streamSelectionMode === "per_provider") {
    result = collected.map((stream) => {
      const { _providerId, ...rest } = stream;
      return rest;
    });
  } else {
    result = scoreAndSelectStreams("global", collected, {
      contentKind: routing.kind
    });
  }

  // Only cache when we got actual results.
  if (result.length > 0) {
    streamResultCache.set(cacheKey, result);
  }

  return result;
}

export async function debugStreamsFromExternalId(type, id) {
  const routing = buildDefaultRouting(type, id);
  const providers = getActiveProviders();
  const run = await debugProviders(providers, type, id);
  const results = [...run.results];
  const collected = [...run.collected];
  const usedFallback = false;
  const streamSelectionMode = getSelectionMode(String(process.env.STREAM_SELECTION_MODE || "global"));

  const globalScoredStreams = analyzeScoredStreams("global", collected, {
    contentKind: routing.kind
  }).map((item) => ({
    title: item.stream.title,
    url: item.stream.url || null,
    providerId: item.stream._providerId || null,
    sourceKey: item.sourceKey,
    sourceLabel: item.sourceLabel,
    score: item.score,
    components: item.components
  }));
  const globalSelectedStreams = scoreAndSelectStreams("global", collected, {
    contentKind: routing.kind
  });

  return {
    routing,
    usedFallback,
    primaryProviders: providers.map((provider) => provider.id),
    fallbackProviders: [],
    results,
    selectionMode: streamSelectionMode,
    providerTimeoutMs,
    providerDebugTimeoutMs,
    globalScoredStreams,
    globalSelectedStreams
  };
}

function buildDefaultRouting(type, externalId) {
  return {
    type,
    externalId,
    kind: "general",
    confidence: "high",
    reasons: {
      mode: "general_only"
    },
    resolved: {
      imdbId: String(externalId || "").startsWith("tt") ? String(externalId).split(":")[0] : null,
      tmdbId: String(externalId || "").startsWith("tmdb:") ? String(externalId).replace(/^tmdb:/, "").split(":")[0] : null
    }
  };
}

async function collectStreamsFromProviders(targetProviders, type, id) {
  const collected = [];
  const settled = await Promise.all(
    targetProviders.map((provider) =>
      withTimeout(
        provider.getStreamsFromExternalId({ type, externalId: id }),
        providerTimeoutMs,
        provider.id,
        type,
        id,
        "streams"
      )
    )
  );

  for (const item of settled) {
    if (!item.ok) {
      console.warn(`[streams] ${item.providerId} fallo para ${type}:${id}: ${item.error}`);
      continue;
    }

    const streams = Array.isArray(item.value) ? item.value : [];
    if (streams.length > 0) {
      collected.push(
        ...streams.map((stream) => ({
          ...stream,
          _providerId: item.providerId
        }))
      );
    }
  }

  return collected;
}

async function debugProviders(targetProviders, type, id) {
  const collected = [];
  const settled = await Promise.all(
    targetProviders.map((provider) =>
      withTimeout(
        provider.debugStreamsFromExternalId({ type, externalId: id }),
        providerDebugTimeoutMs,
        provider.id,
        type,
        id,
        "debug"
      )
    )
  );

  const results = settled.map((item) => {
    if (!item.ok) {
      return {
        provider: item.providerId,
        type,
        externalId: id,
        status: item.timeout ? "timeout" : "error",
        error: item.error
      };
    }

    const debug = item.value;
    if (Array.isArray(debug?.streams) && debug.streams.length > 0) {
      collected.push(
        ...debug.streams.map((stream) => ({
          ...stream,
          _providerId: item.providerId
        }))
      );
    }
    return debug;
  });

  return { results, collected };
}

export async function debugProviderStreamsFromExternalId(providerId, type, id) {
  const provider = getProviderById(providerId);

  if (!provider) {
    return {
      provider: providerId,
      type,
      externalId: id,
      status: "provider_not_found"
    };
  }

  const item = await withTimeout(
    provider.debugStreamsFromExternalId({ type, externalId: id }),
    providerDebugTimeoutMs,
    provider.id,
    type,
    id,
    "debug"
  );

  if (!item.ok) {
    return {
      provider: item.providerId,
      type,
      externalId: id,
      status: item.timeout ? "timeout" : "error",
      error: item.error
    };
  }

  return item.value;
}

async function withTimeout(promise, timeoutMs, providerId, type, id, mode) {
  let timeoutHandle = null;

  try {
    const value = await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${mode} timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);

    return {
      ok: true,
      providerId,
      value
    };
  } catch (error) {
    return {
      ok: false,
      providerId,
      timeout: /timeout/i.test(error?.message || ""),
      error: error instanceof Error ? error.message : String(error),
      type,
      externalId: id
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
