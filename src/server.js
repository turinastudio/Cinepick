import http from "node:http";
import { manifest } from "./manifest.js";
import {
  json,
  notFound,
  proxyStream,
  serverError
} from "./lib/http.js";
import {
  debugStreamsFromExternalId,
  getProviderByCatalog,
  resolveProviderFromMetaId,
  resolveStreamsFromExternalId
} from "./providers/index.js";

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

function createCatalogResponse(items) {
  return {
    metas: items.map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name,
      poster: item.poster,
      posterShape: item.posterShape || "poster",
      description: item.description,
      genres: item.genres,
      releaseInfo: item.releaseInfo
    }))
  };
}

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

async function handleCatalog(res, pathname, searchParams) {
  const match = pathname.match(/^\/catalog\/([^/]+)\/([^/.]+)\.json$/);

  if (!match) {
    notFound(res);
    return;
  }

  const [, type, catalogId] = match;
  const provider = getProviderByCatalog(catalogId);

  if (!provider || !provider.supportsType(type)) {
    json(res, 200, { metas: [] });
    return;
  }

  const items = await provider.search({
    type,
    query: searchParams.get("search") || ""
  });

  json(res, 200, createCatalogResponse(items));
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

async function handleStream(res, pathname) {
  const match = pathname.match(/^\/stream\/([^/]+)\/(.+)\.json$/);

  if (!match) {
    notFound(res);
    return;
  }

  const [, requestedType, rawId] = match;
  const resolved = resolveProviderFromMetaId(decodeURIComponent(rawId));

  if (!resolved || resolved.type !== requestedType) {
    const externalStreams = await resolveStreamsFromExternalId(requestedType, decodeURIComponent(rawId));
    json(res, 200, { streams: externalStreams });
    return;
  }

  const streams = await resolved.provider.getStreams({
    type: resolved.type,
    slug: resolved.slug
  });

  json(res, 200, { streams });
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
    globalSelectedStreams: debug.globalSelectedStreams || []
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

    if (req.method === "GET" && url.pathname === "/manifest.json") {
      json(res, 200, manifest);
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      json(res, 200, {
        ok: true,
        name: manifest.name,
        version: manifest.version,
        manifest: "/manifest.json"
      });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/catalog/")) {
      await handleCatalog(res, url.pathname, url.searchParams);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/meta/")) {
      await handleMeta(res, url.pathname);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/stream/")) {
      await handleStream(res, url.pathname);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/_debug/stream/")) {
      await handleDebug(res, url.pathname);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/p/")) {
      await handleProxy(req, res, url.pathname);
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
