import crypto from "node:crypto";

// Cloudstream is the source of truth for extractor behavior.
// These implementations are JS ports/adaptations of Cloudstream extractors
// for use inside this Stremio addon runtime.

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function getHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostIncludes(host, aliases) {
  return aliases.some((alias) => host.includes(alias));
}

function pickQualityLabel(text, fallback = "") {
  const match = text.match(/(\d{3,4})p/i);
  return match ? `${match[1]}p` : fallback;
}

function normalizeRequestHeaders(input) {
  if (!input) {
    return {};
  }

  if (typeof input === "string") {
    return {
      Referer: input,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    };
  }

  if (typeof input === "object") {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      ...input
    };
  }

  return {};
}

function buildBehaviorHints(url, requestHeaders = null) {
  const behaviorHints = {};
  const normalizedHeaders = normalizeRequestHeaders(requestHeaders);

  if (/\.m3u8(\?|$)/i.test(url)) {
    behaviorHints.notWebReady = true;
  }

  if (Object.keys(normalizedHeaders).length > 0) {
    behaviorHints.proxyHeaders = {
      request: normalizedHeaders
    };
  }

  return Object.keys(behaviorHints).length > 0 ? behaviorHints : undefined;
}

export function buildProxiedUrl(targetUrl, requestHeaders = null) {
  const payload = {
    url: targetUrl,
    headers: normalizeRequestHeaders(requestHeaders)
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const base = (process.env.ADDON_URL || "").replace(/\/$/, "");
  const extensionMatch = String(targetUrl || "").match(/(\.m3u8|\.mp4|\.ts|\.m4s|\.key|\.bin)(?:\?|$)/i);
  const extension = extensionMatch?.[1]?.toLowerCase() || ".bin";
  return `${base}/p/${b64}${extension}`;
}

export function buildStream(name, title, url, requestHeaders = null, shouldProxy = false) {
  const normalizedHeaders = normalizeRequestHeaders(requestHeaders);
  const finalUrl = shouldProxy ? buildProxiedUrl(url, normalizedHeaders) : url;
  const stream = { name, title, url: finalUrl };
  const behaviorHints = buildBehaviorHints(url, normalizedHeaders);

  if (shouldProxy || Object.keys(normalizedHeaders).length > 0) {
    stream._proxyHeaders = normalizedHeaders;
  }

  stream._targetUrl = url;

  if (behaviorHints) {
    if (shouldProxy) {
      // When proxying, our server handles the upstream headers.
      delete behaviorHints.proxyHeaders;
    }
    if (Object.keys(behaviorHints).length > 0) {
      stream.behaviorHints = behaviorHints;
    }
  }

  return stream;
}

function buildExternal(name, title, externalUrl) {
  return { name, title, externalUrl };
}

function extractInlineCookieHeader(html) {
  const cookiePairs = [];
  const pattern = /\$\.cookie\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]/g;
  let match;

  while ((match = pattern.exec(String(html || "")))) {
    cookiePairs.push(`${match[1]}=${match[2]}`);
  }

  return cookiePairs.join("; ");
}

const packedRegex = /eval\(function\(p,a,c,k,e,.*\)\)/i;

function getPacked(text) {
  return packedRegex.test(text) ? packedRegex.exec(text)?.[0] || null : null;
}

function createUnbase(radix) {
  const alphabet62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const alphabet95 = " !\"#$%&\\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";

  if (radix <= 36) {
    return (value) => Number.parseInt(value, radix);
  }

  let alphabet = null;

  if (radix < 62) {
    alphabet = alphabet62.slice(0, radix);
  } else if (radix >= 63 && radix <= 94) {
    alphabet = alphabet95.slice(0, radix);
  } else if (radix === 62) {
    alphabet = alphabet62;
  } else if (radix === 95) {
    alphabet = alphabet95;
  }

  if (!alphabet) {
    return (value) => Number.parseInt(value, radix);
  }

  const dictionary = new Map(Array.from(alphabet).map((char, index) => [char, index]));

  return (value) => {
    const reversed = value.split("").reverse();
    return reversed.reduce((acc, char, index) => {
      const mapped = dictionary.get(char);
      return acc + (mapped ?? 0) * (radix ** index);
    }, 0);
  };
}

