function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function normalizeEmbeddedUrl(value, baseUrl = "") {
  const raw = decodeHtmlEntities(String(value || ""))
    .replace(/\\\//g, "/")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u0026/gi, "&")
    .trim();

  if (!raw) {
    return "";
  }

  if (raw.startsWith("//")) {
    return `https:${raw}`;
  }

  if (raw.startsWith("/") && baseUrl) {
    try {
      return new URL(raw, baseUrl).href;
    } catch {
      return raw;
    }
  }

  return raw;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function getHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostIncludes(host, aliases) {
  return aliases.some((alias) => host.includes(alias));
}

function pickQualityLabel(text, fallback = "") {
  const match = text.match(/(\d{3,4})p/i);
  return match ? `${match[1]}p` : fallback;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export {
  decodeHtmlEntities,
  normalizeEmbeddedUrl,
  isHttpUrl,
  getHost,
  hostIncludes,
  pickQualityLabel,
  tryParseJson
};
