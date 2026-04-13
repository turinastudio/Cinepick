function normalizeUrlForDedupe(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    const filteredParams = [...parsed.searchParams.entries()]
      .filter(([key]) => !["utm_source", "utm_medium", "utm_campaign", "expires", "token", "signature", "sig"].includes(String(key).toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right));
    parsed.search = "";
    for (const [key, val] of filteredParams) {
      parsed.searchParams.append(key, val);
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function getCanonicalStreamTarget(stream) {
  const targetUrl = normalizeUrlForDedupe(
    stream?._targetUrl || stream?.url || stream?.externalUrl
  );
  if (targetUrl) {
    return targetUrl;
  }

  const behaviorFilename = normalizeUrlForDedupe(stream?.behaviorHints?.filename);
  if (behaviorFilename) {
    return behaviorFilename;
  }

  return "";
}

function dedupeStreamsByTarget(streams, options = {}) {
  const items = Array.isArray(streams) ? streams : [];
  const duplicates = [];
  const deduped = [];
  const seen = new Map();
  const buildKey = typeof options.buildKey === "function"
    ? options.buildKey
    : ((stream, canonicalTarget) => canonicalTarget ?? `${stream?.url ?? ""}::${stream?.externalUrl ?? ""}::${stream?.title ?? ""}`);
  const mapDuplicate = typeof options.mapDuplicate === "function"
    ? options.mapDuplicate
    : ((stream, key, canonicalTarget) => ({
        key,
        canonicalTarget: canonicalTarget ?? null,
        url: stream?.url ?? null,
        externalUrl: stream?.externalUrl ?? null,
        name: stream?.name ?? null,
        title: stream?.title ?? null
      }));
  const shouldReplace = typeof options.shouldReplace === "function"
    ? options.shouldReplace
    : (() => false);

  for (const stream of items) {
    const canonicalTarget = getCanonicalStreamTarget(stream);
    const key = String(buildKey(stream, canonicalTarget) || "");
    if (seen.has(key)) {
      const existingIndex = seen.get(key);
      const existing = deduped[existingIndex];
      const replace = shouldReplace(existing, stream, key, canonicalTarget);
      if (replace) {
        duplicates.push(mapDuplicate(existing, key, canonicalTarget));
        deduped[existingIndex] = stream;
        continue;
      }

      duplicates.push(mapDuplicate(stream, key, canonicalTarget));
      continue;
    }

    seen.set(key, deduped.length);
    deduped.push(stream);
  }

  return {
    deduped,
    duplicates
  };
}

module.exports = {
  dedupeStreamsByTarget,
  getCanonicalStreamTarget,
  normalizeUrlForDedupe
};
