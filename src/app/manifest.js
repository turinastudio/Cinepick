export const manifest = {
  id: "com.stremio.web.scraper",
  version: "0.1.1",
  name: "Cinepick",
  description: "Olvidate de probar streams uno por uno. Cinepick busca en multiples fuentes y elige automaticamente el mejor disponible. Gratis, sin anuncios, sin suscripcion. Si te gusto, podes invitarme un cafe y ayudar a mantener el proyecto vivo.",
  resources: ["meta", "stream", "catalog"],
  types: ["movie", "series"],
  catalogs: [
    {
      id: "animeflv|onair", type: "AnimeFLV", name: "On Air"
    },
    {
      id: "animeav1|onair", type: "AnimeAV1", name: "On Air"
    },
    {
      id: "henaojara|onair", type: "Henaojara", name: "On Air"
    },
    {
      id: "animeflv|search", type: "AnimeFLV", name: "Search",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      id: "animeav1|search", type: "AnimeAV1", name: "Search",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      id: "henaojara|search", type: "Henaojara", name: "Search",
      extra: [{ name: "search", isRequired: true }]
    }
  ],
  idPrefixes: [
    "lacartoons:",
    "gnula:",
    "cinecalidad:",
    "netmirror:",
    "castle:",
    "cuevana:",
    "homecine:",
    "tioplus:",
    "mhdflix:",
    "lamovie:",
    "verseriesonline:",
    "cineplus123:",
    "serieskao:",
    "seriesmetro:",
    "animeflv:",
    "animeav1:",
    "henaojara:",
    "tt"
  ]
};
