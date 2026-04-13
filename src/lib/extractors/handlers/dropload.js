import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities, isHttpUrl } from "../shared/html.js";
import { getAndUnpack } from "../shared/packer.js";
import { buildPlaybackHeaders } from "../shared/headers.js";
import { silentFallback } from "../shared/context.js";

export async function extractDropload(url, label) {
  const normalized = url
    .replace("/d/", "/")
    .replace("/e/", "/")
    .replace("/embed-", "/");
  const html = await fetchText(normalized, {
    Referer: normalized
  }).catch(silentFallback("dropload", null));

  if (!html || /File Not Found|Pending in queue|no longer available|expired or has been deleted/i.test(html)) {
    return [];
  }

  const unpacked = getAndUnpack(html);
  const fileUrl =
    unpacked.match(/sources\s*:\s*\[\{\s*file\s*:\s*["']([^"']+)/i)?.[1] ||
    unpacked.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i)?.[1] ||
    html.match(/sources\s*:\s*\[\{\s*file\s*:\s*["']([^"']+)/i)?.[1] ||
    html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i)?.[1];

  if (!fileUrl || !isHttpUrl(fileUrl)) {
    return [];
  }

  return [
    buildStream("Gnula", `${label} Dropload`.trim(), decodeHtmlEntities(fileUrl), buildPlaybackHeaders(normalized))
  ];
}
