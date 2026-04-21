import { animeEngine, generalEngine } from "../../engines/index.js";
import { json } from "../../lib/http.js";
import { appendSupportStream } from "../../lib/support-stream.js";
import { createDebugLogger } from "../../shared/debug.js";
import { validateStreamRequest, validateStremioType, validateProviderId, validateSearchQuery, validateSkip } from "../../lib/validators.js";
import { NotFoundError } from "../errors.js";

const animeDebugLog = createDebugLogger("anime-engine", () =>
  /^(1|true|yes)$/i.test(String(process.env.ANIME_ENGINE_DEBUG || "").trim())
);

function createMetaResponse(item) {
  return {
    meta: {
      id: item.id,
      type: item.type,
      name: item.name,
      poster: item.poster,
      background: item.background,
      description: item.description,
      genres: item.genres || [],
      cast: item.cast || [],
      videos: item.videos || []
    }
  };
}

function projectPublicStreams(streams) {
  const PUBLIC_STREAM_NAME = "Cinepick";

  return (Array.isArray(streams) ? streams : []).map((stream) => {
    if (!stream || typeof stream !== "object") {
      return stream;
    }

    const { _rawTitle, ...rest } = stream;
    return {
      ...rest,
      name: PUBLIC_STREAM_NAME
    };
  });
}

function absolutizeStreamUrls(req, streams) {
  const { getRequestOrigin } = arguments[2] || {};

  // Use getRequestOrigin if provided, otherwise derive from request
  let origin;
  if (getRequestOrigin) {
    origin = getRequestOrigin(req);
  } else {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const proto = forwardedProto || "http";
    const reqHost = req.headers.host || "127.0.0.1";
    origin = `${proto}://${reqHost}`;
  }

  return (Array.isArray(streams) ? streams : []).map((stream) => {
    if (!stream || typeof stream !== "object") {
      return stream;
    }

    const next = { ...stream };

    if (typeof next.url === "string" && next.url.startsWith("/")) {
      next.url = `${origin}${next.url}`;
    }

    if (typeof next.externalUrl === "string" && next.externalUrl.startsWith("/")) {
      next.externalUrl = `${origin}${next.externalUrl}`;
    }

    return next;
  });
}

function sanitizeDebugStreams(streams) {
  return (Array.isArray(streams) ? streams : []).map((stream) => {
    if (!stream || typeof stream !== "object") {
      return stream;
    }

    const { _rawTitle, ...rest } = stream;
    return rest;
  });
}

/**
 * Stream router: handles /stream, /meta, /catalog routes.
 */

export async function handleMeta(req, res, { requestConfig, animeEngineEnabled }) {
  const match = req.normalizedPathname.match(/^\/meta\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    return false; // Not this handler's responsibility
  }

  const [, rawType, rawId] = match;
  const decodedId = decodeURIComponent(rawId);

  // Direct route for explicit anime provider IDs
  const isAnimeId = /^(animeflv|animeav1|henaojara|tioanime|anilist|kitsu|mal|anidb):/i.test(decodedId);

  if (isAnimeId) {
    animeDebugLog("meta.request", {
      type: "anime",
      id: decodedId
    });
    const { payload } = await animeEngine.resolveMeta("anime", decodedId);
    animeDebugLog("meta.response", {
      type: "anime",
      id: decodedId,
      hasMeta: Boolean(payload?.meta),
      metaId: payload?.meta?.id || null,
      metaName: payload?.meta?.name || null
    });
    json(res, 200, createMetaResponse(payload.meta));
    return true;
  }

  const { type, id } = validateStreamRequest(rawType, decodedId);

  const animeDecision = await animeEngine.shouldUseAnimeEngine(type, id, {
    enabled: animeEngineEnabled && (requestConfig ? Boolean(requestConfig?.engines?.anime) : true)
  });

  animeDebugLog("meta.route", {
    type,
    id,
    ...animeDecision
  });

  if (animeDecision.useAnimeEngine) {
    animeDebugLog("meta.request", {
      type,
      id
    });
    const { payload } = await animeEngine.resolveMeta(type, id);
    animeDebugLog("meta.response", {
      type,
      id,
      hasMeta: Boolean(payload?.meta),
      metaId: payload?.meta?.id || null,
      metaName: payload?.meta?.name || null
    });
    json(res, 200, createMetaResponse(payload.meta));
    return true;
  }

  const general = await generalEngine.resolveMeta(type, id);
  json(res, 200, { meta: general.meta ? createMetaResponse(general.meta).meta : null });
  return true;
}

