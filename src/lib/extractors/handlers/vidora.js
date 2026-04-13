import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities, isHttpUrl } from "../shared/html.js";
import { getAndUnpack } from "../shared/packer.js";
import { buildPlaybackHeaders } from "../shared/headers.js";
import { silentFallback } from "../shared/context.js";

export async function extractVidora(url, label) {
  const candidates = Array.from(new Set([
    url.replace("/embed/", "/").replace("/f/", "/e/"),
    url.replace("/embed/", "/"),
    url
  ]));

  for (const candidate of candidates) {
    const html = await fetchText(candidate, {
      Referer: candidate
    }).catch(silentFallback("vidora", null));

    if (!html) {
      continue;
    }

    const unpacked = getAndUnpack(html);
    const fileUrl =
      unpacked.match(/file:\s*"(.*?)"/i)?.[1] ||
      unpacked.match(/file:\s*'(.*?)'/i)?.[1] ||
      html.match(/src:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)/i)?.[1];

    if (!fileUrl || !isHttpUrl(fileUrl)) {
      continue;
    }

    return [
      buildStream("Gnula", `${label} Vidora`.trim(), decodeHtmlEntities(fileUrl), buildPlaybackHeaders(candidate))
    ];
  }

  return [];
}
