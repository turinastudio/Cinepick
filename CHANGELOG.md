# Changelog

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

- Se agrego `penalty-reliability` persistente por fuente en `data/source-penalties.json`.
- Se agrego score por host, transporte, idioma, complejidad y penalidad acumulada.
- Se soportan dos modos de seleccion:
  - `STREAM_SELECTION_MODE=global`
  - `STREAM_SELECTION_MODE=per_provider`
- `STREAM_MAX_RESULTS` controla cuantos resultados devuelve el addon despues del score.
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
- Se agrego `start-local.bat` para lanzar localmente con:
  - `ADDON_URL=http://127.0.0.1:3000`
  - `STREAM_SELECTION_MODE=per_provider`

### Hallazgos

- El problema principal ya no esta en busqueda/meta base, sino en compatibilidad por host.
- `goodstream` sigue siendo un host irregular en Stremio.
- `vimeos` resulto ser un host util en `cinecalidad`.
- Las mejoras compartidas de extractores si impactaron a providers pesados:
  - `cinecalidad` ahora resuelve mejor `streamwish`, `voe` y `vimeos` en casos como `Zootopia`
  - `cineplus123` empezo a aportar `netu` y `uqload` en series como `From`
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

### Deploy

- El deploy en Render debe incluir `ADDON_URL` con la URL publica real del servicio.
- Si cambia la URL del servicio en Render, hay que actualizar `ADDON_URL`.