export async function handleStream(req, res, { requestConfig, animeEngineEnabled, getRequestOrigin }) {
  const match = req.normalizedPathname.match(/^\/stream\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    return false;
  }

  const [, rawType, rawId] = match;
  const decodedId = decodeURIComponent(rawId);

  // For anime provider IDs (animeflv:slug, tioanime:slug), bypass strict type validation
  // and let the anime engine detection handle it.
  const isAnimeId = /^(animeflv|animeav1|henaojara|tioanime|anilist|kitsu|mal|anidb):/i.test(decodedId);

  if (isAnimeId) {
    // Direct route to anime engine
    animeDebugLog("stream.request", {
      type: "anime",
      id: decodedId
    });
    const { payload } = await animeEngine.resolveStreams("anime", decodedId);
    animeDebugLog("stream.response", {
      type: "anime",
      id: decodedId,
      streamCount: Array.isArray(payload?.streams) ? payload.streams.length : 0,
      message: payload?.message || null
    });
    json(res, 200, {
      streams: projectPublicStreams(absolutizeStreamUrls(req, payload.streams || [], { getRequestOrigin }))
    });
    return true;
  }

  // General content: validate and use anime detection
  const { type, id } = validateStreamRequest(rawType, decodedId);

  const animeDecision = await animeEngine.shouldUseAnimeEngine(type, id, {
    enabled: animeEngineEnabled && (requestConfig ? Boolean(requestConfig?.engines?.anime) : true)
  });

  animeDebugLog("stream.route", {
    type,
    id,
    ...animeDecision
  });

  if (animeDecision.useAnimeEngine) {
    animeDebugLog("stream.request", {
      type,
      id
    });
    const { payload } = await animeEngine.resolveStreams(type, id);
    animeDebugLog("stream.response", {
      type,
      id,
      streamCount: Array.isArray(payload?.streams) ? payload.streams.length : 0,
      message: payload?.message || null
    });
    json(res, 200, {
      streams: projectPublicStreams(absolutizeStreamUrls(req, payload.streams || [], { getRequestOrigin }))
    });
    return true;
  }

  const general = await generalEngine.resolveStreams(type, id);
  const streams = Array.isArray(general.streams) ? general.streams : [];
  json(res, 200, {
    streams: projectPublicStreams(absolutizeStreamUrls(req, appendSupportStream(streams), { getRequestOrigin }))
  });
  return true;
}

