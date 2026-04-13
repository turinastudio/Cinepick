// Barrel: re-export the stable public API of extractors.
// External code should import from here (or from src/lib/extractors.js facade).

export { buildProxiedUrl, buildStream } from "./public-builders.js";
export { getExtractorRegistry, matchExtractorByUrl, resolveExtractorStream } from "./registry.js";
