import { buildProxiedUrl } from "./extractors.js";
import { createCache } from "../shared/cache.js";

const proxiedManifestCache = createCache({ defaultTtlMs: 20 * 1000, maxEntries: 300 });
const proxiedSmallAssetCache = createCache({ defaultTtlMs: 5 * 60 * 1000, maxEntries: 500 });
const SMALL_ASSET_MAX_BYTES = 256 * 1024;

export function json(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    ...extraHeaders
  });

  res.end(body);
}

export function notFound(res, message = "Not found") {
  json(res, 404, { error: message });
}

export function serverError(res, error) {
  json(res, 500, {
    error: "Internal server error",
    details: error instanceof Error
      ? `${error.message}${error.cause ? ` | cause: ${String(error.cause)}` : ""}`
      : String(error)
  });
}

function getHeaderValue(headers, name) {
  return headers?.[name] || headers?.get?.(name) || null;
}

function isHlsResponse(targetUrl, response) {
  const contentType = String(getHeaderValue(response.headers, "content-type") || "").toLowerCase();
  return /\.m3u8(\?|$)/i.test(targetUrl) || contentType.includes("mpegurl") || contentType.includes("vnd.apple.mpegurl");
}

function absolutizeUrl(candidate, baseUrl) {
  try {
    return new URL(candidate, baseUrl).href;
  } catch {
    return candidate;
  }
}

function getRequestOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || "http";
  const reqHost = req.headers.host || "127.0.0.1";
  return `${proto}://${reqHost}`;
}

function buildProxyCacheKey(targetUrl, targetHeaders = {}) {
  return JSON.stringify({
    url: String(targetUrl || ""),
    headers: Object.entries(targetHeaders || {}).sort(([a], [b]) => a.localeCompare(b))
  });
}

function isKeyLikeResponse(targetUrl, response) {
  const contentType = String(getHeaderValue(response.headers, "content-type") || "").toLowerCase();
  return /\.key(\?|$)/i.test(targetUrl) || contentType.includes("octet-stream");
}

function shouldCacheSmallAsset(req, targetUrl, response) {
  if (req.headers.range) {
    return false;
  }

  const contentLength = Number.parseInt(String(getHeaderValue(response.headers, "content-length") || ""), 10);
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > SMALL_ASSET_MAX_BYTES) {
    return false;
  }

  return isKeyLikeResponse(targetUrl, response);
}

function copyResponseHeaders(response, names) {
  const result = {};
  for (const name of names) {
    const val = getHeaderValue(response.headers, name);
    if (val) {
      result[name] = val;
    }
  }
  return result;
}

function rewriteHlsManifest(text, manifestUrl, targetHeaders, publicOrigin) {
  const lines = String(text || "").split(/\r?\n/);

  return lines.map((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return line;
    }

    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
        const absolute = absolutizeUrl(uri, manifestUrl);
        return `URI="${buildProxiedUrl(absolute, targetHeaders, publicOrigin)}"`;
      });
    }

    return buildProxiedUrl(absolutizeUrl(trimmed, manifestUrl), targetHeaders, publicOrigin);
  }).join("\n");
}

export async function proxyStream(req, res, targetUrl, targetHeaders = {}) {
  try {
    const publicOrigin = getRequestOrigin(req);
    const headers = {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      ...targetHeaders
    };
    const cacheKey = buildProxyCacheKey(targetUrl, headers);

    if (req.headers.range) {
      headers.range = req.headers.range;
    }

    if (!req.headers.range) {
      const cachedManifest = proxiedManifestCache.get(cacheKey);
      if (cachedManifest) {
        res.writeHead(cachedManifest.status, {
          ...cachedManifest.headers,
          "x-cinepick-cache": "manifest-hit"
        });
        res.end(cachedManifest.body);
        return;
      }

      const cachedAsset = proxiedSmallAssetCache.get(cacheKey);
      if (cachedAsset) {
        res.writeHead(cachedAsset.status, {
          ...cachedAsset.headers,
          "x-cinepick-cache": "asset-hit"
        });
        res.end(cachedAsset.body);
        return;
      }
    }

    const response = await fetch(targetUrl, {
      headers,
      redirect: "follow"
    });

    const responseHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*"
    };

    const copyHeader = (name) => {
      const val = getHeaderValue(response.headers, name);
      if (val) responseHeaders[name] = val;
    };

    if (isHlsResponse(targetUrl, response)) {
      const manifestText = await response.text();
      const rewritten = rewriteHlsManifest(manifestText, response.url || targetUrl, headers, publicOrigin);

      responseHeaders["content-type"] = getHeaderValue(response.headers, "content-type") || "application/vnd.apple.mpegurl";
      responseHeaders["cache-control"] = "public, max-age=20, stale-while-revalidate=40";

      if (!req.headers.range) {
        proxiedManifestCache.set(cacheKey, {
          status: response.status,
          headers: responseHeaders,
          body: rewritten
        });
      }

      res.writeHead(response.status, responseHeaders);
      res.end(rewritten);
      return;
    }

    ["content-type", "content-length", "content-range", "accept-ranges"].forEach(copyHeader);

    if (shouldCacheSmallAsset(req, targetUrl, response)) {
      const body = Buffer.from(await response.arrayBuffer());
      const cachedHeaders = {
        ...responseHeaders,
        ...copyResponseHeaders(response, ["content-type", "content-length", "content-range", "accept-ranges"]),
        "cache-control": "public, max-age=300, stale-while-revalidate=600"
      };
      proxiedSmallAssetCache.set(cacheKey, {
        status: response.status,
        headers: cachedHeaders,
        body
      });
      res.writeHead(response.status, cachedHeaders);
      res.end(body);
      return;
    }

    res.writeHead(response.status, responseHeaders);

    if (!response.body) {
      res.end();
      return;
    }

    const reader = response.body.getReader();

    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(Buffer.from(value));
      return pump();
    };

    pump().catch((err) => {
      console.error("Proxy pump error:", err);
      if (!res.writableEnded) res.end();
    });

    req.on("close", () => {
      reader.cancel();
    });
  } catch (error) {
    serverError(res, error);
  }
}
