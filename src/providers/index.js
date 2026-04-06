import { parseStremioId } from "../lib/ids.js";
import { analyzeScoredStreams, scoreAndSelectStreams } from "../lib/stream-scoring.js";
import { AnimeAv1Provider } from "./animeav1.js";
import { CinecalidadProvider } from "./cinecalidad.js";
import { CineHdPlusProvider } from "./cinehdplus.js";
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
import { VerHdLinkProvider } from "./verhdlink.js";
import { VerSeriesOnlineProvider } from "./verseriesonline.js";

const baseProviders = [
  new AnimeAv1Provider(),
  new GnulaProvider(),
  new CinecalidadProvider(),
  new NetMirrorProvider(),
  new CastleProvider(),
  new CuevanaProvider(),
  new HomeCineProvider(),
  new TioPlusProvider(),
  new VerHdLinkProvider(),
  new CineHdPlusProvider(),
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

export function getProviderByCatalog(catalogId) {
  if (catalogId.startsWith("gnula-")) {
    return providers.find((provider) => provider.id === "gnula") ?? null;
  }

  if (catalogId.startsWith("animeav1-")) {
    return providers.find((provider) => provider.id === "animeav1") ?? null;
  }

  if (catalogId.startsWith("cinecalidad-")) {
    return providers.find((provider) => provider.id === "cinecalidad") ?? null;
  }

  if (catalogId.startsWith("mhdflix-")) {
    return providers.find((provider) => provider.id === "mhdflix") ?? null;
  }

  if (catalogId.startsWith("lamovie-")) {
    return providers.find((provider) => provider.id === "lamovie") ?? null;
  }

  if (catalogId.startsWith("verseriesonline-")) {
    return providers.find((provider) => provider.id === "verseriesonline") ?? null;
  }

  if (catalogId.startsWith("cineplus123-")) {
    return providers.find((provider) => provider.id === "cineplus123") ?? null;
  }

  if (catalogId.startsWith("serieskao-")) {
    return providers.find((provider) => provider.id === "serieskao") ?? null;
  }

  if (catalogId.startsWith("seriesmetro-")) {
    return providers.find((provider) => provider.id === "seriesmetro") ?? null;
  }

  return null;
}

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
  const collected = [];
  const settled = await Promise.all(
    providers.map((provider) =>
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

  if (streamSelectionMode === "per_provider") {
    return collected.map((stream) => {
      const { _providerId, ...rest } = stream;
      return rest;
    });
  }

  return scoreAndSelectStreams("global", collected);
}

export async function debugStreamsFromExternalId(type, id) {
  const collected = [];
  const settled = await Promise.all(
    providers.map((provider) =>
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

  const globalScoredStreams = analyzeScoredStreams("global", collected).map((item) => ({
    title: item.stream.title,
    url: item.stream.url || null,
    providerId: item.stream._providerId || null,
    sourceKey: item.sourceKey,
    sourceLabel: item.sourceLabel,
    score: item.score,
    components: item.components
  }));
  const globalSelectedStreams = scoreAndSelectStreams("global", collected);

  return {
    results,
    selectionMode: streamSelectionMode,
    providerTimeoutMs,
    providerDebugTimeoutMs,
    globalScoredStreams,
    globalSelectedStreams
  };
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
