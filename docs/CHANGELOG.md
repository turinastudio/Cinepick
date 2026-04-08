# Changelog

## [Unreleased] - 2026-04-06

### Anime

- Se agrego `animeav1` como provider anime nuevo.
- `animeav1` soporta:
  - series
  - peliculas
  - separacion `LAT SUB` y `LAT DUB`
- Se agrego `animeflv` como segundo provider anime.
- `animeflv` soporta:
  - series
  - peliculas
  - contenido tratado como `LAT SUB`
- `animeflv` ahora normaliza labels de servidores como:
  - `YourUpload`
  - `Okru`
  - `Netu`
  - `Mail.ru`
  - `Fembed`
- Se agrego [src/lib/anime-mappings.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/anime-mappings.js) para aprovechar mappings locales de anime.
- Se agrego [src/lib/anime-relations.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/anime-relations.js) para soportar IDs anime extra:
  - `mal:`
  - `anilist:`
  - `kitsu:`
  - `anidb:`
- El matching anime ahora usa datos locales de `animestream-addon`:
  - `catalog.json.gz`
  - `otaku-mappings.json`
- `animeav1` ahora suma metadata adicional cuando esta disponible:
  - `releaseInfo`
  - `runtime`
  - `trailers`
  - `links` relacionados
- `animeflv` ahora suma metadata y thumbnails de episodios cuando se pueden inferir.
- Casos validados:
  - `Frieren`
  - `Your Name.`
  - `Kimetsu no Yaiba: Infinity Castle`
  - `Ingoku Danchi`
- `animeav1` y `animeflv` quedaron desactivados del flujo activo, del manifest y de los catalogs hasta nueva revision.
- El codigo anime se conserva en el repo, pero el deploy publico vuelve a quedar sin providers anime por ahora.

### Animacion retro

- Se agrego `lacartoons` como provider nuevo para series y peliculas animadas clasicas.
- `lacartoons` usa:
  - busqueda por `?Titulo=...`
  - parsing de temporadas y episodios desde HTML
  - `iframe` + extractors compartidos para reproducir
- `lacartoons` por ahora se trata como provider `LAT`.
- Se porto extractor real para `RpmVid`:
  - `api/v1/video?id=<hash>`
  - desencriptado `AES-CBC`
  - extraccion de `source` y subtitulos
- Caso validado:
  - `Coraje, el perro cobarde` S02E01

### Testing y debug

- El tester CLI ahora sirve tambien para providers anime via fallback `tmdb:<id>` cuando no hay IMDb util.
- Se agregaron casos reales de debug anime para validar matching y streams.

### Ranking

- Se ajusto el scoring global para priorizar `animeav1` y `animeflv` en contexto anime.
- La prioridad anime ahora impacta:
  - el bonus de score
  - y la seleccion final global
- Tambien se reforzo el filtro para que providers anime no participen en contenido no anime.
- Como anime queda pausado, esa logica sigue en el repo pero no participa del flujo activo actual.

## [Unreleased] - 2026-04-03

### Providers y coverage

- Se agregaron `netmirror`, `castle` y `seriesmetro` al flujo HTTP activo.
- `lamovie` quedo validado como provider fuerte tanto para peliculas como para series.
- `cinecalidad` quedo reforzado para peliculas usando matching por slug y extraccion de embeds mas alineada con el sitio real.
- `cinecalidad` ahora usa por defecto `https://www.cinecalidad.vg`.
- `cinemacity` fue explorado, comparado contra su repo de referencia y dejado fuera del deploy por no devolver streams fiables.

### Matching y testing

- Se agrego [test-provider.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/scripts/test-provider.js) como tester CLI por TMDB.
- El tester ahora soporta:
  - modo `basic`
  - modo `advanced`
- `lamovie` y `cinecalidad` mejoraron fuertemente su descubrimiento usando:
  - aliases de TMDB
  - probing por slug
  - matching mas tolerante para titulos en espanol y original
- `netmirror` mejoro su matching de titulos y su fallback para series tipo PrimeVideo.

### Idioma y providers multi-language

- `netmirror` y `castle` quedaron etiquetados de forma conservadora como `MULTI` por defecto.
- Se dejo de asumir `CAST` o `LAT` cuando el provider no expone evidencia confiable de audio.
- En `netmirror` ahora se exponen mejor:
  - `tracks`
  - `subtitleLanguages`
  - `trackSummary`
