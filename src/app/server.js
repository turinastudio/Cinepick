import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { manifest } from "./manifest.js";
import {
  animeEngine,
  generalEngine
} from "../engines/index.js";
import {
  json,
  notFound,
  proxyStream,
  serverError
} from "../lib/http.js";
import { appendSupportStream } from "../lib/support-stream.js";
import { createDebugLogger } from "../shared/debug.js";

const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10) || 3000;
const PUBLIC_STREAM_NAME = "Cinepick";
const logoPath = path.resolve(process.cwd(), "public", "assets", "Logo.png");
const addonUrlOverride = String(process.env.ADDON_URL || "").trim().replace(/\/$/, "");
const animeEngineEnabled = /^(1|true|yes)$/i.test(String(process.env.ENABLE_ANIME_ENGINE || "").trim());
const animeEngineDebugEnabled = /^(1|true|yes)$/i.test(String(process.env.ANIME_ENGINE_DEBUG || "").trim());
const animeDebugLog = createDebugLogger("anime-engine", () => animeEngineDebugEnabled);

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

function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
}

function normalizeAddonPath(pathname) {
  if (pathname === "/alt" || pathname.startsWith("/alt/")) {
    const normalized = pathname.slice("/alt".length) || "/";
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }

  return pathname;
}

function getRequestOrigin(req) {
  if (addonUrlOverride) {
    return addonUrlOverride;
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || "http";
  const reqHost = req.headers.host || `${host}:${port}`;
  return `${proto}://${reqHost}`;
}

function buildManifest(req) {
  const origin = getRequestOrigin(req);
  const animeIdPrefixes = animeEngineEnabled ? animeEngine.getIdPrefixes() : [];
  return {
    ...manifest,
    idPrefixes: [...new Set([...(manifest.idPrefixes || []), ...animeIdPrefixes])],
    logo: `${origin}/logo.png`
  };
}

function absolutizeStreamUrls(req, streams) {
  const origin = getRequestOrigin(req);

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

function projectPublicStreams(streams) {
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

function sanitizeDebugStreams(streams) {
  return (Array.isArray(streams) ? streams : []).map((stream) => {
    if (!stream || typeof stream !== "object") {
      return stream;
    }

    const { _rawTitle, ...rest } = stream;
    return rest;
  });
}

async function handleMeta(res, pathname) {
  const match = pathname.match(/^\/meta\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    notFound(res);
    return;
  }

  const [, requestedType, rawId] = match;
  const decodedId = decodeURIComponent(rawId);
  const animeDecision = await animeEngine.shouldUseAnimeEngine(requestedType, decodedId, {
    enabled: animeEngineEnabled
  });

  animeDebugLog("meta.route", {
    type: requestedType,
    id: decodedId,
    ...animeDecision
  });

  if (animeDecision.useAnimeEngine) {
    animeDebugLog("meta.request", {
      type: requestedType,
      id: decodedId
    });
    const { payload } = await animeEngine.resolveMeta(requestedType, decodedId);
    animeDebugLog("meta.response", {
      type: requestedType,
      id: decodedId,
      hasMeta: Boolean(payload?.meta),
      metaId: payload?.meta?.id || null,
      metaName: payload?.meta?.name || null
    });
    json(res, 200, createMetaResponse(payload.meta));
    return;
  }

  const general = await generalEngine.resolveMeta(requestedType, decodedId);
  json(res, 200, { meta: general.meta ? createMetaResponse(general.meta).meta : null });
}

async function handleStream(req, res, pathname) {
  const match = pathname.match(/^\/stream\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    notFound(res);
    return;
  }

  const [, requestedType, rawId] = match;
  const decodedId = decodeURIComponent(rawId);
  const animeDecision = await animeEngine.shouldUseAnimeEngine(requestedType, decodedId, {
    enabled: animeEngineEnabled
  });

  animeDebugLog("stream.route", {
    type: requestedType,
    id: decodedId,
    ...animeDecision
  });

  if (animeDecision.useAnimeEngine) {
    animeDebugLog("stream.request", {
      type: requestedType,
      id: decodedId
    });
    const { payload } = await animeEngine.resolveStreams(requestedType, decodedId);
    animeDebugLog("stream.response", {
      type: requestedType,
      id: decodedId,
      streamCount: Array.isArray(payload?.streams) ? payload.streams.length : 0,
      message: payload?.message || null
    });
    json(res, 200, {
      streams: projectPublicStreams(absolutizeStreamUrls(req, payload.streams || []))
    });
    return;
  }

  const general = await generalEngine.resolveStreams(requestedType, decodedId);
  const streams = Array.isArray(general.streams) ? general.streams : [];
  json(res, 200, {
    streams: projectPublicStreams(absolutizeStreamUrls(req, appendSupportStream(streams)))
  });
}

async function handleDebug(res, pathname) {
  const match = pathname.match(/^\/_debug\/stream\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    notFound(res);
    return;
  }

  const [, requestedType, rawId] = match;
  const decodedId = decodeURIComponent(rawId);
  const animeDecision = await animeEngine.shouldUseAnimeEngine(requestedType, decodedId, {
    enabled: animeEngineEnabled
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
    return;
  }

  const general = await generalEngine.resolveDebug(requestedType, decodedId);
  if (general.mode === "internal") {
    if (general.debug) {
      json(res, 200, {
        mode: "internal",
        provider: general.providerId,
        type: general.type,
        slug: general.slug,
        ...general.debug
      });
      return;
    }

    json(res, 200, {
      mode: "internal",
      provider: general.providerId,
      type: general.type,
      slug: general.slug
    });
    return;
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
}

async function handleProviderDebug(res, pathname) {
  const match = pathname.match(/^\/_debug\/provider\/([^/]+)\/stream\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    notFound(res);
    return;
  }

  const [, providerId, requestedType, rawId] = match;
  const decodedId = decodeURIComponent(rawId);

  if (animeEngineEnabled && animeEngine.isProviderId(providerId)) {
    animeDebugLog("provider.debug.request", {
      providerId,
      type: requestedType,
      id: decodedId
    });
    const debug = await animeEngine.resolveProviderDebug(providerId, requestedType, decodedId);
    animeDebugLog("provider.debug.response", {
      providerId,
      type: requestedType,
      id: decodedId,
      status: debug?.status || null,
      streamCount: debug?.streamCount ?? null
    });
    json(res, 200, {
      mode: "anime_provider",
      provider: providerId,
      type: requestedType,
      id: decodedId,
      result: debug
    });
    return;
  }

  const provider = generalEngine.getProviderById(providerId);

  if (!provider) {
    json(res, 404, {
      error: "Provider not found",
      provider: providerId
    });
    return;
  }

  const debug = await generalEngine.resolveProviderDebug(providerId, requestedType, decodedId);
  if (debug?.mode === "internal") {
    json(res, 200, debug);
    return;
  }

  json(res, 200, {
    mode: "external",
    provider: providerId,
    type: requestedType,
    id: decodedId,
    result: debug
  });
}

async function handleAnimeSearchDebug(res, pathname, searchParams) {
  const match = pathname.match(/^\/_debug\/search\/([^/]+)\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    notFound(res);
    return;
  }

  const [, providerId, requestedType, rawQuery] = match;
  if (!animeEngineEnabled || !animeEngine.isProviderId(providerId)) {
    notFound(res);
    return;
  }

  const query = decodeURIComponent(rawQuery);
  const genres = searchParams.getAll("genre");
  animeDebugLog("provider.search.request", {
    providerId,
    type: requestedType,
    query,
    genres
  });
  const debug = await animeEngine.resolveProviderSearchDebug(providerId, requestedType, query, genres);
  animeDebugLog("provider.search.response", {
    providerId,
    type: requestedType,
    query,
    resultCount: debug?.resultCount ?? null,
    error: debug?.error || null
  });
  json(res, 200, {
    mode: "anime_provider_search",
    provider: providerId,
    type: requestedType,
    query,
    result: debug
  });
}

async function handleProxy(req, res, pathname) {
  const match = pathname.match(/^\/p\/(.+)$/);

  if (!match) {
    notFound(res);
    return;
  }

  try {
    const encodedPayload = match[1].replace(/\.(mp4|m3u8|ts|m4s|key|bin)$/i, "");
    const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf-8"));
    const { url, headers } = decoded;

    if (!url) {
      notFound(res, "Missing target URL");
      return;
    }

    await proxyStream(req, res, url, headers || {});
  } catch (error) {
    serverError(res, new Error("Invalid proxy payload", { cause: error }));
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    notFound(res);
    return;
  }

  try {
    const url = parseUrl(req);
    const normalizedPathname = normalizeAddonPath(url.pathname);

    if (req.method === "GET" && normalizedPathname === "/manifest.json") {
      json(res, 200, buildManifest(req));
      return;
    }

    if (req.method === "GET" && normalizedPathname === "/") {
      json(res, 200, {
        ok: true,
        name: buildManifest(req).name,
        version: buildManifest(req).version
      });
      return;
    }

    if (req.method === "GET" && normalizedPathname === "/logo.png") {
      if (!fs.existsSync(logoPath)) {
        notFound(res);
        return;
      }
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(fs.readFileSync(logoPath));
      return;
    }

    if (req.method === "GET" && /^\/meta\/[^/]+\/.+\.json$/.test(normalizedPathname)) {
      await handleMeta(res, normalizedPathname);
      return;
    }

    if (req.method === "GET" && /^\/stream\/[^/]+\/.+\.json$/.test(normalizedPathname)) {
      await handleStream(req, res, normalizedPathname);
      return;
    }

    if (req.method === "GET" && /^\/_debug\/stream\/[^/]+\/.+\.json$/.test(normalizedPathname)) {
      await handleDebug(res, normalizedPathname);
      return;
    }

    if (req.method === "GET" && /^\/_debug\/provider\/[^/]+\/stream\/[^/]+\/.+\.json$/.test(normalizedPathname)) {
      await handleProviderDebug(res, normalizedPathname);
      return;
    }

    if (req.method === "GET" && /^\/_debug\/search\/[^/]+\/[^/]+\/.+\.json$/.test(normalizedPathname)) {
      await handleAnimeSearchDebug(res, normalizedPathname, url.searchParams);
      return;
    }

    if (req.method === "GET" && /^\/p\/.+/.test(normalizedPathname)) {
      await handleProxy(req, res, normalizedPathname);
      return;
    }

    notFound(res);
  } catch (error) {
    serverError(res, error);
  }
});

server.listen(port, host, () => {
  console.log(`Addon disponible en http://${host}:${port}/manifest.json`);
});
