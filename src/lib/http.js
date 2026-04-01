import { buildProxiedUrl } from "./extractors.js";

export function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
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

function rewriteHlsManifest(text, manifestUrl, targetHeaders) {
  const lines = String(text || "").split(/\r?\n/);

  return lines.map((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return line;
    }

    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
        const absolute = absolutizeUrl(uri, manifestUrl);
        return `URI="${buildProxiedUrl(absolute, targetHeaders)}"`;
      });
    }

    return buildProxiedUrl(absolutizeUrl(trimmed, manifestUrl), targetHeaders);
  }).join("\n");
}

export async function proxyStream(req, res, targetUrl, targetHeaders = {}) {
  try {
    const headers = {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      ...targetHeaders
    };

    if (req.headers.range) {
      headers.range = req.headers.range;
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
      const rewritten = rewriteHlsManifest(manifestText, response.url || targetUrl, headers);

      responseHeaders["content-type"] = getHeaderValue(response.headers, "content-type") || "application/vnd.apple.mpegurl";
      responseHeaders["cache-control"] = "no-store";

      res.writeHead(response.status, responseHeaders);
      res.end(rewritten);
      return;
    }

    ["content-type", "content-length", "content-range", "accept-ranges"].forEach(copyHeader);

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
