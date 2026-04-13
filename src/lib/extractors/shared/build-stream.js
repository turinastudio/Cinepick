import { getRandomUserAgent } from "../../user-agents.js";
import { normalizeRequestHeaders } from "./headers.js";

function buildBehaviorHints(url, requestHeaders = null) {
  const behaviorHints = {};
  const normalizedHeaders = normalizeRequestHeaders(requestHeaders);

  if (/\.m3u8(\?|$)/i.test(url)) {
    behaviorHints.notWebReady = true;
  }

  if (Object.keys(normalizedHeaders).length > 0) {
    behaviorHints.proxyHeaders = {
      request: normalizedHeaders
    };
  }

  return Object.keys(behaviorHints).length > 0 ? behaviorHints : undefined;
}

export function buildProxiedUrl(targetUrl, requestHeaders = null, baseOverride = "") {
  const payload = {
    url: targetUrl,
    headers: normalizeRequestHeaders(requestHeaders)
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const base = String(baseOverride || "").replace(/\/$/, "");
  const extensionMatch = String(targetUrl || "").match(/(\.m3u8|\.mp4|\.ts|\.m4s|\.key|\.bin)(?:\?|$)/i);
  const extension = extensionMatch?.[1]?.toLowerCase() || ".bin";
  return `${base}/p/${b64}${extension}`;
}

export function buildStream(name, title, url, requestHeaders = null, shouldProxy = false) {
  const normalizedHeaders = normalizeRequestHeaders(requestHeaders);
  const finalUrl = shouldProxy ? buildProxiedUrl(url, normalizedHeaders) : url;
  const stream = { name, title, url: finalUrl };
  const behaviorHints = buildBehaviorHints(url, normalizedHeaders);

  if (shouldProxy || Object.keys(normalizedHeaders).length > 0) {
    stream._proxyHeaders = normalizedHeaders;
  }

  stream._targetUrl = url;

  if (behaviorHints) {
    if (shouldProxy) {
      // When proxying, our server handles the upstream headers.
      delete behaviorHints.proxyHeaders;
    }
    if (Object.keys(behaviorHints).length > 0) {
      stream.behaviorHints = behaviorHints;
    }
  }

  return stream;
}
