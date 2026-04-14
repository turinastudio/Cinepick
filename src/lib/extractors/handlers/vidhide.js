import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities } from "../shared/html.js";
import { getAndUnpack } from "../shared/packer.js";
import { detectQuality } from "../shared/quality.js";

/**
 * Unpacker for VidHide's specific eval(p,a,c,k,e,d) format.
 * Based on Nuvio-Providers-Latino resolvers/vidhide.js
 */
function unpackVidHide(packed) {
  try {
    const match = packed.match(
      /eval\(function\(p,a,c,k,e,[rd]\)\{.*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/
    );
    if (!match) return null;

    let [, p, a, c, k] = match;
    a = parseInt(a);
    c = parseInt(c);
    k = k.split("|");

    const base = (num, b) => {
      const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
      let result = "";
      while (num > 0) {
        result = chars[num % b] + result;
        num = Math.floor(num / b);
      }
      return result || "0";
    };

    p = p.replace(/\b\w+\b/g, (word) => {
      const num = parseInt(word, 36);
      const replacement = num < k.length && k[num] ? k[num] : base(num, a);
      return replacement;
    });

    return p;
  } catch {
    return null;
  }
}

export async function extractVidHide(url, label) {
  const normalized = (() => {
    if (url.includes("/d/")) return url.replace("/d/", "/v/");
    if (url.includes("/download/")) return url.replace("/download/", "/v/");
    if (url.includes("/file/")) return url.replace("/file/", "/v/");
    if (url.includes("/f/")) return url.replace("/f/", "/v/");
    return url;
  })();

  const html = await fetchText(normalized, {
    Origin: normalized,
    Referer: normalized
  }).catch(() => "");

  if (!html) return [];

  // Strategy 1: Look for eval(...) block and unpack specifically for hls4/hls2
  const evalMatch = html.match(/eval\(function\(p,a,c,k,e,[rd]\)[\s\S]*?\.split\('\|'\)[^\)]*\)\)/);
  if (evalMatch) {
    const unpacked = unpackVidHide(evalMatch[0]);
    if (unpacked) {
      // Extract hls4 first, then hls2 as fallback
      const hls4Match = unpacked.match(/"hls4"\s*:\s*"([^"]+)"/);
      const hls2Match = unpacked.match(/"hls2"\s*:\s*"([^"]+)"/);
      const m3u8Relative = (hls4Match || hls2Match)?.[1];

      if (m3u8Relative) {
        let m3u8Url = m3u8Relative;
        if (!m3u8Relative.startsWith("http")) {
          const origin = new URL(normalized).origin;
          m3u8Url = `${origin}${m3u8Relative}`;
        }

        const quality = await detectQuality(m3u8Url, { Referer: normalized }).catch(() => "1080p");
        return [
          buildStream("Gnula", `${label} VidHide ${quality}`.trim(), decodeHtmlEntities(m3u8Url), {
            Referer: `${new URL(normalized).origin}/`,
            Origin: new URL(normalized).origin
          })
        ];
      }
    }
  }

  // Strategy 2: Look for packed script with generic getAndUnpack
  const scriptBodies = Array.from(
    html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1]
  ).filter(Boolean);

  const packedScript = scriptBodies.find((script) => script.includes("eval(function(p,a,c,k,e,d)"));
  if (packedScript) {
    const unpackedPackedScript = getAndUnpack(packedScript);
    const directPackedMatch = unpackedPackedScript.match(/"(https?:\/\/[^"]*?m3u8[^"]*?)"/i)?.[1];
    if (directPackedMatch) {
      return [
        buildStream("Gnula", `${label} VidHide HLS`.trim(), decodeHtmlEntities(directPackedMatch), normalized)
      ];
    }
  }

  // Strategy 3: Look for simple script with m3u8 and file: pattern
  const simpleScript = scriptBodies.find((script) => /m3u8/i.test(script));
  if (simpleScript) {
    const unpackedSimple = simpleScript.includes("eval(function(p,a,c")
      ? getAndUnpack(simpleScript)
      : simpleScript;
    const simpleMatch =
      unpackedSimple.match(/file\s*:\s*"([^"]+\.m3u8[^"]*)"/i)?.[1] ||
      unpackedSimple.match(/file\s*:\s*'([^']+\.m3u8[^']*)'/i)?.[1] ||
      unpackedSimple.match(/source[\s\S]*?file\s*:\s*"([^"]+\.m3u8[^"]*)"/i)?.[1] ||
      unpackedSimple.match(/source[\s\S]*?file\s*:\s*'([^']+\.m3u8[^']*)'/i)?.[1];

    if (simpleMatch) {
      return [
        buildStream("Gnula", `${label} VidHide HLS`.trim(), decodeHtmlEntities(simpleMatch), normalized)
      ];
    }
  }

  // Strategy 4: Generic fallback - combined search
  const unpackedScripts = scriptBodies.map((script) =>
    script.includes("eval(function(p,a,c") ? getAndUnpack(script) : script
  );

  const combined = [html, ...unpackedScripts].join("\n");
  const workingText = combined.includes("var links")
    ? combined.slice(combined.indexOf("var links"))
    : combined;

  const matches = Array.from(
    workingText.matchAll(/:\s*"(https?[^"]*?m3u8[^"]*)"/gi),
    (match) => decodeHtmlEntities(match[1])
  );

  return [...new Set(matches)].map((streamUrl) =>
    buildStream("Gnula", `${label} VidHide HLS`.trim(), streamUrl, normalized)
  );
}
