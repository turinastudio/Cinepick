import { fetchText, fetchJson, fetchWithTimeout } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { pickQualityLabel, decodeHtmlEntities, isHttpUrl } from "../shared/html.js";
import { decodeBase64Url } from "../shared/crypto.js";
import { getAndUnpack } from "../shared/packer.js";
import { silentFallback } from "../shared/context.js";
import crypto from "node:crypto";

export async function extractStreamWish(url, label) {
  const hostRewrites = {
    "hglink.to": "vibuxer.com"
  };
  const normalized = url.includes("/f/")
    ? `https://streamwish.com/${url.split("/f/")[1]}`
    : url;
  const rewritten = (() => {
    for (const [fromHost, toHost] of Object.entries(hostRewrites)) {
      if (normalized.includes(fromHost)) {
        return normalized.replace(fromHost, toHost);
      }
    }
    return normalized;
    })();
  const refererHost = new URL(rewritten).host;
  const embedCode = (() => {
    try {
      const parts = new URL(rewritten).pathname.replace(/\/+$/, "").split("/").filter(Boolean);
      const markerIndex = parts.findIndex((part) => part === "e" || part === "embed");

      if (markerIndex >= 0 && parts[markerIndex + 1]) {
        return parts[markerIndex + 1];
      }

      return parts.at(-1) || "";
    } catch {
      return "";
    }
  })();

  if (embedCode) {
    try {
      const parsed = new URL(rewritten);
      const apiHeaders = {
        Referer: rewritten,
        Origin: parsed.origin,
        Accept: "application/json, text/plain, */*"
      };
      const playback = await fetchJson(
        `${parsed.origin}/api/videos/${encodeURIComponent(embedCode)}/embed/playback`,
        apiHeaders
      ).catch(silentFallback("streamwish", null));
      const payload = playback?.playback || playback;

      if (payload?.iv && payload?.payload && Array.isArray(payload.key_parts) && payload.key_parts.length > 0) {
        const key = Buffer.concat(payload.key_parts.map((part) => decodeBase64Url(part)));
        const iv = decodeBase64Url(payload.iv);
        const encryptedPayload = decodeBase64Url(payload.payload);
        const tag = encryptedPayload.subarray(encryptedPayload.length - 16);
        const encrypted = encryptedPayload.subarray(0, encryptedPayload.length - 16);
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        const media = JSON.parse(Buffer.concat([
          decipher.update(encrypted),
          decipher.final()
        ]).toString("utf8"));
        const sources = Array.isArray(media?.sources)
          ? media.sources.filter((source) => source?.url)
          : [];

        if (sources.length > 0) {
          const bestSource = [...sources].sort((left, right) => {
            const leftHeight = parseInt(left.height || String(left.label || "").replace(/\D+/g, ""), 10) || 0;
            const rightHeight = parseInt(right.height || String(right.label || "").replace(/\D+/g, ""), 10) || 0;
            const leftBitrate = parseInt(left.bitrate_kbps, 10) || 0;
            const rightBitrate = parseInt(right.bitrate_kbps, 10) || 0;

            if (rightHeight !== leftHeight) {
              return rightHeight - leftHeight;
            }

            return rightBitrate - leftBitrate;
          })[0];

          if (bestSource?.url) {
            const quality = bestSource.height
              ? `${bestSource.height}p`
              : pickQualityLabel(String(bestSource.label || bestSource.url), "Auto");

            return [
              buildStream(
                "Gnula",
                `${label} StreamWish ${quality}`.trim(),
                bestSource.url.startsWith("http")
                  ? bestSource.url
                  : new URL(bestSource.url, parsed.origin).href,
                {
                  Referer: rewritten,
                  Origin: parsed.origin
                }
              )
            ];
          }
        }
      }
    } catch {
      // Fall back to the older HTML-based extraction below.
    }
  }

  let html = await fetchText(rewritten, {
    Origin: rewritten,
    Referer: rewritten
  });
  const directFileMatch = html.match(/file\s*:\s*["']([^"']+)["']/i)?.[1];

  if (directFileMatch) {
    let resolvedUrl = decodeHtmlEntities(directFileMatch);

    if (resolvedUrl.startsWith("/")) {
      resolvedUrl = `https://${refererHost}${resolvedUrl}`;
    }

    if (/vibuxer\.com\/stream\//i.test(resolvedUrl)) {
      try {
        const redirected = await fetchWithTimeout(resolvedUrl, {
          headers: {
            Referer: `https://${refererHost}/`,
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
          },
          redirect: "follow"
        });
        if (redirected.url && /\.m3u8/i.test(redirected.url)) {
          resolvedUrl = redirected.url;
        }
      } catch {
        // Keep the original candidate when the redirect follow fails.
      }
    }

    if (isHttpUrl(resolvedUrl) && /\.m3u8(\?|$)/i.test(resolvedUrl)) {
      return [
        buildStream("Gnula", `${label} StreamWish HLS`.trim(), resolvedUrl, `https://${refererHost}/`)
      ];
    }
  }

  const scriptBodies = Array.from(
    html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1]
  );

  const processedScripts = scriptBodies
    .filter(Boolean)
    .map((script) => script.includes("eval(function(p,a,c") ? getAndUnpack(script) : script);

  const combined = [html, ...processedScripts].join("\n");
  const m3u8 =
    combined.match(/https:\/\/[^"'\\\s]+\.m3u8(?:\?[^"'\\\s]*)?/i)?.[0] ||
    combined.match(/file\s*:\s*"([^"]+\.m3u8[^"]*)"/i)?.[1] ||
    combined.match(/file\s*:\s*'([^']+\.m3u8[^']*)'/i)?.[1];

  const normalizedM3u8 = decodeHtmlEntities(m3u8 || "");

  if (!normalizedM3u8 || !isHttpUrl(normalizedM3u8)) {
    return [];
  }

  return [buildStream("Gnula", `${label} StreamWish HLS`.trim(), normalizedM3u8, `https://${refererHost}/`)];
}
