import { fetchText, fetchWithTimeout } from "../shared/http.js";
import { buildStream } from "../public-builders.js";
import { pickQualityLabel } from "../shared/html.js";
import { decryptVoePayload } from "../shared/crypto.js";
import { unpackWithDictionary } from "../shared/packer.js";
import { getRandomUserAgent } from "../../user-agents.js";

function mergeResponseCookies(cookieJar, response) {
  const rawCookies =
    (typeof response?.headers?.getSetCookie === "function" && response.headers.getSetCookie()) ||
    (response?.headers?.get("set-cookie") ? [response.headers.get("set-cookie")] : []);

  for (const rawCookie of rawCookies) {
    const pair = String(rawCookie || "").split(";")[0]?.trim();
    if (!pair || !pair.includes("=")) {
      continue;
    }
    const separatorIndex = pair.indexOf("=");
    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (name) {
      cookieJar.set(name, value);
    }
  }
}

function buildCookieHeader(cookieJar) {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function isDdosGuardResponse(response) {
  return Number(response?.status) === 403 && /ddos-guard/i.test(String(response?.headers?.get("server") || ""));
}

async function fetchDdosGuardCookie(url, { userAgent, referer, cookieJar }) {
  const checkScriptResponse = await fetchWithTimeout("https://check.ddos-guard.net/check.js", {
    headers: {
      "user-agent": userAgent,
      accept: "*/*",
      Referer: referer || url
    },
    redirect: "follow"
  });

  if (!checkScriptResponse.ok) {
    return false;
  }

  const checkScript = await checkScriptResponse.text();
  const suffix = checkScript.match(/'([^']+)'/)?.[1];

  if (!suffix) {
    return false;
  }

  const target = new URL(url);
  const challengeUrl = `${target.protocol}//${target.host}${suffix}`;
  const cookieHeader = buildCookieHeader(cookieJar);
  const challengeResponse = await fetchWithTimeout(challengeUrl, {
    headers: {
      "user-agent": userAgent,
      accept: "*/*",
      Referer: `${target.protocol}//${target.host}/`,
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    },
    redirect: "follow"
  });

  mergeResponseCookies(cookieJar, challengeResponse);
  return cookieJar.has("__ddg2_");
}

async function fetchVoePage(url, { referer, userAgent, cookieJar }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = {
      "user-agent": userAgent,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: referer || url
    };
    const cookieHeader = buildCookieHeader(cookieJar);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    const response = await fetchWithTimeout(url, {
      headers,
      redirect: "follow"
    });

    if (isDdosGuardResponse(response) && attempt === 0) {
      const solved = await fetchDdosGuardCookie(url, { userAgent, referer, cookieJar }).catch(() => false);
      if (solved) {
        continue;
      }
    }

    if (!response.ok) {
      throw new Error(`Extractor respondio ${response.status} para ${url}`);
    }

    mergeResponseCookies(cookieJar, response);
    return response.text();
  }

  throw new Error(`Extractor no pudo resolver DDos-Guard para ${url}`);
}

export async function extractVoe(url, label) {
  const userAgent = getRandomUserAgent();
  const cookieJar = new Map();
  let html = await fetchVoePage(url, {
    referer: url,
    userAgent,
    cookieJar
  });
  const redirectUrl = html.match(/window\.location\.href\s*=\s*'([^']+)'/i)?.[1];
  if (redirectUrl) {
    html = await fetchVoePage(redirectUrl, {
      referer: url,
      userAgent,
      cookieJar
    });
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
