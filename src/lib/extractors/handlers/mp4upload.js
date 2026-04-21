import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { pickQualityLabel, decodeHtmlEntities } from "../shared/html.js";

export async function extractMp4Upload(url, label) {
  const normalized = (() => {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/\/+$/, "");
      const embedMatch = path.match(/^\/embed-([a-z0-9]+)\.html$/i);
      if (embedMatch) {
        return parsed.href;
      }

      const fileMatch = path.match(/^\/([a-z0-9]+)$/i);
      if (fileMatch) {
        return `${parsed.origin}/embed-${fileMatch[1]}.html`;
      }

      return parsed.href;
    } catch {
      return url;
    }
  })();

  const html = await fetchText(normalized, { referer: "https://mp4upload.com/" });
  const directUrl =
    html.match(/player\.src\(\s*{\s*type:\s*"[^"]+"\s*,\s*src:\s*"([^"]+)"/is)?.[1] ||
    html.match(/src:\s*"([^"]+\.m3u8[^"]*)"/is)?.[1] ||
    html.match(/src:\s*"([^"]+\.mp4[^"]*)"/is)?.[1];

  if (!directUrl) {
    return [];
  }

  const quality = pickQualityLabel(html, "video");
  return [buildStream("Gnula", `${label} Mp4Upload ${quality}`.trim(), decodeHtmlEntities(directUrl), normalized)];
}
