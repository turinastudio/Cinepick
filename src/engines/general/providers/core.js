import { parseStremioId } from "../../../lib/ids.js";
import { analyzeScoredStreams, scoreAndSelectStreams } from "../scoring.js";
import { LaCartoonsProvider } from "../../../providers/lacartoons.js";
import { CinecalidadProvider } from "../../../providers/cinecalidad.js";
import { Cineplus123Provider } from "../../../providers/cineplus123.js";
import { CastleProvider } from "../../../providers/castle.js";
import { CuevanaProvider } from "../../../providers/cuevana.js";
import { GnulaProvider } from "../../../providers/gnula.js";
import { HomeCineProvider } from "../../../providers/homecine.js";
import { LaMovieProvider } from "../../../providers/lamovie.js";
import { MhdflixProvider } from "../../../providers/mhdflix.js";
import { NetMirrorProvider } from "../../../providers/netmirror.js";
import { SeriesMetroProvider } from "../../../providers/seriesmetro.js";
import { SerieskaoProvider } from "../../../providers/serieskao.js";
import { TioPlusProvider } from "../../../providers/tioplus.js";
import { VerSeriesOnlineProvider } from "../../../providers/verseriesonline.js";

const baseProviders = [
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
const activeProviderFilter = String(
  process.env.ACTIVE_PROVIDERS ||
  process.env.ENABLED_PROVIDERS ||
  ""
)
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const providers = activeProviderFilter.length > 0
  ? baseProviders.filter((provider) => activeProviderFilter.includes(provider.id))
  : baseProviders;
const streamSelectionMode = String(process.env.STREAM_SELECTION_MODE || "global").trim().toLowerCase();
const providerTimeoutMs = Math.max(1000, Number(process.env.PROVIDER_TIMEOUT_MS || 12000) || 12000);
const providerDebugTimeoutMs = Math.max(providerTimeoutMs, Number(process.env.PROVIDER_DEBUG_TIMEOUT_MS || 18000) || 18000);

export function getProviderById(providerId) {
  return providers.find((provider) => provider.id === providerId) ?? null;
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
  const routing = buildDefaultRouting(type, id);
  const collected = await collectStreamsFromProviders(providers, type, id);

  if (streamSelectionMode === "per_provider") {
    return collected.map((stream) => {
      const { _providerId, ...rest } = stream;
      return rest;
    });
  }

  return scoreAndSelectStreams("global", collected, {
    contentKind: routing.kind
  });
}

export async function debugStreamsFromExternalId(type, id) {
  const routing = buildDefaultRouting(type, id);
  const run = await debugProviders(providers, type, id);
  const results = [...run.results];
  const collected = [...run.collected];
  const usedFallback = false;

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
