const { NativeAnimeProvider } = require("./native-anime-provider");
const { getTioAnimeStreams, getTioAnimeMeta, searchTioAnime, getTioAnimeAiringTitles } = require("./tioanime-client");

class TioAnimeProvider extends NativeAnimeProvider {
  constructor() {
    super("tioanime", "TioAnime", "tioanime:");
  }

  async getStreams(slug, episodeNumber) {
    return getTioAnimeStreams(slug, episodeNumber);
  }

  async getMeta(slug) {
    return getTioAnimeMeta(slug);
  }

  async search(query, genres, page, gottenItems) {
    return searchTioAnime(query, genres, page, gottenItems);
  }

  async getAiringTitles() {
    return getTioAnimeAiringTitles();
  }
}

module.exports = {
  TioAnimeProvider
};
