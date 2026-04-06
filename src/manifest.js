export const manifest = {
  id: "com.stremio.web.scraper",
  version: "0.1.1",
  name: "Web Scraper Addon",
  description: "Addon base para Stremio con providers web reutilizables.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: ["animeav1:", "animeflv:", "lacartoons:", "gnula:", "cinecalidad:", "netmirror:", "castle:", "cuevana:", "homecine:", "tioplus:", "verhdlink:", "cinehdplus:", "mhdflix:", "lamovie:", "verseriesonline:", "cineplus123:", "serieskao:", "seriesmetro:", "tt"],
  catalogs: [
    {
      type: "movie",
      id: "animeav1-movies",
      name: "AnimeAV1 Movies",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "series",
      id: "animeav1-series",
      name: "AnimeAV1 Series",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "movie",
      id: "animeflv-movies",
      name: "AnimeFLV Movies",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "series",
      id: "animeflv-series",
      name: "AnimeFLV Series",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "movie",
      id: "lacartoons-movies",
      name: "LACartoons Movies",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "series",
      id: "lacartoons-series",
      name: "LACartoons Series",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "movie",
      id: "gnula-movies",
      name: "Gnula Movies",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "series",
      id: "gnula-series",
      name: "Gnula Series",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "movie",
      id: "cinecalidad-movies",
      name: "CineCalidad Movies",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "series",
      id: "cinecalidad-series",
      name: "CineCalidad Series",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "movie",
      id: "mhdflix-movies",
      name: "MhdFlix Movies",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "series",
      id: "mhdflix-series",
      name: "MhdFlix Series",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "movie",
      id: "lamovie-movies",
      name: "LaMovie Movies",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "series",
      id: "lamovie-series",
      name: "LaMovie Series",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "series",
      id: "verseriesonline-series",
      name: "VerSeriesOnline Series",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "movie",
      id: "cineplus123-movies",
      name: "Cineplus123 Movies",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "movie",
      id: "serieskao-movies",
      name: "SeriesKao Movies",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "series",
      id: "serieskao-series",
      name: "SeriesKao Series",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "series",
      id: "cineplus123-series",
      name: "Cineplus123 Series",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "movie",
      id: "seriesmetro-movies",
      name: "SeriesMetro Movies",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "series",
      id: "seriesmetro-series",
      name: "SeriesMetro Series",
      extra: [{ name: "search", isRequired: true }]
    }
  ]
};
