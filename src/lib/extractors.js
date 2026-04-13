// Facade estable para extractors.js.
// Re-exporta el API publico desde la estructura modular interna.
// Todo el codigo externo sigue importando desde src/lib/extractors.js sin cambios.

export { buildProxiedUrl, buildStream } from "./extractors/index.js";
export { getExtractorRegistry, matchExtractorByUrl, resolveExtractorStream } from "./extractors/index.js";
