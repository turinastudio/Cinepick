import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { pickQualityLabel, decodeHtmlEntities } from "../shared/html.js";

export async function extractMp4Upload(url, label) {
  const html = await fetchText(url, { referer: "https://mp4upload.com/" });
  const directUrl =
    html.match(/player\.src\(\s*{\s*type:\s*"[^"]+"\s*,\s*src:\s*"([^"]+)"/is)?.[1] ||
    html.match(/src:\s*"([^"]+\.m3u8[^"]*)"/is)?.[1] ||
    html.match(/src:\s*"([^"]+\.mp4[^"]*)"/is)?.[1];

  if (!directUrl) {
    return [];
  }

  const quality = pickQualityLabel(html, "video");
  return [buildStream("Gnula", `${label} Mp4Upload ${quality}`.trim(), decodeHtmlEntities(directUrl), url)];
}
