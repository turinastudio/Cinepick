import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { manifest } from "./manifest.js";
import {
  json,
  notFound,
  proxyStream,
  serverError
} from "./lib/http.js";
import { appendSupportStream } from "./lib/support-stream.js";
import {
  debugProviderStreamsFromExternalId,
  debugStreamsFromExternalId,
  getProviderById,
  resolveProviderFromMetaId,
  resolveStreamsFromExternalId
} from "./providers/index.js";

const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10) || 3000;
const PUBLIC_STREAM_NAME = "CinePick";
const logoPath = path.resolve(process.cwd(), "assets", "Logo.png");
const addonUrlOverride = String(process.env.ADDON_URL || "").trim().replace(/\/$/, "");

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
  return {
    ...manifest,
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
  const resolved = resolveProviderFromMetaId(decodeURIComponent(rawId));

  if (!resolved || resolved.type !== requestedType) {
    json(res, 200, { meta: null });
    return;
  }

  const item = await resolved.provider.getMeta({
    type: resolved.type,
    slug: resolved.slug
  });

  json(res, 200, createMetaResponse(item));
}

async function handleStream(req, res, pathname) {
  const match = pathname.match(/^\/stream\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    notFound(res);
    return;
  }

  const [, requestedType, rawId] = match;
  const resolved = resolveProviderFromMetaId(decodeURIComponent(rawId));

  if (!resolved || resolved.type !== requestedType) {
    const externalStreams = await resolveStreamsFromExternalId(requestedType, decodeURIComponent(rawId));
    json(res, 200, {
      streams: projectPublicStreams(absolutizeStreamUrls(req, appendSupportStream(externalStreams)))
    });
    return;
  }

  const streams = await resolved.provider.getStreams({
    type: resolved.type,
    slug: resolved.slug
  });

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
  const resolved = resolveProviderFromMetaId(decodedId);

  if (resolved && resolved.type === requestedType) {
    const providerDebug = await resolved.provider.debugInternalStreams({
      type: resolved.type,
      slug: resolved.slug
    });

    if (providerDebug) {
      json(res, 200, {
        mode: "internal",
        provider: resolved.provider.id,
        type: resolved.type,
        slug: resolved.slug,
        ...providerDebug
      });
      return;
    }

    json(res, 200, {
      mode: "internal",
      provider: resolved.provider.id,
      type: resolved.type,
      slug: resolved.slug
    });
    return;
  }

  const debug = await debugStreamsFromExternalId(requestedType, decodedId);
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
  const provider = getProviderById(providerId);

  if (!provider) {
    json(res, 404, {
      error: "Provider not found",
      provider: providerId
    });
    return;
  }

  const resolved = resolveProviderFromMetaId(decodedId);
  if (resolved && resolved.provider.id === providerId && resolved.type === requestedType) {
    const providerDebug = await provider.debugInternalStreams({
      type: resolved.type,
      slug: resolved.slug
    });

    json(res, 200, {
      mode: "internal",
      provider: provider.id,
      type: resolved.type,
      slug: resolved.slug,
      ...providerDebug
    });
    return;
  }

  const debug = await debugProviderStreamsFromExternalId(providerId, requestedType, decodedId);
  json(res, 200, {
    mode: "external",
    provider: providerId,
    type: requestedType,
    id: decodedId,
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
        version: buildManifest(req).version,
        manifest: "/manifest.json",
        alternateManifest: "/alt/manifest.json"
      });
      return;
    }

    if (req.method === "GET" && normalizedPathname === "/logo.png") {
      const imageBuffer = fs.readFileSync(logoPath);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600"
      });
      res.end(imageBuffer);
      return;
    }

    if (req.method === "GET" && normalizedPathname.startsWith("/meta/")) {
      await handleMeta(res, normalizedPathname);
      return;
    }

    if (req.method === "GET" && normalizedPathname.startsWith("/stream/")) {
      await handleStream(req, res, normalizedPathname);
      return;
    }

    if (req.method === "GET" && normalizedPathname.startsWith("/_debug/stream/")) {
      await handleDebug(res, normalizedPathname);
      return;
    }

    if (req.method === "GET" && normalizedPathname.startsWith("/_debug/provider/")) {
      await handleProviderDebug(res, normalizedPathname);
      return;
    }

    if (req.method === "GET" && normalizedPathname.startsWith("/p/")) {
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
