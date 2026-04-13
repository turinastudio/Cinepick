import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities, isHttpUrl } from "../shared/html.js";
import { getAndUnpack } from "../shared/packer.js";
import { buildPlaybackHeaders } from "../shared/headers.js";
import { silentFallback } from "../shared/context.js";

export async function extractMixdrop(url, label) {
  const candidates = Array.from(new Set([
    url,
    url.replace("/f/", "/e/"),
    url.replace("/e/", "/f/")
  ]));

  for (const candidate of candidates) {
    const html = await fetchText(candidate, {
      Referer: candidate
    }).catch(silentFallback("mixdrop", null));

    if (!html || /can't find the (file|video)|deleted/i.test(html)) {
      continue;
    }

    const unpacked = getAndUnpack(html);
    const directMatch =
      unpacked.match(/(?:MDCore|Core|MDp)\.wurl\s*=\s*"([^"]+)"/i)?.[1] ||
      unpacked.match(/(?:MDCore|Core|MDp)\.wurl\s*=\s*'([^']+)'/i)?.[1] ||
      unpacked.match(/wurl\s*=\s*"([^"]+)"/i)?.[1] ||
      unpacked.match(/wurl\s*=\s*'([^']+)'/i)?.[1] ||
      unpacked.match(/src:\s*"((?:https?:)?\/\/[^"]+)"/i)?.[1] ||
      unpacked.match(/src:\s*'((?:https?:)?\/\/[^']+)'/i)?.[1];

    if (!directMatch) {
      continue;
    }

    const directUrl = directMatch.startsWith("//")
      ? `https:${directMatch}`
      : directMatch;

    if (!isHttpUrl(directUrl)) {
      continue;
    }

    return [
      buildStream("Gnula", `${label} Mixdrop`.trim(), decodeHtmlEntities(directUrl), buildPlaybackHeaders(candidate))
    ];
  }

  return [];
}
