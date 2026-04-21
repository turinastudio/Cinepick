const ANIME_GENRE_OPTIONS = [
  "accion", "artes-marciales", "aventura", "carreras", "ciencia-ficcion", "comedia", "demencia", "demonios", "deportes", "drama", "ecchi", "escolares", "espacial", "fantasia", "harem", "historico", "infantil", "josei", "juegos", "magia", "mecha", "militar", "misterio", "musica", "parodia", "policia", "psicologico", "recuentos-de-la-vida", "romance", "samurai", "seinen", "shoujo", "shounen", "sobrenatural", "superpoderes", "suspenso", "terror", "vampiros", "yaoi", "yuri"
];

const SERIESKAO_GENRE_OPTIONS = [
  "Accion", "Animacion", "Aventura", "Belica", "Ciencia Ficcion", "Comedia", "Crimen",
  "Documental", "Drama", "Fantasia", "Familia", "Guerra", "Historia", "Romance",
  "Suspense", "Terror", "Western", "Misterio"
];

const SERIESKAO_YEAR_OPTIONS = Array.from(
  { length: new Date().getFullYear() - 1999 },
  (_, index) => String(new Date().getFullYear() - index)
);

const SERIESKAO_POPULAR_GENRE_OPTIONS = ["Top", ...SERIESKAO_GENRE_OPTIONS];
const GNULA_GENRE_OPTIONS = [
  "Top",
  "Accion",
  "Animacion",
  "Aventura",
  "Biografia",
  "Ciencia Ficcion",
  "Comedia",
  "Crimen",
  "Documental",
  "Drama",
  "Familia",
  "Fantasia",
  "Historia",
  "Misterio",
  "Romance",
  "Suspenso",
  "Terror",
  "Western"
];

const GNULA_CATALOGS = [
  {
    id: "gnula|search",
    type: "Gnula",
    name: "Buscar",
    extra: [{ name: "search", isRequired: true }]
  },
  {
    id: "gnula|movies|popular",
    type: "Gnula",
    name: "Peliculas: Populares",
    extra: [
      { name: "genre", options: GNULA_GENRE_OPTIONS, optionsLimit: 1, isRequired: true },
      { name: "skip", isRequired: false }
    ]
  },
  {
    id: "gnula|movies|latest",
    type: "Gnula",
    name: "Peliculas: Ultimas Publicadas",
    extra: [{ name: "skip", isRequired: false }]
  },
  {
    id: "gnula|series|popular",
    type: "Gnula",
    name: "Series: Populares",
    extra: [
      { name: "genre", options: GNULA_GENRE_OPTIONS, optionsLimit: 1, isRequired: true },
      { name: "skip", isRequired: false }
    ]
  },
  {
    id: "gnula|series|latest",
    type: "Gnula",
    name: "Series: Ultimas Publicadas",
    extra: [{ name: "skip", isRequired: false }]
  }
];

const SERIESKAO_CATALOGS = [
  {
    id: "serieskao|search",
    type: "SeriesKao",
    name: "Buscar",
    extra: [{ name: "search", isRequired: true }]
  },
  {
    id: "serieskao|movies|popular",
    type: "SeriesKao",
    name: "Peliculas: Populares",
    extra: [
      { name: "genre", options: SERIESKAO_POPULAR_GENRE_OPTIONS, optionsLimit: 1, isRequired: true },
      { name: "skip", isRequired: false }
    ]
  },
  {
    id: "serieskao|movies|year",
    type: "SeriesKao",
    name: "Peliculas: Ultimas Publicadas",
    extra: [{ name: "skip", isRequired: false }]
  },
  {
    id: "serieskao|series|popular",
    type: "SeriesKao",
    name: "Series: Populares",
    extra: [
      { name: "genre", options: SERIESKAO_POPULAR_GENRE_OPTIONS, optionsLimit: 1, isRequired: true },
      { name: "skip", isRequired: false }
    ]
  },
  {
    id: "serieskao|series|year",
    type: "SeriesKao",
    name: "Series: Ultimas Publicadas",
    extra: [{ name: "skip", isRequired: false }]
  }
];

export const manifest = {
  id: "com.stremio.web.scraper",
  version: "0.1.1",
  name: "Cinepick",
  description: "Olvidate de probar streams uno por uno. Cinepick busca en multiples fuentes y elige automaticamente el mejor disponible. Gratis, sin anuncios, sin suscripcion. Si te gusto, podes invitarme un cafe y ayudar a mantener el proyecto vivo.",
  resources: ["meta", "stream", "catalog"],
  types: ["movie", "series", "SeriesKao", "Gnula"],
  catalogs: [
    ...GNULA_CATALOGS,
    ...SERIESKAO_CATALOGS,
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
      id: "tioanime|onair", type: "TioAnime", name: "On Air"
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
    },
    {
      id: "tioanime|search", type: "TioAnime", name: "Search",
      extra: [{ name: "search", isRequired: true }]
    },
    {
      id: "animeflv|genres", type: "AnimeFLV", name: "AnimeFLV",
      extra: [
        {
          name: "genre",
          options: ANIME_GENRE_OPTIONS,
          optionsLimit: 1, isRequired: true
        },
        { name: "skip", isRequired: false }
      ]
    },
    {
      id: "animeav1|genres", type: "AnimeAV1", name: "AnimeAV1",
      extra: [
        {
          name: "genre",
          options: ANIME_GENRE_OPTIONS,
          optionsLimit: 1, isRequired: true
        },
        { name: "skip", isRequired: false }
      ]
    },
    {
      id: "henaojara|genres", type: "Henaojara", name: "Henaojara",
      extra: [
        {
          name: "genre",
          options: ["accion", "aenime", "anime-latino", "artes-marciales", "aventura", "aventuras", "blu-ray", "carreras", "castellano", "ciencia-ficcion", "comedia", "comida", "cyberpunk", "demencia", "dementia", "demonios", "deportes", "drama", "ecchi", "escolares", "escuela", "espacial", "fantasia", "gore", "harem", "historia-paralela", "historico", "horror", "infantil", "josei", "juegos", "latino", "lucha", "magia", "mecha", "militar", "misterio", "monogatari", "musica", "parodia", "parodias", "policia", "psicologico", "recuentos-de-la-vida", "recuerdos-de-la-vida", "romance", "samurai", "seinen", "shojo", "shonen", "shoujo", "shounen", "shounen-ai", "sobrenatural", "superpoderes", "suspenso", "terror", "vampiros", "yaoi", "yuri"],
          optionsLimit: 1, isRequired: true
        },
        { name: "skip", isRequired: false }
      ]
    },
    {
      id: "tioanime|genres", type: "TioAnime", name: "TioAnime",
      extra: [
        {
          name: "genre",
          options: ANIME_GENRE_OPTIONS,
          optionsLimit: 1, isRequired: true
        },
        { name: "skip", isRequired: false }
      ]
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
    "tioanime:",
    "tt"
  ]
};
