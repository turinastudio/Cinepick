import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";

export async function extractStreamTape(url, label) {
  const normalized = url.includes("/e/")
    ? url
    : (() => {
        const parts = url.split("/");
        const id = parts[4];
        return id ? `https://streamtape.com/e/${id}` : url;
      })();

  const html = await fetchText(normalized);
  const script = html.match(/document\.getElementById\('robotlink'\).*?innerHTML\s*=\s*'([^']+)'.*?\+\s*\('xcd([^']+)'/is);

  if (!script) {
    return [];
  }

  const directUrl = `https:${script[1]}${script[2]}`;
  return [buildStream("Gnula", `${label} StreamTape`.trim(), directUrl, normalized)];
}
