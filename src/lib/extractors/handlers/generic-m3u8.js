import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities, tryParseJson } from "../shared/html.js";

export async function extractGenericM3u8Page(url, label) {
  const html = await fetchText(url);
  const directMatches = Array.from(
    html.matchAll(/https?[^"'\\\s]+(?:master\.m3u8|\.m3u8)[^"'\\\s]*/gi),
    (match) => decodeHtmlEntities(match[0])
  );

  if (directMatches.length) {
    return [...new Set(directMatches)].map((streamUrl) =>
      buildStream("Gnula", `${label} GenericM3U8`.trim(), streamUrl, url)
    );
  }

  const manifestMatch = html.match(/\{[^{}]*"auto"\s*:\s*"[^"]+m3u8[^"]*"[^{}]*\}/i);
  const manifestJson = manifestMatch ? tryParseJson(decodeHtmlEntities(manifestMatch[0])) : null;

  if (!manifestJson || typeof manifestJson !== "object") {
    return [];
  }

  return Object.entries(manifestJson)
    .filter(([, streamUrl]) => typeof streamUrl === "string" && /m3u8/i.test(streamUrl))
    .map(([quality, streamUrl]) => {
      const normalizedQuality = quality === "auto"
        ? "Auto"
        : quality.endsWith("p") ? quality : `${quality}p`;
      return buildStream("Gnula", `${label} ${normalizedQuality}`.trim(), decodeHtmlEntities(streamUrl), url);
    });
}

export async function extractJWPlayer(url, label) {
  const html = await fetchText(url);
  const scripts = Array.from(
    html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1]
  ).filter(Boolean);

  const candidates = scripts.map((script) => {
    if (script.includes("sources: [")) {
      return script
        .substring(script.indexOf("sources: [") + "sources: [".length)
        .split("],")[0]
        .replaceAll("'", "\"");
    }

    if (script.includes("otakudesu('")) {
      return script
        .substring(script.indexOf("otakudesu('") + "otakudesu('".length)
        .split("');")[0];
    }

    return null;
  }).filter(Boolean);

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);

    if (!Array.isArray(parsed)) {
      continue;
    }

    const streams = parsed
      .filter((item) => item && typeof item.file === "string")
      .map((item) => {
        const quality =
          item.label ||
          item.file.match(/(\d{3,4}p)/i)?.[1] ||
          "JWPlayer";

        return buildStream("Gnula", `${label} ${quality}`.trim(), item.file, url);
      });

    if (streams.length) {
      return streams;
    }
  }

  return [];
}
