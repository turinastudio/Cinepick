import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { normalizeEmbeddedUrl, tryParseJson } from "../shared/html.js";
import { extractM3u8UrlsFromText } from "../shared/streams.js";
import { decryptFilemoonPlayback } from "../shared/crypto.js";
import { silentFallback } from "../shared/context.js";

export async function extractFilemoon(url, label) {
  let workingUrl = url;
  let parsed = new URL(workingUrl);
  const initialHtml = await fetchText(workingUrl, {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    Priority: "u=0, i",
    Origin: workingUrl,
    Referer: workingUrl
  });
  const iframeMatch = initialHtml.match(/<iframe\s+[^>]*src=["'](https?:\/\/[^"']+)["'][^>]*>/i);
  if (iframeMatch?.[1]) {
    workingUrl = iframeMatch[1];
    parsed = new URL(workingUrl);
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const mediaId = segments[0] === "e" ? segments[1] : segments.at(-1);

  if (!mediaId) {
    return [];
  }

  const detailsText = await fetchText(`https://${parsed.host}/api/videos/${mediaId}/embed/details`, {
    Referer: workingUrl,
    Origin: parsed.origin,
    Accept: "application/json,text/plain;q=0.9,*/*;q=0.8"
  }).catch(silentFallback("filemoon", ""));
  const detailsJson = tryParseJson(detailsText);
  const embedUrl = normalizeEmbeddedUrl(
    detailsJson?.embed_frame_url || detailsText.match(/"embed_frame_url"\s*:\s*"([^"]+)"/i)?.[1],
    workingUrl
  );

  if (!embedUrl) {
    const fallbackMatches = extractM3u8UrlsFromText(initialHtml, workingUrl);
    return fallbackMatches.map((streamUrl) =>
      buildStream("Gnula", `${label} Filemoon HLS`.trim(), streamUrl, `https://${parsed.host}/`)
    );
  }

  const embedHost = new URL(embedUrl).host;
  const playbackText = await fetchText(`https://${embedHost}/api/videos/${mediaId}/embed/playback`, {
    Referer: embedUrl,
    "X-Embed-Origin": parsed.host,
    "X-Embed-Parent": workingUrl,
    "X-Embed-Referer": workingUrl,
    Accept: "*/*",
    "Accept-Language": "es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin"
  });

  let playbackJson = tryParseJson(playbackText);
  let sources = Array.isArray(playbackJson?.sources) ? playbackJson.sources : null;

  if ((!sources || !sources.length) && playbackJson?.playback) {
    try {
      const decrypted = decryptFilemoonPlayback(playbackJson.playback);
      playbackJson = JSON.parse(decrypted);
      sources = Array.isArray(playbackJson?.sources) ? playbackJson.sources : null;
    } catch {
      sources = null;
    }
  }

  if (!sources?.length) {
    const fallbackMatches = extractM3u8UrlsFromText(playbackText, embedUrl);
    if (fallbackMatches.length > 0) {
      return fallbackMatches.map((streamUrl) =>
        buildStream("Gnula", `${label} Filemoon HLS`.trim(), streamUrl, `https://${parsed.host}/`)
      );
    }
    return [];
  }

  return sources
    .map((source) => {
      const streamUrl = source.url || source.file;
      if (!streamUrl) {
        return null;
      }

      const quality = source.label || "HLS";
      return buildStream("Gnula", `${label} Filemoon ${quality}`.trim(), streamUrl, `https://${parsed.host}/`);
    })
    .filter(Boolean);
}
