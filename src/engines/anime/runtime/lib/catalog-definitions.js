export const ANIMEFLV_GENRES = [
  "accion", "artes-marciales", "aventura", "carreras", "ciencia-ficcion", "comedia",
  "demencia", "demonios", "deportes", "drama", "ecchi", "escolares", "espacial", "fantasia",
  "harem", "historico", "infantil", "josei", "juegos", "magia", "mecha", "militar", "misterio",
  "musica", "parodia", "policia", "psicologico", "recuentos-de-la-vida", "romance", "samurai",
  "seinen", "shoujo", "shounen", "sobrenatural", "superpoderes", "suspenso", "terror", "vampiros",
  "yaoi", "yuri"
];

export const HENAOJARA_GENRES = [
  "accion", "aenime", "anime-latino", "artes-marciales", "aventura", "aventuras", "blu-ray",
  "carreras", "castellano", "ciencia-ficcion", "comedia", "comida", "cyberpunk", "demencia", "dementia",
  "demonios", "deportes", "drama", "ecchi", "escolares", "escuela", "espacial", "fantasia", "gore",
  "harem", "historia-paralela", "historico", "horror", "infantil", "josei", "juegos", "latino", "lucha",
  "magia", "mecha", "militar", "misterio", "monogatari", "musica", "parodia", "parodias", "policia",
  "psicologico", "recuentos-de-la-vida", "recuerdos-de-la-vida", "romance", "samurai", "seinen", "shojo",
  "shonen", "shoujo", "shounen", "shounen-ai", "sobrenatural", "superpoderes", "suspenso", "terror",
  "vampiros", "yaoi", "yuri"
];

export function buildSearchCatalog(id, type, genreOptions) {
  return {
    id,
    type,
    name: "search results",
    extra: [
      { name: "search", isRequired: true },
      {
        name: "genre",
        options: genreOptions,
        optionsLimit: 1,
        isRequired: false
      },
      { name: "skip", isRequired: false }
    ]
  };
}

export function buildGenreCatalog(id, type, name, genreOptions) {
  return {
    id,
    type,
    name,
    extra: [
      {
        name: "genre",
        options: genreOptions,
        optionsLimit: 1,
        isRequired: true
      },
      { name: "skip", isRequired: false }
    ]
  };
}

export function buildCatalogs() {
  return [
    buildSearchCatalog("animeflv", "AnimeFLV", ANIMEFLV_GENRES),
    buildSearchCatalog("animeav1", "AnimeAV1", ANIMEFLV_GENRES),
    buildSearchCatalog("henaojara", "Henaojara", HENAOJARA_GENRES),
    buildGenreCatalog("animeflv|genres", "AnimeFLV", "AnimeFLV", ANIMEFLV_GENRES),
    buildGenreCatalog("animeav1|genres", "AnimeAV1", "AnimeAV1", ANIMEFLV_GENRES),
    buildGenreCatalog("henaojara|genres", "Henaojara", "Henaojara", HENAOJARA_GENRES),
    { id: "animeflv|onair", type: "AnimeFLV", name: "On Air" },
    { id: "animeav1|onair", type: "AnimeAV1", name: "On Air" },
    { id: "henaojara|onair", type: "Henaojara", name: "On Air" },
    {
      type: "series",
      id: "calendar-videos",
      name: "Calendar videos",
      extra: [{ name: "calendarVideosIds", isRequired: true, optionsLimit: 15 }],
      extraSupported: ["calendarVideosIds"],
      extraRequired: ["calendarVideosIds"]
    }
  ];
}