export async function handleCatalog(req, res, { requestConfig, animeEngineEnabled }) {
  const match = req.normalizedPathname.match(/^\/catalog\/([^/]+)\/([^/]+)(?:\/([^/]+))?\.json$/);

  if (!match) {
    return false;
  }

  const [, rawType, rawId, extraArgs] = match;

  // Decode first, then validate. The catalog ID can contain '|' (e.g. animeflv|search).
  const decodedId = decodeURIComponent(rawId);

  // Only validate the ID for safety (no path traversal), not for Stremio type format.
  if (decodedId.includes("..") || decodedId.includes("\\") || decodedId.includes("\0")) {
    json(res, 200, { metas: [] });
    return true;
  }

  try {
    const extraParams = new URLSearchParams(extraArgs ? decodeURIComponent(extraArgs.replace(/\.json$/, "")) : "");
    const searchParam = extraParams.get("search") || null;
    let genresParam = extraParams.getAll("genre");
    genresParam = genresParam.length > 0 ? genresParam : null;
    const genreParam = genresParam?.[0] || null;
    const rawSkip = extraParams.get("skip");
    const skip = validateSkip(rawSkip);

    let metas = [];

    if (/^(serieskao|gnula)\|/i.test(decodedId)) {
      const catalog = await generalEngine.resolveCatalog(rawType, decodedId, {
        search: searchParam,
        skip,
        genre: genreParam
      });

      metas = Array.isArray(catalog?.metas) ? catalog.metas : [];
      res.setHeader("Cache-Control", "max-age=259200, stale-while-revalidate=86400, stale-if-error=259200");
      json(res, 200, { metas });
      return true;
    }

    if (!animeEngineEnabled || (requestConfig && !requestConfig?.engines?.anime)) {
      json(res, 200, { metas: [] });
      return true;
    }

    if (decodedId.startsWith("animeav1")) {
      const animeav1 = await import("../../engines/anime/runtime/providers/animeav1-client.js");
      const page = skip ? Math.floor(skip / 20) + 1 : undefined;
      const gottenItems = skip ? skip % 20 : undefined;
      metas = searchParam || genresParam
        ? await animeav1.searchAnimeAV1(searchParam, undefined, genresParam, page, gottenItems).catch(() => [])
        : await animeav1.getAnimeAV1AiringTitles().catch(() => []);
    } else if (decodedId.startsWith("animeflv")) {
      const animeflv = await import("../../engines/anime/runtime/providers/animeflv-client.js");
      const page = skip ? Math.floor(skip / 24) + 1 : undefined;
      const gottenItems = skip ? skip % 24 : undefined;
      metas = searchParam || genresParam
        ? await animeflv.searchAnimeFLV(searchParam, genresParam, undefined, page, gottenItems).catch(() => [])
        : await animeflv.getAnimeFLVAiringTitles().catch(() => []);
    } else if (decodedId.startsWith("henaojara")) {
      const henaojara = await import("../../engines/anime/runtime/providers/henaojara-client.js");
      const page = skip ? Math.floor(skip / 24) + 1 : undefined;
      const gottenItems = skip ? skip % 24 : undefined;
      metas = searchParam || genresParam
        ? await henaojara.searchHenaojara(searchParam, genresParam, undefined, page, gottenItems).catch(() => [])
        : await henaojara.getHenaojaraAiringTitles().catch(() => []);
    } else if (decodedId.startsWith("tioanime")) {
      const tioanime = await import("../../engines/anime/runtime/providers/tioanime-client.js");
      const page = skip ? Math.floor(skip / 24) + 1 : undefined;
      const gottenItems = skip ? skip % 24 : undefined;
      metas = searchParam || genresParam
        ? await tioanime.searchTioAnime(searchParam, genresParam, page, gottenItems).catch(() => [])
        : await tioanime.getTioAnimeAiringTitles().catch(() => []);
    }

    if (metas && metas.length > 0) {
      metas = metas.map((meta) => ({
        id: meta.slug ? `${decodedId.split("|")[0]}:${meta.slug}` : meta.id,
        type: meta.type || "anime",
        name: meta.title || meta.name,
        poster: meta.poster,
        description: meta.overview || meta.description,
        genres: meta.genres ? meta.genres.map((g) => g.charAt(0).toUpperCase() + g.slice(1)) : undefined
      }));
    }

    res.setHeader("Cache-Control", "max-age=259200, stale-while-revalidate=86400, stale-if-error=259200");
    json(res, 200, { metas: metas || [] });
    return true;
  } catch (err) {
    console.error(`[stream-router] handleCatalog error for ${rawType} ${decodedId}:`, err.message);
    json(res, 200, { metas: [] });
    return true;
  }
}

