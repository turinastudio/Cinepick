import dedupeShared from "./dedupe.cjs";

export const {
  dedupeStreamsByTarget,
  getCanonicalStreamTarget,
  normalizeUrlForDedupe
} = dedupeShared;
