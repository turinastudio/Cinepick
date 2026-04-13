import { NativeAnimeProvider } from "./native-anime-provider.js";
import {
  getAnimeAV1AiringTitles,
  getAnimeAV1Meta,
  getAnimeAV1Streams,
  searchAnimeAV1
} from "./animeav1-client.js";

export class AnimeAV1Provider extends NativeAnimeProvider {
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
