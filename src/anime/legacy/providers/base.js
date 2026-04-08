class Provider {
  constructor({ id, name }) {
    this.id = id;
    this.name = name;
  }

  async getAiring() {
    throw new Error("Provider.getAiring not implemented");
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
}

module.exports = {
  Provider
};
