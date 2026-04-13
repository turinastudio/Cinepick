import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { decodeHtmlEntities } from "../shared/html.js";

export async function extractYourUpload(url, label) {
  const html = await fetchText(url, { referer: "https://www.yourupload.com/" });
  const directUrl = html.match(/file:\s*'([^']+)'/i)?.[1];

  if (!directUrl) {
    return [];
  }

  return [buildStream("Gnula", `${label} YourUpload`.trim(), decodeHtmlEntities(directUrl), url)];
}
