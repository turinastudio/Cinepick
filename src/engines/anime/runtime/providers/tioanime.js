const { NativeAnimeProvider } = require("./native-anime-provider");
const { getTioAnimeStreams, getTioAnimeMeta, searchTioAnime, getTioAnimeAiringTitles } = require("./tioanime-client");

class TioAnimeProvider extends NativeAnimeProvider {
  constructor() {
    super({
      id: "tioanime",
      name: "TioAnime",
      nativeAiring: () => getTioAnimeAiringTitles(),
      nativeSearch: ({ query, genres, page, gottenItems }) =>
        searchTioAnime(query, genres, page, gottenItems),
      nativeMeta: ({ slug }) => getTioAnimeMeta(slug),
      nativeStreams: ({ slug, episode }) => getTioAnimeStreams(slug, episode)
    });
  }
}

module.exports = {
  TioAnimeProvider
};