function unpackPackerScript(script) {
  if (!script) {
    return null;
  }

  const packedMatch = script.match(/\}\s*\('(.*)',\s*(.*?),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/s);

  if (!packedMatch) {
    return null;
  }

  const payload = packedMatch[1]?.replaceAll("\\'", "'") || "";
  const radix = Number.parseInt(packedMatch[2], 10) || 36;
  const count = Number.parseInt(packedMatch[3], 10) || 0;
  const symtab = (packedMatch[4] || "").split("|");

  if (symtab.length !== count) {
    return null;
  }

  const unbase = createUnbase(radix);
  const wordPattern = /\b[a-zA-Z0-9_]+\b/g;
  let decoded = payload;
  let offset = 0;

  for (const match of payload.matchAll(wordPattern)) {
    const word = match[0];
    const start = match.index ?? 0;
    const end = start + word.length;
    const index = unbase(word);
    const replacement = index >= 0 && index < symtab.length ? symtab[index] : null;

    if (!replacement) {
      continue;
    }

    decoded =
      decoded.slice(0, start + offset) +
      replacement +
      decoded.slice(end + offset);
    offset += replacement.length - word.length;
  }

  return decoded;
}

function getAndUnpack(text) {
  const packed = getPacked(text);
  if (!packed) {
    return text;
  }

  return unpackPackerScript(packed) || text;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...headers
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`Extractor respondio ${response.status} para ${url}`);
  }

  return response.text();
}

