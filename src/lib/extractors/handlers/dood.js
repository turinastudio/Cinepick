import { fetchText, fetchWithTimeout } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { pickQualityLabel } from "../shared/html.js";
import { extractM3u8UrlsFromText } from "../shared/streams.js";

export async function extractDood(url, label) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: url
    },
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`Extractor respondio ${response.status} para ${url}`);
  }
  const resolvedUrl = response.url;
  const html = await response.text();

  const md5Path =
    html.match(/["'](\/pass_md5\/[^"']+)["']/i)?.[1] ||
    html.match(/\/pass_md5\/[^"'\\<\s]+/i)?.[0];
  if (!md5Path) {
    const fallbackMatches = extractM3u8UrlsFromText(html, resolvedUrl);
    if (fallbackMatches.length > 0) {
      const quality = pickQualityLabel(html, "video");
      return fallbackMatches.map((streamUrl) =>
        buildStream("Gnula", `${label} Doodstream ${quality}`.trim(), streamUrl, `${new URL(resolvedUrl).origin}/`)
      );
    }
    return [];
  }

  const resolved = new URL(resolvedUrl);
  const md5Url = `${resolved.protocol}//${resolved.host}${md5Path}`;
  const token = md5Url.split("/").pop();
  const randomString = Array.from({ length: 10 }, () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return chars[Math.floor(Math.random() * chars.length)];
  }).join("");
  const expiry = Date.now();
  const prefix = String(await fetchText(md5Url, {
    referer: resolvedUrl,
    origin: resolved.origin
  }) || "").trim();
  if (!prefix) {
    return [];
  }
  const directUrl = `${prefix}${randomString}?token=${token}&expiry=${expiry}`;
  const quality = pickQualityLabel(html, "video");

  return [buildStream("Gnula", `${label} Doodstream ${quality}`.trim(), directUrl, `${resolved.protocol}//${resolved.host}/`)];
}
