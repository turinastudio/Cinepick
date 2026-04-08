const { NativeAnimeProvider } = require("./native-anime-provider");
const {
  getHenaojaraAiringTitles,
  getHenaojaraMeta,
  getHenaojaraStreams,
  searchHenaojara
} = require("./henaojara-client");

class HenaojaraProvider extends NativeAnimeProvider {
  constructor() {
    super({
      id: "henaojara",
      name: "Henaojara",
      nativeAiring: () => getHenaojaraAiringTitles(),
      nativeSearch: ({ query, genres, page, gottenItems }) =>
        searchHenaojara(query, genres, page, gottenItems),
      nativeMeta: ({ slug }) => getHenaojaraMeta(slug),
      nativeStreams: ({ slug, episode }) => getHenaojaraStreams(slug, episode)
    });
  }
}

module.exports = {
  HenaojaraProvider
};
