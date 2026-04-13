import { NativeAnimeProvider } from "./native-anime-provider.js";
import {
  getHenaojaraAiringTitles,
  getHenaojaraMeta,
  getHenaojaraStreams,
  searchHenaojara
} from "./henaojara-client.js";

export class HenaojaraProvider extends NativeAnimeProvider {
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
