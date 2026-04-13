import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { normalizeEmbeddedUrl } from "../shared/html.js";
import { extractM3u8UrlsFromText } from "../shared/streams.js";

export async function extractNetuHqq(url, label) {
  const normalizedUrl = (() => {
    if (/\/f\//i.test(url)) {
      return url.replace(/\/f\//i, "/e/");
    }
    return url;
  })();

  let html = await fetchText(normalizedUrl, { Referer: normalizedUrl });
  let effectiveReferer = normalizedUrl;
  const iframeUrl =
    html.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] ||
    html.match(/location\.href\s*=\s*["']([^"']+)["']/i)?.[1];

  if (iframeUrl) {
    const resolvedIframeUrl = iframeUrl.startsWith("http")
      ? iframeUrl
      : new URL(iframeUrl, normalizedUrl).href;
    html = await fetchText(resolvedIframeUrl, { Referer: normalizedUrl });
    effectiveReferer = resolvedIframeUrl;
  }

  const directMatches = extractM3u8UrlsFromText(html, effectiveReferer);

  if (directMatches.length) {
    return [...new Set(directMatches)].map((streamUrl) =>
      buildStream("Gnula", `${label} Netu HLS`.trim(), streamUrl, effectiveReferer)
    );
  }

  const cfMatch = html.match(/https?:\/\/[^"'\\\s]*cfglobalcdn\.com[^"'\\\s]*\.m3u8[^"'\\\s]*/i);
  if (cfMatch) {
    return [buildStream("Gnula", `${label} Netu HLS`.trim(), normalizeEmbeddedUrl(cfMatch[0], effectiveReferer), effectiveReferer)];
  }

  return [];
}
