import { resolveExtractorStream } from "../extractors.js";
import { dedupeByKey } from "./common.js";

const PROVIDER_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.PROVIDER_TIMEOUT_MS || "12000", 10) || 12000
);
const CANDIDATE_TIMEOUT_MS = Math.max(
  1000,
  Math.min(
    Number.parseInt(process.env.EXTRACTOR_CANDIDATE_TIMEOUT_MS || "", 10) || Math.floor(PROVIDER_TIMEOUT_MS / 2),
    PROVIDER_TIMEOUT_MS
  )
);

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
  const groups = await Promise.all(
    dedupeByKey(rawCandidates, (item) => item.url).map(async (item) => {
      const extracted = await withCandidateTimeout(
        () => resolveExtractorStream(item.url, item.label, true).catch(() => []),
        item.url
      ).catch(() => []);
      return extracted.map((stream) => ({
        ...stream,
        name: item.source,
        _providerId: providerId
      }));
    })
  );

  return groups.flat().filter(Boolean);
}
