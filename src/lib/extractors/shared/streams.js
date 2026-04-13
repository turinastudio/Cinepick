import { getAndUnpack } from "./packer.js";
import { normalizeEmbeddedUrl, isHttpUrl } from "./html.js";

function extractM3u8UrlsFromText(text, baseUrl = "") {
  const workingText = String(text || "");
  if (!workingText) {
    return [];
  }

  const unpacked = getAndUnpack(workingText);
  const combined = [workingText, unpacked].filter(Boolean).join("\n");
  const matches = new Set();

  for (const match of combined.matchAll(/https?:\/\/[^"'\\\s]+\.m3u8(?:\?[^"'\\\s]*)?/gi)) {
    const normalized = normalizeEmbeddedUrl(match[0], baseUrl);
    if (isHttpUrl(normalized)) {
      matches.add(normalized);
    }
  }

  const quotedPatterns = [
    /(?:file|src|source|wurl)\s*:\s*"([^"]+\.m3u8[^"]*)"/gi,
    /(?:file|src|source|wurl)\s*:\s*'([^']+\.m3u8[^']*)'/gi,
    /["']((?:https?:)?\/\/[^"'\\\s]+\.m3u8(?:\?[^"'\\\s]*)?)["']/gi
  ];

  for (const pattern of quotedPatterns) {
    for (const match of combined.matchAll(pattern)) {
      const normalized = normalizeEmbeddedUrl(match[1], baseUrl);
      if (isHttpUrl(normalized)) {
        matches.add(normalized);
      }
    }
  }

  return [...matches];
}

export { extractM3u8UrlsFromText };
