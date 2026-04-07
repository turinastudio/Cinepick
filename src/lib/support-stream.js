const DEFAULT_SUPPORT_URL = "https://ko-fi.com/turinastudio";

function shouldShowSupportStream() {
  return !/^(0|false|no)$/i.test(String(process.env.SHOW_SUPPORT_STREAM || "true").trim());
}

function buildSupportStream() {
  const supportUrl = String(process.env.SUPPORT_URL || DEFAULT_SUPPORT_URL).trim() || DEFAULT_SUPPORT_URL;

  return {
    externalUrl: supportUrl,
    name: "CinePick",
    title: `Apoyar CinePick\nInvitar un cafecito\n${supportUrl}`,
    behaviorHints: {
      bingeGroup: "cinepick|support",
      filename: supportUrl
    }
  };
}

export function appendSupportStream(streams) {
  const base = Array.isArray(streams) ? streams : [];
  if (!shouldShowSupportStream() || base.length === 0) {
    return base;
  }

  return base.concat(buildSupportStream());
}
