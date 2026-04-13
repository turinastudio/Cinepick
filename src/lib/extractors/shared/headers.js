import { getRandomUserAgent } from "../../user-agents.js";

function normalizeRequestHeaders(input) {
  if (!input) {
    return {};
  }

  if (typeof input === "string") {
    return {
      Referer: input,
      "User-Agent": getRandomUserAgent()
    };
  }

  if (typeof input === "object") {
    return {
      "User-Agent": getRandomUserAgent(),
      ...input
    };
  }

  return {};
}

function extractInlineCookieHeader(html) {
  const cookiePairs = [];
  const pattern = /\$\.cookie\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]/g;
  let match;

  while ((match = pattern.exec(String(html || "")))) {
    cookiePairs.push(`${match[1]}=${match[2]}`);
  }

  return cookiePairs.join("; ");
}

function buildPlaybackHeaders(pageUrl, extra = {}) {
  const normalized = String(pageUrl || "");
  let origin = "";

  try {
    origin = new URL(normalized).origin;
  } catch {
    origin = "";
  }

  return normalizeRequestHeaders({
    ...(origin ? { Origin: origin } : {}),
    ...(normalized ? { Referer: normalized } : {}),
    ...extra
  });
}

export {
  normalizeRequestHeaders,
  extractInlineCookieHeader,
  buildPlaybackHeaders
};
