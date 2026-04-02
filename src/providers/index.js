import { parseStremioId } from "../lib/ids.js";
import { analyzeScoredStreams, scoreAndSelectStreams } from "../lib/stream-scoring.js";
import { CinecalidadProvider } from "./cinecalidad.js";
import { Cineplus123Provider } from "./cineplus123.js";
import { GnulaProvider } from "./gnula.js";
import { MhdflixProvider } from "./mhdflix.js";
import { VerSeriesOnlineProvider } from "./verseriesonline.js";

const providers = [new GnulaProvider(), new CinecalidadProvider(), new MhdflixProvider(), new VerSeriesOnlineProvider(), new Cineplus123Provider()];
const streamSelectionMode = String(process.env.STREAM_SELECTION_MODE || "global").trim().toLowerCase();

export function getProviderByCatalog(catalogId) {
  if (catalogId.startsWith("gnula-")) {
    return providers.find((provider) => provider.id === "gnula") ?? null;
  }

  if (catalogId.startsWith("cinecalidad-")) {
    return providers.find((provider) => provider.id === "cinecalidad") ?? null;
  }

  if (catalogId.startsWith("mhdflix-")) {
    return providers.find((provider) => provider.id === "mhdflix") ?? null;
  }

  if (catalogId.startsWith("verseriesonline-")) {
    return providers.find((provider) => provider.id === "verseriesonline") ?? null;
  }

  if (catalogId.startsWith("cineplus123-")) {
    return providers.find((provider) => provider.id === "cineplus123") ?? null;
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

  for (const provider of providers) {
    const streams = await provider.getStreamsFromExternalId({ type, externalId: id });

    if (streams?.length) {
      collected.push(
        ...streams.map((stream) => ({
          ...stream,
          _providerId: provider.id
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
  const results = [];
  const collected = [];

  for (const provider of providers) {
    const debug = await provider.debugStreamsFromExternalId({ type, externalId: id });
    if (debug) {
      results.push(debug);
      if (Array.isArray(debug.streams) && debug.streams.length > 0) {
        collected.push(
          ...debug.streams.map((stream) => ({
            ...stream,
            _providerId: provider.id
          }))
        );
      }
    }
  }

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
    globalScoredStreams,
    globalSelectedStreams
  };
}
