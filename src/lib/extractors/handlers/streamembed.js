import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { buildPlaybackHeaders } from "../shared/headers.js";
import { silentFallback } from "../shared/context.js";

export async function extractStreamEmbed(url, label) {
  const html = await fetchText(url, {
    Referer: url
  }).catch(silentFallback("streamembed", null));

  if (!html || /Video is not ready/i.test(html)) {
    return [];
  }

  const videoJson = html.match(/video ?= ?(.*);/i)?.[1];
  if (!videoJson) {
    return [];
  }

  try {
    const video = JSON.parse(videoJson);
    const parsed = new URL(url);
    const playlistUrl = `${parsed.origin}/m3u8/${video.uid}/${video.md5}/master.txt?s=1&id=${video.id}&cache=${video.status}`;

    return [
      buildStream("Gnula", `${label} StreamEmbed`.trim(), playlistUrl, buildPlaybackHeaders(url))
    ];
  } catch {
    return [];
  }
}
