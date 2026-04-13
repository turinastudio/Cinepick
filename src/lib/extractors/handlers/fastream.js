import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities, isHttpUrl } from "../shared/html.js";
import { getAndUnpack } from "../shared/packer.js";
import { silentFallback } from "../shared/context.js";

export async function extractFastream(url, label) {
  const candidates = [
    url,
    url.replace("/e/", "/embed-").replace("/d/", "/embed-"),
    url.replace("/embed-", "/d/")
  ];

  for (const candidate of Array.from(new Set(candidates))) {
    const html = await fetchText(candidate, {
      Referer: candidate
    }).catch(silentFallback("fastream", null));

    if (!html) {
      continue;
    }

    const unpacked = getAndUnpack(html);
    const fileMatch =
      unpacked.match(/sources:\[\{file:"(.*?)"/i) ||
      unpacked.match(/file:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/i) ||
      unpacked.match(/file:\s*'([^']+\.m3u8[^']*)'/i);

    if (!fileMatch?.[1]) {
      continue;
    }

    const streamUrl = decodeHtmlEntities(fileMatch[1]);
    if (!isHttpUrl(streamUrl)) {
      continue;
    }

    return [
      buildStream("Gnula", `${label} Fastream HLS`.trim(), streamUrl, {
        Referer: candidate
      })
    ];
  }

  return [];
}
