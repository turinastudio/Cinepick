const { NativeAnimeProvider } = require("./native-anime-provider");
const {
  getAnimeFLVAiringTitles,
  getAnimeFLVMeta,
  getAnimeFLVStreams,
  searchAnimeFLV
} = require("./animeflv-client");

class AnimeFLVProvider extends NativeAnimeProvider {
  constructor() {
    super({
      id: "animeflv",
      name: "AnimeFLV",
      nativeAiring: () => getAnimeFLVAiringTitles(),
      nativeSearch: ({ query, genres, page, gottenItems }) =>
        searchAnimeFLV(query, genres, page, gottenItems),
      nativeMeta: ({ slug }) => getAnimeFLVMeta(slug),
      nativeStreams: ({ slug, episode }) => getAnimeFLVStreams(slug, episode)
    });
  }
}

module.exports = {
  AnimeFLVProvider
};
