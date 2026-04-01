export const manifest = {
  id: "com.stremio.web.scraper",
  version: "0.1.0",
  name: "Web Scraper Addon",
  description: "Addon base para Stremio con providers web reutilizables.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series", "anime", "other"],
  idPrefixes: ["gnula:", "cinecalidad:", "mhdflix:", "verseriesonline:", "tt"],
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
      type: "anime",
      id: "gnula-anime",
      name: "Gnula Anime",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "other",
      id: "gnula-doramas",
      name: "Gnula Doramas",
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
      type: "anime",
      id: "cinecalidad-anime",
      name: "CineCalidad Anime",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      type: "other",
      id: "cinecalidad-other",
      name: "CineCalidad Other",
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
      type: "series",
      id: "verseriesonline-series",
      name: "VerSeriesOnline Series",
      extra: [{ name: "search", isRequired: true }]
    }
  ]
};
