import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { silentFallback } from "../shared/context.js";

export async function extractCuevanaPlayer(url, label) {
  const { resolveExtractorStream } = await import("../registry.js");

  const html = await fetchText(url, {
    Referer: url
  }).catch(silentFallback("cuevanaplayer", null));

  if (!html) {
    return [];
  }

  const target =
    html.match(/var\s+url\s*=\s*'([^']+)'/i)?.[1] ||
    html.match(/var\s+url\s*=\s*"([^"]+)"/i)?.[1] ||
    html.match(/<iframe[^>]+src="([^"]+)"/i)?.[1] ||
    html.match(/<iframe[^>]+src='([^']+)'/i)?.[1];

  if (!target) {
    return [];
  }

  const resolvedUrl = target.startsWith("http")
    ? target
    : new URL(target, url).href;

  return resolveExtractorStream(resolvedUrl, label);
}
