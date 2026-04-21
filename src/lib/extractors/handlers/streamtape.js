import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";

const ALLOWED_HOSTS = new Set([
  "streamtape.com",
  "streamtape.to",
  "streamtape.net",
  "streamtape.xyz",
  "streamtape.ca",
  "streamtape.cc",
  "streamtape.site",
  "streamtape.link"
]);

const CONTENT_DOMAIN = "tapecontent.net";
const CONTENT_DOMAIN_FRAGMENT = "tapecontent";
const NOROBOTLINK_ELEMENT_ID = "norobotlink";

function normalizeStreamTapeUrl(rawUrl) {
  const urlWithScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${String(rawUrl || "").replace(/^\/+/, "")}`;
  let parsed;

  try {
    parsed = new URL(urlWithScheme);
  } catch {
    return rawUrl;
  }

  const bareHost = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (!ALLOWED_HOSTS.has(bareHost)) {
    return rawUrl;
  }

  const pathMatch = parsed.pathname.match(/^\/(v|e)\/([A-Za-z0-9_-]+)/i);
  if (!pathMatch) {
    return rawUrl;
  }

  const [, pathType, id] = pathMatch;
  const normalizedPath = pathType.toLowerCase() === "e" ? `/e/${id}` : `/v/${id}`;
  const finalPath = normalizedPath.startsWith("/e/") ? normalizedPath : `/e/${id}`;

  return `https://${bareHost}${finalPath}`;
}

function extractNorobotlinkBase(html) {
  const elementId = NOROBOTLINK_ELEMENT_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`getElementById\\s*\\(\\s*['"]${elementId}['"]\\s*\\)\\s*\\.innerHTML\\s*=\\s*['"]([^'"]+)['"]`, "i"),
    new RegExp(`getElementById\\s*\\(\\s*['"]${elementId}['"]\\s*\\)\\s*\\.innerHTML\\s*=\\s*\`([^\\\`]+)\``, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractNorobotlinkToken(html) {
  const elementId = NOROBOTLINK_ELEMENT_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const directPatterns = [
    new RegExp(`getElementById\\s*\\(\\s*['"]${elementId}['"]\\s*\\)\\s*\\.innerHTML\\s*\\+=\\s*['"]([^'"]+)['"]`, "i"),
    new RegExp(`getElementById\\s*\\(\\s*['"]${elementId}['"]\\s*\\)\\s*\\.innerHTML\\s*\\+=\\s*\`([^\\\`]+)\``, "i")
  ];

  for (const pattern of directPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  const variableMatch = html.match(
    new RegExp(`getElementById\\s*\\(\\s*['"]${elementId}['"]\\s*\\)\\s*\\.innerHTML\\s*\\+=\\s*([A-Za-z_$][A-Za-z0-9_$]*)\\s*;`, "i")
  );

  if (!variableMatch?.[1]) {
    return null;
  }

  const varName = variableMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const valueMatch = html.match(new RegExp(`(?:var|let|const)\\s+${varName}\\s*=\\s*['"]([^'"]+)['"]`, "i"));
  return valueMatch?.[1] || null;
}

function extractViaNorobotlink(html) {
  const base = extractNorobotlinkBase(html);
  const token = extractNorobotlinkToken(html);

  if (!base || !token) {
    return null;
  }

  return `${base}${token}`;
}

function extractViaVideoVariable(html) {
  const patterns = [
    new RegExp(`(?:var|let|const)\\s+(?:videoUrl|video_url|fileUrl|file_url|srcUrl|src_url)\\s*=\\s*['"]([^'"]+${CONTENT_DOMAIN_FRAGMENT}[^'"]+)['"]`, "i"),
    new RegExp(`"(?:file|src|url|videoUrl|source)"\\s*:\\s*"([^"]+${CONTENT_DOMAIN_FRAGMENT}[^"]+)"`, "i"),
    new RegExp(`"(?:file|src|url|videoUrl|source)"\\s*:\\s*'([^']+${CONTENT_DOMAIN_FRAGMENT}[^']+)'`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractViaTapecontentUrl(html) {
  const match = html.match(/((?:https?:)?\/\/[A-Za-z0-9._-]*tapecontent\.net\/[^\s'"<>]+\.mp4(?:\?[^\s'"<>]*)?)/i);
  return match?.[1] || null;
}

function finalizeUrl(raw) {
  if (!raw) {
    return null;
  }

  let url = String(raw).trim();

  if (url.startsWith("//")) {
    url = `https:${url}`;
  }

  if (url.startsWith("http://")) {
    url = `https://${url.slice("http://".length)}`;
  }

  if (!url.startsWith("https://")) {
    return null;
  }

  if (!url.includes(CONTENT_DOMAIN)) {
    return null;
  }

  if (!url.includes("?")) {
    url = `${url}?dl=1`;
  } else if (!/[?&]dl=1(?:&|$)/i.test(url)) {
    if (/[?&]dl=\d/i.test(url)) {
      url = url.replace(/([?&]dl=)\d/i, "$11");
    } else {
      url = `${url}&dl=1`;
    }
  }

  const sanitized = url.replace(/[^\x20-\x7E]/g, "");

  try {
    const parsed = new URL(sanitized);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function extractStreamTape(url, label) {
  const normalized = normalizeStreamTapeUrl(url);
  const html = await fetchText(normalized, {
    referer: normalized,
    dnt: "1",
    connection: "keep-alive",
    "upgrade-insecure-requests": "1"
  });

  const candidate =
    extractViaNorobotlink(html) ||
    extractViaVideoVariable(html) ||
    extractViaTapecontentUrl(html);
  const directUrl = finalizeUrl(candidate);

  if (!directUrl) {
    return [];
  }

  return [buildStream("Gnula", `${label} StreamTape`.trim(), directUrl, normalized)];
}
