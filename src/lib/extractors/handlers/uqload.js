import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities, isHttpUrl } from "../shared/html.js";

export async function extractUqload(url, label) {
  const normalizedUrl = (() => {
    if (/uqload\.(is|co|ws)\//i.test(url) && !/^https?:\/\/www\./i.test(url)) {
      return url.replace(/^(https?:\/\/)(?!www\.)/i, "$1www.");
    }
    return url;
  })();
  const html = await fetchText(normalizedUrl, {
    Referer: normalizedUrl,
    Origin: normalizedUrl
  });
  const scriptMatch =
    html.match(/sources:\s*\[\s*"([^"]+)"/i) ||
    html.match(/sources:\s*\[\s*'([^']+)'/i) ||
    html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/i) ||
    html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*'([^']+)'/i) ||
    html.match(/file:\s*"([^"]+)"/i) ||
    html.match(/file:\s*'([^']+)'/i);

  const videoUrl = decodeHtmlEntities(scriptMatch?.[1] || "").trim();
  if (!isHttpUrl(videoUrl)) {
    return [];
  }

  return [buildStream("Gnula", `${label} Uqload`.trim(), videoUrl, "https://uqload.ws/")];
}
