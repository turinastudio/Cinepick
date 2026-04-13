// Re-exports of buildStream and buildProxiedUrl for handler modules.
// These were originally defined in extractors.js and are now shared via this module
// to avoid circular dependencies between handlers and the main extractors module.

export { buildStream, buildProxiedUrl } from "./shared/build-stream.js";
