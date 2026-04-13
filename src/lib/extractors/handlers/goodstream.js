import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities } from "../shared/html.js";
import { extractInlineCookieHeader } from "../shared/headers.js";
import { silentFallback } from "../shared/context.js";

export async function extractGoodstream(url, label) {
  const pageUrl = url;
  const html = await fetchText(pageUrl, {
    Referer: pageUrl,
    Origin: new URL(pageUrl).origin
  });

  if (/expired|deleted|file is no longer available/i.test(html)) {
    return [];
  }

  const fileMatch =
    html.match(/sources:\s*\[\s*\{\s*file:"([^"]+\.m3u8[^"]*)"/i) ||
    html.match(/sources:\s*\[\s*\{\s*file:'([^']+\.m3u8[^']*)'/i) ||
    html.match(/file:"([^"]+\.m3u8[^"]*)"/i) ||
    html.match(/file:'([^']+\.m3u8[^']*)'/i);

  if (!fileMatch) {
    return [];
  }

  const playlistUrl = decodeHtmlEntities(fileMatch[1].replace(/\\\//g, "/"));
  const cookieHeader = extractInlineCookieHeader(html);
  const pageOrigin = new URL(pageUrl).origin;
  const headers = {
    Referer: pageUrl,
    Origin: pageOrigin,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const viewMatch = html.match(/\/dl\?op=view&view_id=(\d+)&hash=([a-z0-9-]+)/i);
  if (viewMatch) {
    const beaconUrl = new URL(`/dl?op=view&view_id=${viewMatch[1]}&hash=${viewMatch[2]}&adb=0`, pageOrigin).href;
    await fetchText(beaconUrl, { ...headers }).catch(silentFallback("goodstream", null));
  }

  return [buildStream("Gnula", `${label} Goodstream`.trim(), playlistUrl, headers)];
}