async function extractMp4Upload(url, label) {
  const html = await fetchText(url, { referer: "https://mp4upload.com/" });
  const directUrl =
    html.match(/player\.src\(\s*{\s*type:\s*"[^"]+"\s*,\s*src:\s*"([^"]+)"/is)?.[1] ||
    html.match(/src:\s*"([^"]+\.m3u8[^"]*)"/is)?.[1] ||
    html.match(/src:\s*"([^"]+\.mp4[^"]*)"/is)?.[1];

  if (!directUrl) {
    return [];
  }

  const quality = pickQualityLabel(html, "video");
  return [buildStream("Gnula", `${label} Mp4Upload ${quality}`.trim(), decodeHtmlEntities(directUrl), url)];
}

async function extractYourUpload(url, label) {
  const html = await fetchText(url, { referer: "https://www.yourupload.com/" });
  const directUrl = html.match(/file:\s*'([^']+)'/i)?.[1];

  if (!directUrl) {
    return [];
  }

  return [buildStream("Gnula", `${label} YourUpload`.trim(), decodeHtmlEntities(directUrl), url)];
}

async function extractStreamTape(url, label) {
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

async function extractDood(url, label) {
  const response = await fetch(url, { redirect: "follow" });
  const resolvedUrl = response.url;
  const html = await response.text();

  const md5Path = html.match(/\/pass_md5\/[^']+/i)?.[0];
  if (!md5Path) {
    return [];
  }

  const resolved = new URL(resolvedUrl);
  const md5Url = `${resolved.protocol}//${resolved.host}${md5Path}`;
  const token = md5Url.split("/").pop();
  const randomString = Array.from({ length: 10 }, () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return chars[Math.floor(Math.random() * chars.length)];
  }).join("");
  const expiry = Date.now();
  const prefix = await fetchText(md5Url, { referer: resolvedUrl });
  const directUrl = `${prefix}${randomString}?token=${token}&expiry=${expiry}`;
  const quality = pickQualityLabel(html, "video");

  return [buildStream("Gnula", `${label} Doodstream ${quality}`.trim(), directUrl, `${resolved.protocol}//${resolved.host}/`)];
}

function rot13(input) {
  return input.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= "Z" ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function base64DecodeLatin1(input) {
  return Buffer.from(input, "base64").toString("latin1");
}

function decryptVoePayload(input) {
  const patternsRegex = /@\$|\^\^|~@|%\?|\*~|!!|#&/g;
  const v1 = rot13(input);
  const v2 = v1.replace(patternsRegex, "_");
  const v3 = v2.replaceAll("_", "");
  const v4 = base64DecodeLatin1(v3);
  const v5 = Array.from(v4, (char) => String.fromCharCode(char.charCodeAt(0) - 3)).join("");
  const v6 = v5.split("").reverse().join("");
  const decoded = base64DecodeLatin1(v6);
  return JSON.parse(decoded);
}

async function extractVoe(url, label) {
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

async function extractStreamWish(url, label) {
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
        const redirected = await fetch(resolvedUrl, {
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

function unpackWithDictionary(payload, radix, dictionary) {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const decodeWord = (word) => {
    let value = 0;
    for (const char of word) {
      const digit = alphabet.indexOf(char);
      if (digit < 0) {
        return Number.NaN;
      }
      value = (value * radix) + digit;
    }
    return value;
  };

  return payload.replace(/\b(\w+)\b/g, (word) => {
    const decodedIndex = decodeWord(word);
    if (Number.isNaN(decodedIndex)) {
      return word;
    }
    return dictionary[decodedIndex] && dictionary[decodedIndex] !== ""
      ? dictionary[decodedIndex]
      : word;
  });
}

async function extractVimeos(url, label) {
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

function decodeBase64Url(input) {
  const base64 = String(input)
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const padding = base64.length % 4 === 2 ? "==" : base64.length % 4 === 3 ? "=" : "";
  return Buffer.from(base64 + padding, "base64");
}

function decryptFilemoonPlayback(playback) {
  const key = Buffer.concat((playback.key_parts || []).map((part) => decodeBase64Url(part)));
  const iv = decodeBase64Url(playback.iv);
  const payload = decodeBase64Url(playback.payload);
  const tag = payload.subarray(payload.length - 16);
  const encrypted = payload.subarray(0, payload.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

async function extractFilemoon(url, label) {
  let workingUrl = url;
  let parsed = new URL(workingUrl);
  const initialHtml = await fetchText(workingUrl, {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    Priority: "u=0, i",
    Origin: workingUrl,
    Referer: workingUrl
  });
  const iframeMatch = initialHtml.match(/<iframe\s+[^>]*src=["'](https?:\/\/[^"']+)["'][^>]*>/i);
  if (iframeMatch?.[1]) {
    workingUrl = iframeMatch[1];
    parsed = new URL(workingUrl);
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const mediaId = segments[0] === "e" ? segments[1] : segments.at(-1);

  if (!mediaId) {
    return [];
  }

  const detailsText = await fetchText(`https://${parsed.host}/api/videos/${mediaId}/embed/details`);
  const embedUrl = detailsText.match(/"embed_frame_url"\s*:\s*"([^"]+)"/i)?.[1];

  if (!embedUrl) {
    return [];
  }

  const embedHost = new URL(embedUrl).host;
  const playbackText = await fetchText(`https://${embedHost}/api/videos/${mediaId}/embed/playback`, {
    Referer: embedUrl,
    "X-Embed-Origin": parsed.host,
    "X-Embed-Parent": workingUrl,
    "X-Embed-Referer": workingUrl,
    Accept: "*/*",
    "Accept-Language": "es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin"
  });

  let playbackJson = JSON.parse(playbackText);
  let sources = playbackJson.sources;

  if ((!sources || !sources.length) && playbackJson.playback) {
    const decrypted = decryptFilemoonPlayback(playbackJson.playback);
    playbackJson = JSON.parse(decrypted);
    sources = playbackJson.sources;
  }

  if (!sources?.length) {
    return [];
  }

  return sources
    .map((source) => {
      const streamUrl = source.url || source.file;
      if (!streamUrl) {
        return null;
      }

      const quality = source.label || "HLS";
      return buildStream("Gnula", `${label} Filemoon ${quality}`.trim(), streamUrl, `https://${parsed.host}/`);
    })
    .filter(Boolean);
}

async function extractVidHide(url, label) {
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

async function extractGenericM3u8Page(url, label) {
  const html = await fetchText(url);
  const directMatches = Array.from(
    html.matchAll(/https?[^"'\\\s]+(?:master\.m3u8|\.m3u8)[^"'\\\s]*/gi),
    (match) => decodeHtmlEntities(match[0])
  );

  if (directMatches.length) {
    return [...new Set(directMatches)].map((streamUrl) =>
      buildStream("Gnula", `${label} GenericM3U8`.trim(), streamUrl, url)
    );
  }

  const manifestMatch = html.match(/\{[^{}]*"auto"\s*:\s*"[^"]+m3u8[^"]*"[^{}]*\}/i);
  const manifestJson = manifestMatch ? tryParseJson(decodeHtmlEntities(manifestMatch[0])) : null;

  if (!manifestJson || typeof manifestJson !== "object") {
    return [];
  }

  return Object.entries(manifestJson)
    .filter(([, streamUrl]) => typeof streamUrl === "string" && /m3u8/i.test(streamUrl))
    .map(([quality, streamUrl]) => {
      const normalizedQuality = quality === "auto"
        ? "Auto"
        : quality.endsWith("p") ? quality : `${quality}p`;
      return buildStream("Gnula", `${label} ${normalizedQuality}`.trim(), decodeHtmlEntities(streamUrl), url);
    });
}

async function extractJWPlayer(url, label) {
  const html = await fetchText(url);
  const scripts = Array.from(
    html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1]
  ).filter(Boolean);

  const candidates = scripts.map((script) => {
    if (script.includes("sources: [")) {
      return script
        .substring(script.indexOf("sources: [") + "sources: [".length)
        .split("],")[0]
        .replaceAll("'", "\"");
    }

    if (script.includes("otakudesu('")) {
      return script
        .substring(script.indexOf("otakudesu('") + "otakudesu('".length)
        .split("');")[0];
    }

    return null;
  }).filter(Boolean);

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);

    if (!Array.isArray(parsed)) {
      continue;
    }

    const streams = parsed
      .filter((item) => item && typeof item.file === "string")
      .map((item) => {
        const quality =
          item.label ||
          item.file.match(/(\d{3,4}p)/i)?.[1] ||
          "JWPlayer";

        return buildStream("Gnula", `${label} ${quality}`.trim(), item.file, url);
      });

    if (streams.length) {
      return streams;
    }
  }

  return [];
}

async function extractNetuHqq(url, label) {
  const normalizedUrl = (() => {
    if (/\/f\//i.test(url)) {
      return url.replace(/\/f\//i, "/e/");
    }
    return url;
  })();

  let html = await fetchText(normalizedUrl, { Referer: normalizedUrl });
  const iframeUrl =
    html.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] ||
    html.match(/location\.href\s*=\s*["']([^"']+)["']/i)?.[1];

  if (iframeUrl) {
    const resolvedIframeUrl = iframeUrl.startsWith("http")
      ? iframeUrl
      : new URL(iframeUrl, normalizedUrl).href;
    html = await fetchText(resolvedIframeUrl, { Referer: normalizedUrl });
  }

  const directMatches = Array.from(
    html.matchAll(/https?[^"'\\\s]+(?:master\.m3u8|\.m3u8)[^"'\\\s]*/gi),
    (match) => decodeHtmlEntities(match[0])
  );

  if (directMatches.length) {
    return [...new Set(directMatches)].map((streamUrl) =>
      buildStream("Gnula", `${label} Netu HLS`.trim(), streamUrl, normalizedUrl)
    );
  }

  const cfMatch = html.match(/https?:\/\/[^"'\\\s]*cfglobalcdn\.com[^"'\\\s]*\.m3u8[^"'\\\s]*/i);
  if (cfMatch) {
    return [buildStream("Gnula", `${label} Netu HLS`.trim(), decodeHtmlEntities(cfMatch[0]), normalizedUrl)];
  }

  return [];
}

async function extractUqload(url, label) {
  const normalizedUrl = (() => {
    if (/uqload\.(is|co|ws)\//i.test(url) && !/^https?:\/\/www\./i.test(url)) {
      return url.replace(/^(https?:\/\/)(?!www\.)/i, "$1www.");
    }
    return url;
  })();
  const html = await fetchText(normalizedUrl, {
    Referer: normalizedUrl,
    Origin: normalizedUrl
  });
  const scriptMatch =
    html.match(/sources:\s*\[\s*"([^"]+)"/i) ||
    html.match(/sources:\s*\[\s*'([^']+)'/i) ||
    html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/i) ||
    html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*'([^']+)'/i) ||
    html.match(/file:\s*"([^"]+)"/i) ||
    html.match(/file:\s*'([^']+)'/i);

  const videoUrl = decodeHtmlEntities(scriptMatch?.[1] || "").trim();
  if (!isHttpUrl(videoUrl)) {
    return [];
  }

  return [buildStream("Gnula", `${label} Uqload`.trim(), videoUrl, "https://uqload.ws/")];
}

async function extractGoodstream(url, label) {
  const pageUrl = url;
  const html = await fetchText(pageUrl, {
    Referer: pageUrl,
    Origin: new URL(pageUrl).origin
  });

  if (/expired|deleted|file is no longer available/i.test(html)) {
    return [];
  }

  const fileMatch =
    html.match(/sources:\s*\[\s*\{\s*file:"([^"]+\.m3u8[^"]*)"/i) ||
    html.match(/sources:\s*\[\s*\{\s*file:'([^']+\.m3u8[^']*)'/i) ||
    html.match(/file:"([^"]+\.m3u8[^"]*)"/i) ||
    html.match(/file:'([^']+\.m3u8[^']*)'/i);

  if (!fileMatch) {
    return [];
  }

  const playlistUrl = decodeHtmlEntities(fileMatch[1].replace(/\\\//g, "/"));
  const cookieHeader = extractInlineCookieHeader(html);
  const pageOrigin = new URL(pageUrl).origin;
  const headers = {
    Referer: pageUrl,
    Origin: pageOrigin,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const viewMatch = html.match(/\/dl\?op=view&view_id=(\d+)&hash=([a-z0-9-]+)/i);
  if (viewMatch) {
    const beaconUrl = new URL(`/dl?op=view&view_id=${viewMatch[1]}&hash=${viewMatch[2]}&adb=0`, pageOrigin).href;
    await fetchText(beaconUrl, { ...headers }).catch(() => null);
  }

  return [buildStream("Gnula", `${label} Goodstream`.trim(), playlistUrl, headers)];
}

const extractorRegistry = [
  {
    id: "mp4upload",
    source: "cloudstream",
    aliases: ["mp4upload"],
    resolve: extractMp4Upload
  },
  {
    id: "yourupload",
    source: "cloudstream",
    aliases: ["yourupload"],
    resolve: extractYourUpload
  },
  {
    id: "streamtape",
    source: "cloudstream",
    aliases: ["streamtape", "stape", "shavetape"],
    resolve: extractStreamTape
  },
  {
    id: "dood",
    source: "cloudstream",
    aliases: ["dood", "ds2play", "ds2video", "dooood", "d000d", "d0000d"],
    resolve: extractDood
  },
  {
    id: "voe",
    source: "cloudstream",
    aliases: [
      "voe", "tubelessceliolymph", "simpulumlamerop", "urochsunloath",
      "nathanfromsubject", "yip", "metagnathtuggers", "donaldlineelse"
    ],
    resolve: extractVoe
  },
  {
    id: "streamwish",
    source: "cloudstream",
    aliases: [
      "wishembed", "streamwish", "strwish", "streamgg", "kswplayer",
      "swhoi", "multimovies", "uqloads", "neko-stream", "swdyu", "iplayerhls",
      "hlswish", "hanerix"
    ],
    resolve: extractStreamWish
  },
  {
    id: "filemoon",
    source: "cloudstream",
    aliases: ["filemoon", "moonplayer", "moviesm4u", "files.im"],
    resolve: extractFilemoon
  },
  {
    id: "vimeos",
    source: "cinecalidad-addon-inspired",
    aliases: ["vimeos"],
    resolve: extractVimeos
  },
  {
    id: "vidhide",
    source: "cloudstream",
    aliases: [
      "ahvsh", "streamhide", "guccihide", "streamvid", "vidhide", "kinoger",
      "smoothpre", "dhtpre", "peytonepre", "earnvids", "ryderjet", "vidhidehub",
      "filelions", "vidhidevip", "vidhidepre", "cvid"
    ],
    resolve: extractVidHide
  },
  {
    id: "netu",
    source: "project-local",
    aliases: ["hqq", "netu", "waaw", "waaw.tv"],
    resolve: extractNetuHqq
  },
  {
    id: "uqload",
    source: "project-local",
    aliases: ["uqload", "uqload.is"],
    resolve: extractUqload
  },
  {
    id: "goodstream",
    source: "northstar-inspired",
    aliases: ["goodstream"],
    resolve: extractGoodstream
  }
];

export function getExtractorRegistry() {
  return extractorRegistry.map((extractor) => ({
    id: extractor.id,
    source: extractor.source,
    aliases: [...extractor.aliases]
  }));
}

export function matchExtractorByUrl(url) {
  const host = getHost(url);
  return extractorRegistry.find((extractor) => hostIncludes(host, extractor.aliases)) || null;
}

export async function resolveExtractorStream(url, label, shouldProxy = false) {
  const matchedExtractor = matchExtractorByUrl(url);
  let streams = [];

  try {
    if (matchedExtractor) {
      streams = await matchedExtractor.resolve(url, label);
    } else if (/\.(m3u8|mp4)(\?|$)/i.test(url)) {
      streams = [buildStream("Gnula", label, url, null)];
    } else {
      const genericM3u8 = await extractGenericM3u8Page(url, label);
      if (genericM3u8.length) {
        streams = genericM3u8;
      } else {
        const jwPlayer = await extractJWPlayer(url, label);
        if (jwPlayer.length) {
          streams = jwPlayer;
        }
      }
    }
  } catch {
    return [];
  }

  if (shouldProxy && streams.length > 0) {
    return streams.map((stream) => {
      if (stream.url && !/\/p\//.test(stream.url)) {
        const upstreamHeaders =
          stream._proxyHeaders ||
          stream.behaviorHints?.proxyHeaders?.request ||
          normalizeRequestHeaders(url);

        const proxiedBehaviorHints = { ...(stream.behaviorHints || {}) };
        delete proxiedBehaviorHints.proxyHeaders;

        return {
          ...stream,
          url: buildProxiedUrl(stream._targetUrl || stream.url, upstreamHeaders),
          _proxyHeaders: upstreamHeaders,
          _targetUrl: stream._targetUrl || stream.url,
          behaviorHints: Object.keys(proxiedBehaviorHints).length > 0 ? proxiedBehaviorHints : undefined
        };
      }
      return stream;
    });
  }

  return streams;
}
