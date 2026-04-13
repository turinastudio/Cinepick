import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities } from "../shared/html.js";
import { unpackWithDictionary } from "../shared/packer.js";

export async function extractVimeos(url, label) {
  const html = await fetchText(url, {
    Referer: "https://vimeos.net/"
  });
  const packedMatch = html.match(
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]+?\}\('([\s\S]+?)',(\d+),(\d+),'([\s\S]+?)'\.split\('\|'\)/i
  );

  if (!packedMatch) {
    return [];
  }

  const unpacked = unpackWithDictionary(
    packedMatch[1],
    Number.parseInt(packedMatch[2], 10),
    packedMatch[4].split("|")
  );
  const m3u8 = unpacked.match(/["']([^"']+\.m3u8[^"']*)['"]/i)?.[1];

  if (!m3u8) {
    return [];
  }

  return [
    buildStream("Gnula", `${label} Vimeos`.trim(), decodeHtmlEntities(m3u8), {
      Referer: "https://vimeos.net/"
    })
  ];
}
