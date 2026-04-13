import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { pickQualityLabel } from "../shared/html.js";
import { decryptVoePayload } from "../shared/crypto.js";
import { unpackWithDictionary } from "../shared/packer.js";

export async function extractVoe(url, label) {
  let html = await fetchText(url, { Referer: url });
  const redirectUrl = html.match(/window\.location\.href\s*=\s*'([^']+)'/i)?.[1];
  if (redirectUrl) {
    html = await fetchText(redirectUrl, { Referer: url });
  }

  const encodedArrayMatch = html.match(
    /json">\s*\[\s*['"]([^'"]+)['"]\s*\]\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i
  );

  if (encodedArrayMatch) {
    const encodedPayload = encodedArrayMatch[1];
    const loaderUrl = encodedArrayMatch[2].startsWith("http")
      ? encodedArrayMatch[2]
      : new URL(encodedArrayMatch[2], url).href;

    try {
      const loaderScript = await fetchText(loaderUrl, { Referer: url });
      const dictionaryMatch =
        loaderScript.match(/(\[(?:'[^']{1,10}'[\s,]*){4,12}\])/i) ||
        loaderScript.match(/(\[(?:"[^"]{1,10}"[,\s]*){4,12}\])/i);

      if (dictionaryMatch) {
        const dictionary = dictionaryMatch[1]
          .replace(/^\[/, "")
          .replace(/\]$/, "")
          .split(",")
          .map((item) => item.trim().replace(/^['"]|['"]$/g, ""));
        const payload = decryptVoePayload(
          encodedPayload.replace(/(@\$|\^\^|~@|%\?|\*~|!!|#&)/g, "_").includes("_")
            ? encodedPayload
            : encodedPayload
        );

        if (payload?.source || payload?.direct_access_url) {
          const streams = [];
          if (payload.source) {
            streams.push(buildStream("Gnula", `${label} Voe HLS`.trim(), payload.source, url));
          }
          if (payload.direct_access_url) {
            streams.push(buildStream("Gnula", `${label} Voe MP4`.trim(), payload.direct_access_url, url));
          }
          if (streams.length) {
            return streams;
          }
        }

        const unpacked = unpackWithDictionary(encodedPayload, dictionary.length || 62, dictionary);
        const loaderUrlMatch = unpacked.match(/https?[^"'\\\s]+(?:master\.m3u8|\.m3u8|\.mp4)[^"'\\\s]*/i);
        if (loaderUrlMatch) {
          return [buildStream("Gnula", `${label} Voe Loader`.trim(), loaderUrlMatch[0], url)];
        }
      }
    } catch {
      // Continue into the rest of the Voe strategies.
    }
  }

  const encoded = html.match(/<script[^>]+type=["']application\/json["'][^>]*>\s*(.+?)\s*<\/script>/is)?.[1]
    ?.trim()
    ?.replace(/^\["/, "")
    ?.replace(/"\]$/, "");

  if (!encoded) {
    const fallbackMatches = [
      ...Array.from(html.matchAll(/(?:mp4|hls)'\s*:\s*'([^']+)'/gi), (match) => match[1]),
      ...Array.from(html.matchAll(/(?:mp4|hls)"\s*:\s*"([^"]+)"/gi), (match) => match[1])
    ];
    const streams = [];

    for (let candidate of fallbackMatches) {
      if (!candidate) {
        continue;
      }

      if (candidate.startsWith("aHR0")) {
        try {
          candidate = Buffer.from(candidate, "base64").toString("utf8");
        } catch {
          continue;
        }
      }

      streams.push(buildStream("Gnula", `${label} Voe Fallback`.trim(), candidate, url));
    }

    return streams;
  }

  const payload = decryptVoePayload(encoded);
  const streams = [];

  if (payload.source) {
    streams.push(buildStream("Gnula", `${label} Voe HLS`.trim(), payload.source, url));
  }

  if (payload.direct_access_url) {
    streams.push(buildStream("Gnula", `${label} Voe MP4`.trim(), payload.direct_access_url, url));
  }

  return streams;
}
