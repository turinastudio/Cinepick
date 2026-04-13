import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities, isHttpUrl, tryParseJson } from "../shared/html.js";
import { getAndUnpack } from "../shared/packer.js";

export async function extractLamovieEmbed(url, label) {
  const parsedUrl = new URL(url);
  const origin = `${parsedUrl.protocol}//${parsedUrl.host}`;
  const referer = `${origin}/`;
  const html = await fetchText(url, {
    Origin: origin,
    Referer: referer
  });

  const configJsonMatch = html.match(/<script\s+id=["']config["'][^>]*>(\{[\s\S]*?\})<\/script>/i);
  if (configJsonMatch?.[1]) {
    const parsedConfig = tryParseJson(configJsonMatch[1]);
    const directUrl = decodeHtmlEntities(String(parsedConfig?.file || "")).replace(/\\\//g, "/").trim();
    if (isHttpUrl(directUrl) && /\.m3u8(\?|$)/i.test(directUrl)) {
      return [buildStream("Gnula", `${label} HLS`.trim(), directUrl, referer)];
    }
  }

  const scriptBodies = Array.from(
    html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1]
  ).filter(Boolean);

  const unpackedScripts = scriptBodies.map((script) =>
    script.includes("eval(function(p,a,c") ? getAndUnpack(script) : script
  );
  const combined = [html, ...unpackedScripts].join("\n");
  const m3u8Match = combined.match(/https?:\/\/[^"'\\\s]+\.m3u8(?:\?[^"'\\\s]*)?/i)?.[0];

  if (!m3u8Match) {
    return [];
  }

  return [buildStream("Gnula", `${label} HLS`.trim(), decodeHtmlEntities(m3u8Match), referer)];
}
