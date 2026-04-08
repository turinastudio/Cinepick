const { NativeAnimeProvider } = require("./native-anime-provider");
const {
  getAnimeAV1AiringTitles,
  getAnimeAV1Meta,
  getAnimeAV1Streams,
  searchAnimeAV1
} = require("./animeav1-client");

class AnimeAV1Provider extends NativeAnimeProvider {
  constructor() {
    super({
      id: "animeav1",
      name: "AnimeAV1",
      nativeAiring: () => getAnimeAV1AiringTitles(),
      nativeSearch: ({ query, type, genres, page, gottenItems }) =>
        searchAnimeAV1(query, type, genres, page, gottenItems),
      nativeMeta: ({ slug }) => getAnimeAV1Meta(slug),
      nativeStreams: ({ slug, episode }) => getAnimeAV1Streams(slug, episode)
    });
  }
}

module.exports = {
  AnimeAV1Provider
};
