export const manifest = {
  id: "com.stremio.web.scraper",
  version: "0.1.0",
  name: "Web Scraper Addon",
  description: "Addon base para Stremio con providers web reutilizables.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: ["gnula:", "cinecalidad:", "mhdflix:", "lamovie:", "verseriesonline:", "cineplus123:", "tt"],
  catalogs: [
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
      type: "series",
      id: "cineplus123-series",
      name: "Cineplus123 Series",
      extra: [{ name: "search", isRequired: true }]
    }
  ]
};
