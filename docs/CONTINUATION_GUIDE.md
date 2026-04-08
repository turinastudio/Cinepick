# Continuation Guide

## Objetivo del proyecto

Construir un addon de Stremio que combine:

- scrapers HTTP latinos/castellanos
- ranking global consistente
- debug real por provider
- proxy interno de medios

Si el trabajo va a continuarse desde otro agente externo, arrancar por:

- [ANTIGRAVITY_HANDOFF.md](/C:/Users/lautaroturina/Desktop/Codex/CinePick/docs/ANTIGRAVITY_HANDOFF.md)

## Decision arquitectonica tomada

No se reinicio desde cero.

Se eligio una arquitectura hibrida:

- conservar la estructura actual del addon
  - server
  - manifest
  - debug
  - ranking
- reemplazar/mejorar la capa HTTP con runtime y extractors inspirados en `Northstar`

## Defaults de deploy relevantes

- `CineCalidad` quedo con default en `https://www.cinecalidad.vg`
- Render toma variables automaticamente desde [render.yaml](/C:/Users/lautaroturina/Desktop/Codex/CinePick/render.yaml)
- Railway usa [railway.json](/C:/Users/lautaroturina/Desktop/Codex/CinePick/railway.json) para build/start/healthcheck, pero las variables se cargan manualmente

## Estado de la migracion HTTP

### Base nueva compartida

- [src/providers/webstreambase.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/webstreambase.js)
- [src/lib/webstreamer/http.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/webstreamer/http.js)
- [src/lib/webstreamer/common.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/webstreamer/common.js)
- [src/lib/webstreamer/resolve.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/webstreamer/resolve.js)

### Providers ya migrados o reforzados sobre la base nueva

- [src/providers/cinecalidad.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/cinecalidad.js)
- [src/providers/cuevana.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/cuevana.js)
- [src/providers/homecine.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/homecine.js)
- [src/providers/tioplus.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/tioplus.js)
- [src/providers/lamovie.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/lamovie.js)
- [src/providers/seriesmetro.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/seriesmetro.js)
- [src/providers/netmirror.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/netmirror.js)
- [src/providers/castle.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/castle.js)

### Trabajo anime pausado

- [src/providers/animeav1.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/animeav1.js)
  - el codigo queda en el repo pero desactivado de `index.js` y `manifest.js`
  - usa `catalog.json.gz` y `otaku-mappings.json` de `animestream-addon`
  - mejora matching por `imdb`, `tmdb`, `slug` y aliases anime
  - separa `LAT SUB` y `LAT DUB`
  - soporta tambien IDs:
    - `mal:`
    - `anilist:`
    - `kitsu:`
    - `anidb:`
  - suma metadata mas rica:
    - `releaseInfo`
    - `runtime`
    - `trailers`
    - `links` relacionados
  - validado durante esta etapa con:
    - `Frieren`
    - `Your Name.`
    - `Kimetsu no Yaiba: Infinity Castle`
    - `Ingoku Danchi`
- [src/providers/animeflv.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/animeflv.js)
  - el codigo queda en el repo pero desactivado de `index.js` y `manifest.js`
  - usa una estrategia mas fiel a la pagina:
    - `browse`
    - `anime_info`
    - `episodes`
    - `var videos`
    - fallback por slug directo `/ver/<slug>-<ep>`
  - usa tambien `catalog.json.gz` y `otaku-mappings.json` para matching
  - por ahora se trata como provider `LAT SUB`
  - soporta tambien IDs:
    - `mal:`
    - `anilist:`
    - `kitsu:`
    - `anidb:`
  - suma thumbnails de episodios y metadata extra cuando el HTML lo permite
  - validado durante esta etapa con:
    - `Frieren`
    - `Your Name.`
    - `Ingoku Danchi`

Decision actual:

- anime queda pausado hasta nueva revision
- no se deploya
- no aparece en catalogs
- no participa del flujo global activo

### Provider animacion retro agregado