- El trabajo sobre `NetMirror` confirmo que en varios casos las `tracks` observadas eran captions o thumbnails, no audio ES verificable.

### Deploy y documentacion

- `render.yaml` fue actualizado para incluir:
  - `CINECALIDAD_BASE_URL=https://www.cinecalidad.vg`
  - `NETMIRROR_BASE_URL`
  - `NETMIRROR_PLAY_URL`
  - `CASTLE_BASE_URL`
  - `SERIESMETRO_BASE_URL`
- Se dejo documentado que:
  - Render toma variables desde `render.yaml`
  - Railway usa `railway.json` para build/start/healthcheck, pero las variables se cargan manualmente
- Se agrego [ANTIGRAVITY_HANDOFF.md](/C:/Users/lautaroturina/Desktop/Codex/CinePick/docs/ANTIGRAVITY_HANDOFF.md) como guia de continuidad para trabajar desde otros agentes como Gemini o Claude.

## [Unreleased] - 2026-04-01

### Proxy y reproduccion

- Se reforzo el proxy interno de medios para Render y localhost.
- Los streams proxyeados ahora conservan headers reales del extractor, incluyendo `Referer`, cookies y headers especiales.
- Las URLs del proxy ahora incluyen extension real:
  - `.m3u8`
  - `.mp4`
  - `.ts`
  - `.m4s`
- El proxy HLS ahora reescribe manifests `.m3u8`, playlists hijas y segmentos para que tambien pasen por `/p/...`.
- `src/lib/stream-scoring.js` ahora puntua usando URL y headers originales aunque el stream final este proxyeado.

### Seleccion inteligente de streams

- Se agrego `penalty-reliability` persistente por fuente en `runtime/data/source-penalties.json`.
- Se agrego score por host, transporte, idioma, complejidad y penalidad acumulada.
- Se soportan dos modos de seleccion:
  - `STREAM_SELECTION_MODE=global`
  - `STREAM_SELECTION_MODE=per_provider`
- `STREAM_MAX_RESULTS` controla cuantos resultados devuelve el addon despues del score.
- Se agregaron timeouts por provider para evitar que el debug o la resolucion global queden colgados:
  - `PROVIDER_TIMEOUT_MS`
  - `PROVIDER_DEBUG_TIMEOUT_MS`
- La resolucion global de providers ahora corre en paralelo en vez de hacerlo en serie.
- Se agregaron variables para desactivar hosts por provider:
  - `GNULA_DISABLED_SOURCES`
  - `CINECALIDAD_DISABLED_SOURCES`
  - `MHDFLIX_DISABLED_SOURCES`
  - `VERSERIESONLINE_DISABLED_SOURCES`
  - `CINEPLUS123_DISABLED_SOURCES`

### Providers

- `gnula`
  - sigue integrado
  - usa scoring, penalidades y proxy
- `cinecalidad`
  - sigue integrado
  - se ajusto a episodios tipo `ver-el-episodio/...`
  - se agrego soporte de `vimeos`
  - se mejoro `goodstream`
  - usa scoring, penalidades y proxy
- `mhdflix`
  - nuevo provider en `src/providers/mhdflix.js`
  - soporta:
    - busqueda
    - meta
    - episodios
    - streams
    - matching por IDs externos `tt...`
  - usa la API de `core.mhdflix.com`
  - usa scoring, penalidades y proxy
  - se endurecio el matching para titulos cortos y ambiguos:
    - ahora evita elegir cualquier serie que solo contenga una palabra como `From`
    - si no hay match razonable, devuelve `no_best_match`
- `lamovie`
  - nuevo provider en `src/providers/lamovie.js`
  - soporta peliculas y series
  - soporta:
    - busqueda
    - meta
    - episodios
    - streams
    - matching por IDs externos `tt...`
  - usa la API `wp-api/v1`
  - usa scoring, penalidades y proxy
  - se agrego extractor puntual para embeds `lamovie.link`
  - validado con:
    - `Matrix (1999)` en movie
    - `Breaking Bad 1x1` en series
    - `From S2E8` en series
  - el matching ahora prioriza la ruta publica `/series/<slug>`
  - se castiga fuertemente a candidatos de `animes` cuando el match real es una serie normal
