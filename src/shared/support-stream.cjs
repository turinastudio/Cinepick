const DEFAULT_SUPPORT_URL = "https://ko-fi.com/turinastudio";
const DEFAULT_SUPPORT_NAME = "Cinepick";
const DEFAULT_SUPPORT_BINGE_GROUP = "cinepick|support";
const { shouldShowSupportStream: shouldShowConfiguredSupportStream } = require("../config/request-context.cjs");

function shouldShowSupportStream() {
  const envEnabled = !/^(0|false|no)$/i.test(String(process.env.SHOW_SUPPORT_STREAM || "true").trim());
  return shouldShowConfiguredSupportStream(envEnabled);
}

function buildSupportStream(options = {}) {
  const supportUrl = String(process.env.SUPPORT_URL || DEFAULT_SUPPORT_URL).trim() || DEFAULT_SUPPORT_URL;
  const name = String(options.name || DEFAULT_SUPPORT_NAME).trim() || DEFAULT_SUPPORT_NAME;
  const supportLabel = String(options.supportLabel || name).trim() || name;
  const bingeGroup = String(options.bingeGroup || DEFAULT_SUPPORT_BINGE_GROUP).trim() || DEFAULT_SUPPORT_BINGE_GROUP;

  return {
    externalUrl: supportUrl,
    name,
    title: `Apoyar ${supportLabel}\nInvitar un cafecito\n${supportUrl}`,
    behaviorHints: {
      bingeGroup,
      filename: supportUrl
    }
  };
}

function appendSupportStream(streams, options = {}) {
  const base = Array.isArray(streams) ? streams : [];
  if (!shouldShowSupportStream() || base.length === 0) {
    return base;
  }

  return base.concat(buildSupportStream(options));
}

function debugSupportStream(streams, options = {}) {
  const base = Array.isArray(streams) ? streams : [];
  const enabled = shouldShowSupportStream();
  const added = enabled && base.length > 0;

  return {
    enabled,
    added,
    baseCount: base.length,
    finalCount: added ? base.length + 1 : base.length,
    stream: added ? buildSupportStream(options) : null
  };
}

module.exports = {
  DEFAULT_SUPPORT_BINGE_GROUP,
  DEFAULT_SUPPORT_NAME,
  DEFAULT_SUPPORT_URL,
  appendSupportStream,
  buildSupportStream,
  debugSupportStream,
  shouldShowSupportStream
};
