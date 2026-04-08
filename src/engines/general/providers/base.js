export class Provider {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.supportedTypes = config.supportedTypes;
    this.disabledSources = new Set(
      String(process.env[`${this.id.toUpperCase()}_DISABLED_SOURCES`] || "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    );
  }

  supportsType(type) {
    return this.supportedTypes.includes(type);
  }

  isSourceEnabled(sourceName) {
    return !this.disabledSources.has(String(sourceName || "").trim().toLowerCase());
  }

  attachDisplayTitle(streams, displayTitle) {
    const normalized = String(displayTitle || "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return streams;
    }

    return (Array.isArray(streams) ? streams : []).map((stream) => ({
      ...stream,
      _displayTitle: stream?._displayTitle || normalized
    }));
  }

  async search(_params) {
    throw new Error("Provider.search not implemented");
  }

  async getMeta(_params) {
    throw new Error("Provider.getMeta not implemented");
  }

  async getStreams(_params) {
    throw new Error("Provider.getStreams not implemented");
  }

  async getStreamsFromExternalId(_params) {
    return [];
  }

  async debugStreamsFromExternalId(_params) {
    return null;
  }

  async debugInternalStreams(_params) {
    return null;
  }
}
