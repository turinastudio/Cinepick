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
          options: ["accion", "artes-marciales", "aventura", "carreras", "ciencia-ficcion", "comedia", "demencia", "demonios", "deportes", "drama", "ecchi", "escolares", "espacial", "fantasia", "harem", "historico", "infantil", "josei", "juegos", "magia", "mecha", "militar", "misterio", "musica", "parodia", "policia", "psicologico", "recuentos-de-la-vida", "romance", "samurai", "seinen", "shoujo", "shounen", "sobrenatural", "superpoderes", "suspenso", "terror", "vampiros", "yaoi", "yuri"],
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
          options: ["accion", "artes-marciales", "aventura", "carreras", "ciencia-ficcion", "comedia", "demencia", "demonios", "deportes", "drama", "ecchi", "escolares", "espacial", "fantasia", "harem", "historico", "infantil", "josei", "juegos", "magia", "mecha", "militar", "misterio", "musica", "parodia", "policia", "psicologico", "recuentos-de-la-vida", "romance", "samurai", "seinen", "shoujo", "shounen", "sobrenatural", "superpoderes", "suspenso", "terror", "vampiros", "yaoi", "yuri"],
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
          options: ["accion", "artes-marciales", "aventura", "carreras", "ciencia-ficcion", "comedia", "demencia", "demonios", "deportes", "drama", "ecchi", "escolares", "espacial", "fantasia", "harem", "historico", "infantil", "josei", "juegos", "magia", "mecha", "militar", "misterio", "musica", "parodia", "policia", "psicologico", "recuentos-de-la-vida", "romance", "samurai", "seinen", "shoujo", "shounen", "sobrenatural", "superpoderes", "suspenso", "terror", "vampiros", "yaoi", "yuri"],
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
