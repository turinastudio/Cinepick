import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities } from "../shared/html.js";
import { buildPlaybackHeaders } from "../shared/headers.js";
import { silentFallback } from "../shared/context.js";

export async function extractEmturbovid(url, label) {
  const html = await fetchText(url, {
    Referer: url
  }).catch(silentFallback("emturbovid", null));

  if (!html) {
    return [];
  }

  const playlistUrl =
    html.match(/data-hash="([^"]+\.m3u8[^"]*)"/i)?.[1] ||
    html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i)?.[1];

  if (!playlistUrl) {
    return [];
  }

  return [
    buildStream("Gnula", `${label} Emturbovid`.trim(), decodeHtmlEntities(playlistUrl), buildPlaybackHeaders(url))
  ];
}
