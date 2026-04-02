import { resolveExtractorStream } from "../extractors.js";
import { dedupeByKey } from "./common.js";

export async function resolveWebstreamCandidates(providerId, rawCandidates) {
  const groups = await Promise.all(
    dedupeByKey(rawCandidates, (item) => item.url).map(async (item) => {
      const extracted = await resolveExtractorStream(item.url, item.label, true).catch(() => []);
      return extracted.map((stream) => ({
        ...stream,
        name: item.source,
        _providerId: providerId
      }));
    })
  );

  return groups.flat().filter(Boolean);
}