- [src/providers/lacartoons.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/lacartoons.js)
  - usa la estructura HTML simple de `lacartoons`
  - busca con `?Titulo=...`
  - arma episodios desde `.estilo-temporada + .episodio-panel`
  - resuelve reproduccion desde `iframe`
  - por ahora se trata como provider `LAT`
  - pensado para series y peliculas animadas clasicas
  - validado con:
    - `Coraje, el perro cobarde` S02E01

### Estado actual de idioma para providers multi-language

- `netmirror`
- `castle`

En el estado actual del proyecto se muestran como `MULTI` por defecto, salvo evidencia fuerte de idioma.

Razon:

- en `NetMirror` las `tracks` observadas no probaron audio ES/LAT de forma confiable
- en `Castle` conviene no sobreprometer idioma hasta revisar mejor pistas/metadata por stream

### Providers agregados para futuro, todavia con validacion pendiente

- [src/providers/verhdlink.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/verhdlink.js)
- [src/providers/cinehdplus.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/cinehdplus.js)

## Extractors

La referencia central es:

- [src/lib/extractors.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/extractors.js)

### Extractors reforzados o portados durante esta etapa

- `fastream`
- `mixdrop`
- `emturbovid`
- `cuevana-player`
- `strp2p`
- `streamembed`
- `vidsrc`
- `dropload`
- `vidora`
- `streamwish` ahora intenta primero el flujo `playback` cifrado antes del fallback HTML

### Nota importante sobre Streamwish

`Northstar` resuelve `Streamwish` usando:

- `/api/videos/:id/embed/playback`
- payload cifrado
- desencriptado `aes-256-gcm`

Ya se porto esa idea a [src/lib/extractors.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/extractors.js), pero todavia hace falta validar mas casos concretos porque no todos los embeds responden igual.

## Matching y aliases

Uno de los cambios mas utiles quedo en:

- [src/providers/webstreambase.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/webstreambase.js)

Ahora:

- consulta titulos alternativos desde TMDB usando IMDb ID
- guarda esos aliases en `_searchTitles`
- usa esos titulos alternativos al elegir `bestMatch`

Esto fue clave para casos como:

- `Tangled` -> `Enredados`

## Matching anime

La capa anime nueva usa:

- [src/lib/anime-mappings.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/anime-mappings.js)
- [src/lib/anime-relations.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/anime-relations.js)

Fuentes locales usadas:

- [Recursos/animestream-addon/data/catalog.json.gz](/C:/Users/lautaroturina/Desktop/Codex/CinePick/Recursos/animestream-addon/data/catalog.json.gz)
- [Recursos/animestream-addon/data/otaku-mappings.json](/C:/Users/lautaroturina/Desktop/Codex/CinePick/Recursos/animestream-addon/data/otaku-mappings.json)

Motivo:

- TMDB/IMDb solos fallan demasiado en anime
- el catalogo local aporta `synonyms`, `slug` e `imdb_id`
- `otaku-mappings.json` aporta puentes `tmdb/imdb/title` y flag `dub`
- `anime-relations.js` agrega compatibilidad con IDs anime de:
  - `MyAnimeList`
  - `AniList`
  - `Kitsu`
  - `AniDB`
  usando `relations.yuna.moe`

Hallazgo final de esta etapa:

- el scraping anime mejoro bastante cuando se lo acerco a `animeflv-stremio-addon`
- aun asi, la experiencia global no quedo lo suficientemente prolija como para dejar anime activo en deploy
- por eso el codigo se conserva, pero el feature queda pausado

## Ranking anime

Se ajusto [src/lib/stream-scoring.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/stream-scoring.js) para que:

- en contexto anime, `animeav1` y `animeflv` tengan bonus adicional
- y la seleccion global intente reservar lugar primero para esos providers

Objetivo:

- que en anime real no ganen tan facil providers generales como `Gnula`, `Mhdflix` o `VerSeriesOnline`
- sin activar esa prioridad en contenido normal

Estado actual:

