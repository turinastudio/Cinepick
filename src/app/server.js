import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URLSearchParams } from "node:url";
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
import { resolveConfiguredPath, buildConfigureState, hashAddonConfig } from "../config/addon-config.js";

const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10) || 3000;
const PUBLIC_STREAM_NAME = "Cinepick";
const logoPath = path.resolve(process.cwd(), "public", "assets", "Logo.png");
const addonUrlOverride = String(process.env.ADDON_URL || "").trim().replace(/\/$/, "");
const animeEngineEnabled = !/^(0|false|no)$/i.test(String(process.env.ENABLE_ANIME_ENGINE || "true").trim());
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

function buildManifest(req, requestConfig, basePathPrefix = "") {
  const origin = getRequestOrigin(req);
  const animeEnabled = Boolean(requestConfig?.engines?.anime) && animeEngineEnabled;
  const generalEnabled = Boolean(requestConfig?.engines?.general);
  const basePrefixes = (manifest.idPrefixes || []).filter((prefix) => {
    if (prefix === "tt") {
      return animeEnabled || generalEnabled;
    }

    if (!prefix.endsWith(":")) {
      return true;
    }

    const providerId = prefix.slice(0, -1);
    
    // Anime prefixes filtering
    if (["animeflv", "animeav1", "henaojara"].includes(providerId)) {
      return animeEnabled ? requestConfig?.providers?.anime?.[providerId] !== false : false;
    }

    // General prefixes filtering
    return generalEnabled
      ? requestConfig?.providers?.general?.[providerId] !== false
      : false;
  });
  const animeIdPrefixes = animeEnabled ? animeEngine.getIdPrefixes() : [];
  const manifestId = basePathPrefix
    ? `${manifest.id}.${hashAddonConfig(requestConfig)}`
    : manifest.id;
  return {
    ...manifest,
    id: manifestId,
    catalogs: animeEnabled ? manifest.catalogs : [],
    idPrefixes: [...new Set([...basePrefixes, ...animeIdPrefixes])],
    logo: `${origin}${basePathPrefix}/logo.png`
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

async function handleMeta(res, pathname, requestConfig = null) {
  const match = pathname.match(/^\/meta\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    notFound(res);
    return;
  }

  const [, requestedType, rawId] = match;
  const decodedId = decodeURIComponent(rawId);
  const animeDecision = await animeEngine.shouldUseAnimeEngine(requestedType, decodedId, {
    enabled: animeEngineEnabled && (requestConfig ? Boolean(requestConfig?.engines?.anime) : true)
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

async function handleStream(req, res, pathname, requestConfig = null) {
  const match = pathname.match(/^\/stream\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    notFound(res);
    return;
  }

  const [, requestedType, rawId] = match;
  const decodedId = decodeURIComponent(rawId);
  const animeDecision = await animeEngine.shouldUseAnimeEngine(requestedType, decodedId, {
    enabled: animeEngineEnabled && (requestConfig ? Boolean(requestConfig?.engines?.anime) : true)
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

async function handleCatalog(req, res, pathname, requestConfig = null) {
  const match = pathname.match(/^\/catalog\/([^/]+)\/([^/]+)(?:\/([^/]+))?\.json$/);

  if (!match) {
    notFound(res);
    return;
  }

  let [, requestedType, rawId, extraArgs] = match;
  let decodedId = decodeURIComponent(rawId);
  const extraParams = new URLSearchParams(extraArgs ? decodeURIComponent(extraArgs.replace(/\.json$/, "")) : "");
  
  if (!animeEngineEnabled || (requestConfig && !requestConfig?.engines?.anime)) {
    json(res, 200, { metas: [] });
    return;
  }

  try {
    let metas = [];
    const searchParam = extraParams.get("search");
    
    if (decodedId.startsWith("animeav1")) {
      const animeav1 = require("../engines/anime/runtime/providers/animeav1-client.js");
      if (searchParam) {
        metas = await animeav1.searchAnimeAV1(searchParam).catch(() => []);
      } else {
        metas = await animeav1.getAnimeAV1AiringTitles().catch(() => []);
      }
    } else if (decodedId.startsWith("animeflv")) {
      const animeflv = require("../engines/anime/runtime/providers/animeflv-client.js");
      if (searchParam) {
        metas = await animeflv.searchAnimeFLV(searchParam).catch(() => []);
      } else {
        metas = await animeflv.getAnimeFLVAiringTitles().catch(() => []);
      }
    } else if (decodedId.startsWith("henaojara")) {
      const henaojara = require("../engines/anime/runtime/providers/henaojara-client.js");
      if (searchParam) {
        metas = await henaojara.searchHenaojara(searchParam).catch(() => []);
      } else {
        metas = await henaojara.getHenaojaraAiringTitles().catch(() => []);
      }
    }

    if (metas && metas.length > 0) {
      metas = metas.map((meta) => ({
        id: meta.slug ? `${decodedId.split('|')[0]}:${meta.slug}` : meta.id,
        type: meta.type || requestedType,
        name: meta.title || meta.name,
        poster: meta.poster,
        description: meta.overview || meta.description,
        genres: meta.genres ? meta.genres.map(g => g.charAt(0).toUpperCase() + g.slice(1)) : undefined
      }));
    }

    res.setHeader("Cache-Control", "max-age=259200, stale-while-revalidate=86400, stale-if-error=259200");
    json(res, 200, { metas: metas || [] });
  } catch (err) {
    json(res, 200, { metas: [] });
  }
}

async function handleDebug(res, pathname, requestConfig = null) {
  const match = pathname.match(/^\/_debug\/stream\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    notFound(res);
    return;
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

async function handleProviderDebug(res, pathname, requestConfig = null) {
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

async function handleAnimeSearchDebug(res, pathname, searchParams, requestConfig = null) {
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
    const originPathname = normalizeAddonPath(url.pathname);
    const resolvedPath = resolveConfiguredPath(originPathname);
    const requestConfig = resolvedPath.config;
    const normalizedPathname = resolvedPath.pathname;

    if (req.method === "GET" && originPathname === "/configure") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(fs.readFileSync(path.join(process.cwd(), "public/configure/index.html")));
      return;
    }

    if (req.method === "GET" && originPathname === "/configure/app.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(fs.readFileSync(path.join(process.cwd(), "public/configure/app.js")));
      return;
    }

    if (req.method === "GET" && originPathname === "/configure/styles.css") {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(fs.readFileSync(path.join(process.cwd(), "public/configure/styles.css")));
      return;
    }

    if (req.method === "GET" && originPathname === "/configure/state.json") {
      json(res, 200, buildConfigureState(getRequestOrigin(req), requestConfig));
      return;
    }

    if (req.method === "GET" && normalizedPathname === "/manifest.json") {
      json(res, 200, buildManifest(req, requestConfig, resolvedPath.basePathPrefix), {
        "Cache-Control": "max-age=300, stale-while-revalidate=86400"
      });
      return;
    }

    if (req.method === "GET" && normalizedPathname === "/") {
      const builtManifest = buildManifest(req, requestConfig, resolvedPath.basePathPrefix);
      json(res, 200, {
        ok: true,
        name: builtManifest.name,
        version: builtManifest.version
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
      await handleMeta(res, normalizedPathname, requestConfig);
      return;
    }

    if (req.method === "GET" && /^\/stream\/[^/]+\/.+\.json$/.test(normalizedPathname)) {
      await handleStream(req, res, normalizedPathname, requestConfig);
      return;
    }

    if (req.method === "GET" && /^\/_debug\/stream\/[^/]+\/.+\.json$/.test(normalizedPathname)) {
      await handleDebug(res, normalizedPathname, requestConfig);
      return;
    }

    if (req.method === "GET" && /^\/_debug\/provider\/[^/]+\/stream\/[^/]+\/.+\.json$/.test(normalizedPathname)) {
      await handleProviderDebug(res, normalizedPathname, requestConfig);
      return;
    }

    if (req.method === "GET" && /^\/catalog\/[^/]+\/[^/]+(?:\/[^/]+)?\.json$/.test(normalizedPathname)) {
      await handleCatalog(req, res, normalizedPathname, requestConfig);
      return;
    }

    if (req.method === "GET" && /^\/_debug\/search\/[^/]+\/[^/]+\/.+\.json$/.test(normalizedPathname)) {
      await handleAnimeSearchDebug(res, normalizedPathname, url.searchParams, requestConfig);
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