- `verseriesonline`
  - nuevo provider en `src/providers/verseriesonline.js`
  - soporta series
  - soporta:
    - busqueda por URL directa
    - busqueda por slug
    - meta
    - episodios
    - streams
    - matching por IDs externos de series
  - soporta la estructura actual del sitio:
    - `/series/<slug>/`
    - `/series/<slug>/temporada-1/`
    - `/series/<slug>/temporada-1/episodio-1/`
  - usa `csrf + cookies + POST /hashembedlink`
  - usa scoring, penalidades y proxy
  - se limpio el parser de `play-option`:
    - ahora toma el `<a>` real de cada player en vez de bloques enormes alrededor de `data-hash`
    - eso evita titulos ofuscados en streams y mejora la legibilidad del score/debug
- `cineplus123`
  - nuevo provider en `src/providers/cineplus123.js`
  - soporta peliculas y series
  - soporta:
    - busqueda
    - meta
    - episodios de series
    - streams via `doo_player_ajax`
    - matching por IDs externos `tt...`
  - series quedo bien encaminado con episodios tipo `/capitulo/<slug>-1x1/`
  - peliculas quedaron parcialmente resueltas:
    - `hanerix/streamwish` validado
    - `cvid` y `uqload` todavia incompletos
  - usa scoring, penalidades y proxy
- `serieskao`
  - nuevo provider en `src/providers/serieskao.js`
  - port basado en la extension original
  - soporta peliculas y series
  - soporta:
    - busqueda
    - meta
    - episodios
    - streams
    - matching por IDs externos `tt...`
  - parsea `videoSources` y descifra `dataLink` antes de pasar por extractores compartidos
  - suma fallback para paginas intermedias como `xupalace`
  - validado:
    - `Breaking Bad 1x1` -> `VidHide`
    - `Matrix (1999)` -> `Voe`
  - usa scoring, penalidades y proxy

### Debug y DX

- `/_debug/stream/:type/:id.json` ahora soporta tambien debug interno para IDs de providers.
- `verseriesonline` expone debug interno con:
  - `csrfTokenPresent`
  - `cookieHeaderPresent`
  - `rawHashCount`
  - `playerCount`
  - `streamCount`
- `cineplus123` expone debug interno para:
  - fichas de serie/pelicula
  - deteccion de episodios
  - players
  - respuesta de `doo_player_ajax`
- Se agrego `scripts/start-local.bat` para lanzar localmente con:
  - `ADDON_URL=http://127.0.0.1:3000`
  - `STREAM_SELECTION_MODE=per_provider`

### Hallazgos

- El problema principal ya no esta en busqueda/meta base, sino en compatibilidad por host.
- `goodstream` sigue siendo un host irregular en Stremio.
- `vimeos` resulto ser un host util en `cinecalidad`.
- Las mejoras compartidas de extractores si impactaron a providers pesados:
  - `cinecalidad` ahora resuelve mejor `streamwish`, `voe` y `vimeos` en casos como `Zootopia`
- `cineplus123` empezo a aportar `netu` y `uqload` en series como `From`
- `lamovie` quedo funcional de punta a punta en primer pase:
  - movie con `vimeos`
  - series con `filemoon`
- `verseriesonline` cambio bastante respecto de la extension original:
  - la busqueda publica no coincide con las rutas viejas
  - las URLs actuales usan `/series/...`
  - la pagina de episodio sigue exponiendo `data-hash` y `csrf`
- `mhdflix` funciona bien con su API, pero la calidad final depende de los hosts concretos que devuelva cada item.
- `mhdflix` tenia una debilidad fuerte con titulos ambiguos y cortos:
  - ya no inventa matches para `From`
  - ahora se aparta si no encuentra un candidato realmente razonable
- `cineplus123` no estaba roto en provider: los bloqueos reales estuvieron en extractores por host.
- En `cineplus123` peliculas, el primer host validado fue `hanerix`.
- En `From S2E8`:
  - `lamovie` ya encuentra `From (2022)` en vez de anime y devuelve streams reales
  - `cinecalidad` tambien resuelve bien ese episodio
  - `verseriesonline` puede seguir siendo mas lento y caer en timeout dentro del debug externo

### Deploy

- El deploy en Render debe incluir `ADDON_URL` con la URL publica real del servicio.
- Si cambia la URL del servicio en Render, hay que actualizar `ADDON_URL`.
- `render.yaml` ahora tambien incluye `LAMOVIE_BASE_URL`.
- `render.yaml` ahora tambien incluye `SERIESKAO_BASE_URL`.
- Railway quedo operativo con:
  - `manifest.json` publico
  - streams proxyeados desde su propio dominio
- Para esta combinacion de providers y hosts, Railway esta respondiendo mejor que Render.