- esta logica queda en el repo como trabajo pausado
- como los providers anime fueron desactivados del flujo activo, hoy esa parte no participa del deploy

## Limpieza pendiente

### Revisar si se elimina o archiva

- [src/providers/webstreamerlatino.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/webstreamerlatino.js)

Ese archivo quedo conceptualmente reemplazado por providers individuales.

### Revisar antes de deployar sin mirar

- [source-penalties.json](/C:/Users/lautaroturina/Desktop/Codex/CinePick/runtime/data/source-penalties.json)
- providers locales todavia no integrados al flujo final

### Providers explorados pero no activos para deploy

- [src/providers/cinemacity.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/cinemacity.js)
  - el repo de referencia tambien devuelve `[]` en los casos probados
  - queda fuera de `index.js` y `manifest.js` hasta nueva validacion

## Orden recomendado para seguir

1. Validar `verhdlink` y `cinehdplus`
2. Limpiar o retirar `webstreamerlatino.js`
3. Revisar `streamwish` con casos concretos

## Tester CLI

Quedo agregado un tester local para validar providers por TMDB sin depender del navegador:

- [test-provider.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/scripts/test-provider.js)

Uso:

```powershell
node scripts/test-provider.js <tmdbId> <movie|tv> [season] [episode] [provider] [basic|advanced]
```

Ejemplos:

```powershell
node scripts/test-provider.js 550 movie null null cinecalidad
node scripts/test-provider.js 1396 tv 1 1 lamovie
node scripts/test-provider.js 1396 tv 1 1 seriesmetro
node scripts/test-provider.js 1396 tv 1 1 netmirror advanced
node scripts/test-provider.js <tmdbId> tv 1 1 lacartoons advanced
node scripts/test-provider.js <tmdbId> movie null null lacartoons advanced
```

Atajo por npm:

```powershell
npm run test:provider -- 1396 tv 1 1 lamovie
```

Notas:

- usa TMDB para convertir a IMDb
- llama el debug real del provider desde [src/providers/index.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/index.js)
- sirve para comparar rapido coverage con repos de referencia como Nuvio
- `basic` mantiene la salida corta original
- `advanced` agrega `bestMatch`, `searchAttempts`, `players`, `trackSummary`, `subtitleLanguages`

## Endpoints utiles para continuidad

### Global

- [debug global Matrix](http://127.0.0.1:3000/_debug/stream/movie/tt0133093.json)
- [debug global Zootopia 2](http://127.0.0.1:3000/_debug/stream/movie/tt26443597.json)

### HTTP

- [CineCalidad Matrix](http://127.0.0.1:3000/_debug/provider/cinecalidad/stream/movie/tt0133093.json)
- [Cuevana Matrix](http://127.0.0.1:3000/_debug/provider/cuevana/stream/movie/tt0133093.json)
- [HomeCine Enredados](http://127.0.0.1:3000/_debug/provider/homecine/stream/movie/tt0398286.json)
- [TioPlus Hamnet](http://127.0.0.1:3000/_debug/provider/tioplus/stream/movie/tt14905854.json)
- [LaMovie Breaking Bad S01E01](http://127.0.0.1:3000/_debug/provider/lamovie/stream/series/tt0903747:1:1.json)
- [NetMirror Breaking Bad S01E01](http://127.0.0.1:3000/_debug/provider/netmirror/stream/series/tt0903747:1:1.json)
- [Castle Breaking Bad S01E01](http://127.0.0.1:3000/_debug/provider/castle/stream/series/tt0903747:1:1.json)
- [SeriesMetro Breaking Bad S01E01](http://127.0.0.1:3000/_debug/provider/seriesmetro/stream/series/tt0903747:1:1.json)

### Animacion retro

- [LACartoons Matrix](http://127.0.0.1:3000/_debug/provider/lacartoons/stream/movie/tt0133093.json)
- [LACartoons Courage S02E01](http://127.0.0.1:3000/_debug/provider/lacartoons/stream/series/tt0220880:2:1.json)

