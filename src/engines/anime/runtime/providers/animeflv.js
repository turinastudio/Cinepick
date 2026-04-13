import { NativeAnimeProvider } from "./native-anime-provider.js";
import {
  getAnimeFLVAiringTitles,
  getAnimeFLVMeta,
  getAnimeFLVStreams,
  searchAnimeFLV
} from "./animeflv-client.js";

export class AnimeFLVProvider extends NativeAnimeProvider {
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
