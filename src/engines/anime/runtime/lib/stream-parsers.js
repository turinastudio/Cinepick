import { fetchText } from "../../../../shared/fetch.cjs";

export async function resolveViaGeneralExtractor(url, label) {
  const { resolveExtractorStream } = await import("../../../../lib/extractors.js");
  const streams = await resolveExtractorStream(url, label, false);
  const firstStream = Array.isArray(streams) ? streams.find((item) => item?.url) : null;

  if (!firstStream?.url) {
    return undefined;
  }

  return {
    url: firstStream._targetUrl || firstStream.url,
    requestHeaders:
      firstStream.behaviorHints?.proxyHeaders?.request
      || firstStream._proxyHeaders
      || undefined,
    responseHeaders:
      firstStream.behaviorHints?.proxyHeaders?.response
      || undefined
  };
}

export function getStreamTapeLink(url) {
  const requestUrl = url.replace("/e/", "/v/");

  return fetchText(requestUrl)
    .then((data) => {
      const noRobotLinkPattern = /document\.getElementById\('norobotlink'\)\.innerHTML = (.+?);/g;
      const matches = noRobotLinkPattern.exec(data);

      if (!matches?.[1]) {
        return undefined;
      }

      const tokenPattern = /token=([^&']+)/g;
      const tokenMatches = tokenPattern.exec(matches[1]);

      if (!tokenMatches?.[1]) {
        return undefined;
      }

      const streamTapePattern = /id\s*=\s*"ideoooolink"/g;
      const markerMatch = streamTapePattern.exec(data);

      if (!markerMatch) {
        return undefined;
      }

      const tagEnd = data.indexOf(">", markerMatch.index) + 1;
      const streamTape = data.substring(tagEnd, data.indexOf("<", tagEnd));
      return `https:/${streamTape}&token=${tokenMatches[1]}&dl=1s`;
    });
}

export function getYourUploadLink(url) {
  return fetchText(url)
    .then((data) => {
      const metaPattern = /property\s*=\s*"og:video"/g;
      const metaMatch = metaPattern.exec(data);

      if (!metaMatch?.[0]) {
        return undefined;
      }

      const videoPattern = /content\s*=\s*"(\S+)"/g;
      const videoMatch = videoPattern.exec(data.substring(metaMatch.index));

      if (!videoMatch?.[1]) {
        return undefined;
      }

      return videoMatch[1];
    });
}

export function getHLSLink(url) {
  if (url.includes("/play/") || url.includes("/m3u8/")) {
    return Promise.resolve(url.replace("/play/", "/m3u8/"));
  }

  return Promise.reject(new Error("No video link"));
}

export function getPDrainLink(url) {
  const metaPattern = /(.+?:\/\/.+?)\/.+?\/(.+?)(?:\?embed)?$/g;
  const metaMatch = metaPattern.exec(url);

  if (metaMatch?.[0]) {
    return Promise.resolve(`${metaMatch[1]}/api/file/${metaMatch[2]}`);
  }

  return Promise.reject(new Error("No video link"));
}

export function getMP4UploadLink(url) {
  return fetchText(url)
    .then((data) => {
      const metaPattern = /<script(?:.|\n)+?src:(?:.|\n)*?"(.+?\.mp4)"/g;
      const metaMatch = metaPattern.exec(data);

      if (!metaMatch?.[1]) {
        return undefined;
      }

      return metaMatch[1];
    });
}

export function getNetuLink(url) {
  return resolveViaGeneralExtractor(url, "Anime");
}

export function getUqloadLink(url) {
  return resolveViaGeneralExtractor(url, "Anime");
}
