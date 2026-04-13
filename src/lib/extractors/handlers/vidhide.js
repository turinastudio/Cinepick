import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities } from "../shared/html.js";
import { getAndUnpack } from "../shared/packer.js";

export async function extractVidHide(url, label) {
  const normalized = (() => {
    if (url.includes("/d/")) {
      return url.replace("/d/", "/v/");
    }
    if (url.includes("/download/")) {
      return url.replace("/download/", "/v/");
    }
    if (url.includes("/file/")) {
      return url.replace("/file/", "/v/");
    }
    if (url.includes("/f/")) {
      return url.replace("/f/", "/v/");
    }
    return url;
  })();

  const html = await fetchText(normalized, {
    Origin: normalized,
    Referer: normalized
  });
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
