import { fetchText } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { isHttpUrl } from "../shared/html.js";
import { silentFallback } from "../shared/context.js";
import crypto from "node:crypto";

export async function extractStrp2p(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }

  if (!parsed.hash || parsed.hash.length < 2) {
    return [];
  }

  const apiUrl = `${parsed.origin}/api/v1/video?id=${encodeURIComponent(parsed.hash.slice(1))}`;
  const hexData = await fetchText(apiUrl, {
    Origin: parsed.origin,
    Referer: `${parsed.origin}/`
  }).catch(silentFallback("strp2p", null));

  if (!hexData) {
    return [];
  }

  try {
    const encrypted = Buffer.from(String(hexData).trim().slice(0, -1), "hex");
    const key = Buffer.from("6b69656d7469656e6d75613931316361", "hex");
    const iv = Buffer.from("313233343536373839306f6975797472", "hex");
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]).toString("utf8");
    const parsedJson = JSON.parse(decrypted);
    const streamUrl = String(parsedJson?.source || "").trim();

    if (!isHttpUrl(streamUrl)) {
      return [];
    }

    return [
      buildStream("Gnula", `${label} StrP2P`.trim(), streamUrl, {
        Origin: parsed.origin,
        Referer: `${parsed.origin}/`
      })
    ];
  } catch {
    return [];
  }
}