export async function handleDebug(req, res, { requestConfig, animeEngineEnabled }) {
  const match = req.normalizedPathname.match(/^\/_debug\/stream\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    return false;
  }

  const [, requestedType, rawId] = match;
  const decodedId = decodeURIComponent(rawId);

  const animeDecision = await animeEngine.shouldUseAnimeEngine(requestedType, decodedId, {
    enabled: animeEngineEnabled && (requestConfig ? Boolean(requestConfig?.engines?.anime) : true)
  });

  animeDebugLog("debug.route", {
    type: requestedType,
    id: decodedId,
    ...animeDecision
  });

  if (animeDecision.useAnimeEngine) {
    animeDebugLog("debug.request", {
      type: requestedType,
      id: decodedId
    });
    const { payload: debug } = await animeEngine.resolveDebug(requestedType, decodedId);
    animeDebugLog("debug.response", {
      type: requestedType,
      id: decodedId,
      mode: "anime",
      providerStreams: Array.isArray(debug?.providerStreams) ? debug.providerStreams.length : 0,
      combinedStreamCount: debug?.combinedStreamCount ?? null
    });
    json(res, 200, {
      mode: "anime",
      type: requestedType,
      id: decodedId,
      ...debug
    });
    return true;
  }

  const general = await generalEngine.resolveDebug(requestedType, decodedId);

  if (general.mode === "internal") {
    json(res, 200, {
      mode: "internal",
      provider: general.providerId,
      type: general.type,
      slug: general.slug,
      ...(general.debug || {})
    });
    return true;
  }

  const debug = general.debug;
  json(res, 200, {
    mode: "external",
    type: requestedType,
    id: decodedId,
    selectionMode: debug.selectionMode || "global",
    results: debug.results || [],
    globalScoredStreams: debug.globalScoredStreams || [],
    globalSelectedStreams: sanitizeDebugStreams(debug.globalSelectedStreams || [])
  });
  return true;
}

export async function handleProviderDebug(req, res, { requestConfig, animeEngineEnabled }) {
  const match = req.normalizedPathname.match(/^\/_debug\/provider\/([^/]+)\/stream\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    return false;
  }

  const [, rawProviderId, rawType, rawId] = match;
  const providerId = validateProviderId(rawProviderId);
  const { type, id } = validateStreamRequest(rawType, rawId);

  if (animeEngineEnabled && animeEngine.isProviderId(providerId)) {
    animeDebugLog("provider.debug.request", {
      providerId,
      type,
      id
    });
    const debug = await animeEngine.resolveProviderDebug(providerId, type, id);
    animeDebugLog("provider.debug.response", {
      providerId,
      type,
      id,
      status: debug?.status || null,
      streamCount: debug?.streamCount ?? null
    });
    json(res, 200, {
      mode: "anime_provider",
      provider: providerId,
      type,
      id,
      result: debug
    });
    return true;
  }

  const provider = generalEngine.getProviderById(providerId);

  if (!provider) {
    json(res, 404, {
      error: "Provider not found",
      provider: providerId
    });
    return true;
  }

  const debug = await generalEngine.resolveProviderDebug(providerId, type, id);

  if (debug?.mode === "internal") {
    json(res, 200, debug);
    return true;
  }

  json(res, 200, {
    mode: "external",
    provider: providerId,
    type,
    id,
    result: debug
  });
  return true;
}

export async function handleAnimeSearchDebug(req, res, { requestConfig, animeEngineEnabled }) {
  const match = req.normalizedPathname.match(/^\/_debug\/search\/([^/]+)\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    return false;
  }

  const [, rawProviderId, rawType, rawQuery] = match;
  const providerId = validateProviderId(rawProviderId);
  const type = validateStremioType(rawType);
  const query = validateSearchQuery(rawQuery);

  if (!animeEngineEnabled || !animeEngine.isProviderId(providerId)) {
    return false;
  }

  const genres = req.searchParams.getAll("genre");

  animeDebugLog("provider.search.request", {
    providerId,
    type,
    query,
    genres
  });

  const debug = await animeEngine.resolveProviderSearchDebug(providerId, type, query, genres);

  animeDebugLog("provider.search.response", {
    providerId,
    type,
    query,
    resultCount: debug?.resultCount ?? null,
    error: debug?.error || null
  });

  json(res, 200, {
    mode: "anime_provider_search",
    provider: providerId,
    type,
    query,
    result: debug
  });
  return true;
}
