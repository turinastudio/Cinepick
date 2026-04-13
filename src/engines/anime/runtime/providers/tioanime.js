import { NativeAnimeProvider } from "./native-anime-provider.js";
import { getTioAnimeStreams, getTioAnimeMeta, searchTioAnime, getTioAnimeAiringTitles } from "./tioanime-client.js";

export class TioAnimeProvider extends NativeAnimeProvider {
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
