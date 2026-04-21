import { resolveExtractorStream } from "../extractors.js";
import { dedupeByKey } from "./common.js";

const PROVIDER_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.PROVIDER_TIMEOUT_MS || "25000", 10) || 25000
);
const CANDIDATE_TIMEOUT_MS = Math.max(
  1000,
  Math.min(
    Number.parseInt(process.env.EXTRACTOR_CANDIDATE_TIMEOUT_MS || "6000", 10) || 6000,
    PROVIDER_TIMEOUT_MS
  )
);
const EARLY_ABORT_MIN_STREAMS = Math.max(
  1,
  Number.parseInt(process.env.EARLY_ABORT_MIN_STREAMS || "3", 10) || 3
);

function isHighQuality(stream) {
  const title = String(stream.title || stream.name || "").toLowerCase();
  return /1080p|4k|2160p/.test(title);
}

async function withCandidateTimeout(promiseFactory, url) {
  let timeoutHandle = null;

  try {
    return await Promise.race([
      Promise.resolve().then(promiseFactory),
      new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve([]), CANDIDATE_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function resolveWebstreamCandidates(providerId, rawCandidates) {
  const unique = dedupeByKey(rawCandidates, (item) => item.url);

  if (unique.length === 0) {
    return [];
  }

  const allStreams = [];
  let hasEnoughHighQuality = false;

  // Launch all extractors in parallel, but collect results as they resolve.
  const promises = unique.map(async (item) => {
    // If we already have enough good streams, skip expensive extraction.
    if (hasEnoughHighQuality) {
      return [];
    }

    const extracted = await withCandidateTimeout(
      () => resolveExtractorStream(item.url, item.label, true).catch(() => []),
      item.url
    ).catch(() => []);

    const mapped = extracted.map((stream) => ({
      ...stream,
      name: item.source,
      _providerId: providerId
    }));

    // Accumulate results and check early-abort condition.
    if (mapped.length > 0) {
      allStreams.push(...mapped);

      const hqCount = allStreams.filter(isHighQuality).length;
      if (allStreams.length >= EARLY_ABORT_MIN_STREAMS && hqCount >= 1) {
        hasEnoughHighQuality = true;
      }
    }

    return mapped;
  });

  await Promise.all(promises);

  return allStreams.filter(Boolean);
}
