const { Provider } = require("./base");
const { readAiringCache } = require("../lib/airing-cache");

class NativeAnimeProvider extends Provider {
  constructor({
    id,
    name,
    nativeAiring,
    nativeSearch,
    nativeMeta,
    nativeStreams
  }) {
    super({ id, name });
    this.nativeAiring = nativeAiring;
    this.nativeSearch = nativeSearch;
    this.nativeMeta = nativeMeta;
    this.nativeStreams = nativeStreams;
  }

  async getAiring() {
    return readAiringCache(this.id).catch(() => this.getAiringFromWeb());
  }

  async getAiringFromWeb() {
    return this.nativeAiring();
  }

  async search(params) {
    return this.nativeSearch(params);
  }

  async getMeta(params) {
    return this.nativeMeta(params);
  }

  async getStreams(params) {
    return this.nativeStreams(params);
  }
}

module.exports = {
  NativeAnimeProvider
};
