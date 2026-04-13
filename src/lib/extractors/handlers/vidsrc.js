import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { buildPlaybackHeaders } from "../shared/headers.js";
import { silentFallback } from "../shared/context.js";

export async function extractVidSrc(url, label) {
  const html = await fetchText(url, {
    Referer: url
  }).catch(silentFallback("vidsrc", null));

  if (!html) {
    return [];
  }

  const token = html.match(/['"]token['"]:\s*['"]([^'"]+)['"]/i)?.[1];
  const expires = html.match(/['"]expires['"]:\s*['"]([^'"]+)['"]/i)?.[1];
  const rawUrl = html.match(/url:\s*['"]([^'"]+)['"]/i)?.[1];

  if (!token || !expires || !rawUrl) {
    return [];
  }

  const baseUrl = new URL(rawUrl);
  const playlistUrl = new URL(`${baseUrl.origin}${baseUrl.pathname}.m3u8?${baseUrl.searchParams.toString()}`);
  playlistUrl.searchParams.set("token", token);
  playlistUrl.searchParams.set("expires", expires);
  playlistUrl.searchParams.set("h", "1");

  return [
    buildStream("Gnula", `${label} VidSrc`.trim(), playlistUrl.href, buildPlaybackHeaders(url))
  ];
}
