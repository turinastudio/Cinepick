const {
  getHLSLink,
  getMP4UploadLink,
  getNetuLink,
  getPDrainLink,
  getUqloadLink,
  getYourUploadLink
} = require("./stream-hosts");
const { isExtractorEnabled } = require("../../../../config/request-context.cjs");

const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const STREAM_LIST_NAME = "Cinepick";

const INTERNAL_HOSTS = {
  YourUpload: {
    extractorId: "yourupload",
    resolve: getYourUploadLink,
    requestReferer: "https://yourupload.com"
  },
  MP4Upload: {
    extractorId: "mp4upload",
    resolve: getMP4UploadLink,
    requestReferer: "https://a4.mp4upload.com"
  },
  Netu: {
    extractorId: "netu",
    resolve: getNetuLink
  },
  PDrain: {
    extractorId: "pixeldrain",
    resolve: getPDrainLink,
    requestReferer: "https://pixeldrain.com",
    responseHeaders: {
      "Content-Type": "video/mp4"
    }
  },
  Uqload: {
    extractorId: "uqload",
    resolve: getUqloadLink
  },
  HLS: {
    extractorId: "hls",
    resolve: getHLSLink,
    requestReferer: "https://player.zilla-networks.com",
    responseHeaders: (realURL) => ({
      "Content-Type": realURL.includes("/m3u8/") ? "application/vnd.apple.mpegurl" : "video/mp4"
    })
  }
};

function getLanguageLabel(isDub) {
  return isDub ? "Latino" : "Subtitulado";
}

function buildDisplayTitle(epName, providerLabel, sourceName, isDub) {
  return `${epName}\n${getLanguageLabel(isDub)}\n${providerLabel} - ${sourceName}`;
}

function buildExternalStreams({ providerLabel, bingePrefix, epName, servers }) {
  return servers
    .filter((source) => source.embed !== undefined && isExtractorEnabled(source.name))
    .map((source) => ({
      externalUrl: source.embed,
      name: STREAM_LIST_NAME,
      title: buildDisplayTitle(epName, providerLabel, source.name, Boolean(source.dub)),
      _dub: Boolean(source.dub),
      behaviorHints: {
        bingeGroup: `${bingePrefix}|${source.name}|ext`,
        filename: source.embed
      }
    }));
}

async function buildInternalStream({ providerLabel, bingePrefix, epName, source }) {
  const hostConfig = INTERNAL_HOSTS[source.name];
  if (!hostConfig || source.embed === undefined || !isExtractorEnabled(hostConfig.extractorId || source.name)) {
    return undefined;
  }

  const realURL = await hostConfig.resolve(source.embed);
  const resolvedStream = typeof realURL === "string" ? { url: realURL } : realURL;
  if (!resolvedStream?.url) {
    return undefined;
  }

  const targetUrl = resolvedStream.url;
  const extraResponseHeaders = typeof hostConfig.responseHeaders === "function"
    ? hostConfig.responseHeaders(targetUrl)
    : (hostConfig.responseHeaders || {});
  const requestHeaders = {
    "User-Agent": DEFAULT_USER_AGENT
  };

  if (hostConfig.requestReferer) {
    requestHeaders.Referer = hostConfig.requestReferer;
  }

  Object.assign(requestHeaders, resolvedStream.requestHeaders || {});

  const responseHeaders = {
    "User-Agent": DEFAULT_USER_AGENT,
    ...extraResponseHeaders,
    ...(resolvedStream.responseHeaders || {})
  };

  return {
    url: targetUrl,
    name: STREAM_LIST_NAME,
    title: buildDisplayTitle(epName, providerLabel, source.name, Boolean(source.dub)),
    _dub: Boolean(source.dub),
    _targetUrl: targetUrl,
    behaviorHints: {
      bingeGroup: `${bingePrefix}|${source.name}`,
      filename: targetUrl,
      notWebReady: true,
      proxyHeaders: {
        request: requestHeaders,
        response: responseHeaders
      }
    }
  };
}

async function buildInternalStreams({
  providerLabel,
  bingePrefix,
  epName,
  servers,
  supportedHosts
}) {
  const supported = new Set(supportedHosts);
  const sources = servers.filter((source) =>
    source.embed !== undefined && supported.has(source.name) && isExtractorEnabled(source.name)
  );

  const settled = await Promise.allSettled(
    sources.map((source) =>
      buildInternalStream({ providerLabel, bingePrefix, epName, source })
    )
  );

  return settled
    .filter((item) => item.status === "fulfilled" && item.value)
    .map((item) => item.value);
}

module.exports = {
  buildExternalStreams,
  buildInternalStreams
};
