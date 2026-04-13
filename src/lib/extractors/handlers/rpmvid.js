import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities } from "../shared/html.js";
import { silentFallback } from "../shared/context.js";
import crypto from "node:crypto";

export async function extractRpmVid(url, label) {
  const normalized = String(url || "").trim();
  if (!normalized) {
    return [];
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalized);
  } catch {
    return [];
  }

  const hash = (() => {
    if (parsedUrl.hash && parsedUrl.hash.length > 1) {
      return parsedUrl.hash.slice(1);
    }

    const parts = parsedUrl.pathname.split("/").filter(Boolean);
    return parts.at(-1) || "";
  })();

  if (!hash) {
    return [];
  }

  const apiUrl = `${parsedUrl.origin}/api/v1/video?id=${encodeURIComponent(hash)}`;
  const encoded = await fetchText(apiUrl, {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0"
  }).then((text) => String(text || "").trim()).catch(silentFallback("rpmvid", ""));

  if (!encoded) {
    return [];
  }

  const key = Buffer.from("kiemtienmua911ca", "utf8");
  const ivCandidates = ["1234567890oiuytr", "0123456789abcdef"];
  let decryptedText = "";

  for (const ivText of ivCandidates) {
    try {
      const decipher = crypto.createDecipheriv(
        "aes-128-cbc",
        key,
        Buffer.from(ivText, "utf8")
      );
      decryptedText = Buffer.concat([
        decipher.update(Buffer.from(encoded, "hex")),
        decipher.final()
      ]).toString("utf8");
      if (decryptedText) {
        break;
      }
    } catch {
      // Try next IV.
    }
  }

  if (!decryptedText) {
    return [];
  }

  const sourceUrl = decryptedText.match(/"source":"(.*?)"/i)?.[1]?.replace(/\\\//g, "/") || "";
  if (!sourceUrl) {
    return [];
  }

  const subtitleSection = decryptedText.match(/"subtitle":\{(.*?)\}/i)?.[1] || "";
  const subtitles = Array.from(
    subtitleSection.matchAll(/"([^"]+)":\s*"([^"]+)"/g),
    (match) => ({
      id: match[1],
      url: decodeHtmlEntities(match[2].split("#")[0].replace(/\\\//g, "/"))
    })
  ).filter((item) => item.url);

  const stream = buildStream(
    "Gnula",
    `${label} RpmVid`.trim(),
    sourceUrl.replace(/^https:/i, "http:"),
    {
      Referer: normalized,
      Origin: parsedUrl.origin
    }
  );

  if (subtitles.length > 0) {
    stream.subtitles = subtitles;
  }

  return [stream];
}
