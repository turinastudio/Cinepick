# Continuation Guide

## Objetivo del proyecto

Construir un addon de Stremio que combine:

- scrapers HTTP latinos/castellanos
- ranking global consistente
- debug real por provider
- proxy interno de medios

Si el trabajo va a continuarse desde otro agente externo, arrancar por:

- [ANTIGRAVITY_HANDOFF.md](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/ANTIGRAVITY_HANDOFF.md)

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
- Render toma variables automaticamente desde [render.yaml](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/render.yaml)
- Railway usa [railway.json](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/railway.json) para build/start/healthcheck, pero las variables se cargan manualmente

## Estado de la migracion HTTP

### Base nueva compartida

- [src/providers/webstreambase.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/webstreambase.js)
- [src/lib/webstreamer/http.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/webstreamer/http.js)
- [src/lib/webstreamer/common.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/webstreamer/common.js)
- [src/lib/webstreamer/resolve.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/webstreamer/resolve.js)

### Providers ya migrados o reforzados sobre la base nueva

- [src/providers/cinecalidad.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/cinecalidad.js)
- [src/providers/cuevana.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/cuevana.js)
- [src/providers/homecine.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/homecine.js)
- [src/providers/tioplus.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/tioplus.js)
- [src/providers/lamovie.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/lamovie.js)
- [src/providers/seriesmetro.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/seriesmetro.js)
- [src/providers/netmirror.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/netmirror.js)
- [src/providers/castle.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/castle.js)

### Providers anime agregados

- [src/providers/animeav1.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/animeav1.js)
  - usa `catalog.json.gz` y `otaku-mappings.json` de `animestream-addon`
  - mejora matching por `imdb`, `tmdb`, `slug` y aliases anime
  - separa `LAT SUB` y `LAT DUB`
  - validado con:
    - `Frieren`
    - `Your Name.`
    - `Kimetsu no Yaiba: Infinity Castle`
- [src/providers/animeflv.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/animeflv.js)
  - usa la estructura `browse + anime_info + episodes + var videos`
  - usa tambien `catalog.json.gz` y `otaku-mappings.json` para matching
  - por ahora se trata como provider `LAT SUB`
  - validado con:
    - `Frieren`
    - `Your Name.`

### Provider animacion retro agregado

- [src/providers/lacartoons.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/lacartoons.js)
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

- [src/providers/verhdlink.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/verhdlink.js)
- [src/providers/cinehdplus.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/cinehdplus.js)

## Extractors

La referencia central es:

- [src/lib/extractors.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/extractors.js)

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

Ya se porto esa idea a [src/lib/extractors.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/extractors.js), pero todavia hace falta validar mas casos concretos porque no todos los embeds responden igual.

## Matching y aliases

Uno de los cambios mas utiles quedo en:

- [src/providers/webstreambase.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/webstreambase.js)

Ahora:

- consulta titulos alternativos desde TMDB usando IMDb ID
- guarda esos aliases en `_searchTitles`
- usa esos titulos alternativos al elegir `bestMatch`

Esto fue clave para casos como:

- `Tangled` -> `Enredados`

## Matching anime

La capa anime nueva usa:

- [src/lib/anime-mappings.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/anime-mappings.js)

Fuentes locales usadas:

- [Recursos/animestream-addon/data/catalog.json.gz](/C:/Users/lautaroturina/Desktop/Codex%20Stremio%20Addon/Recursos/animestream-addon/data/catalog.json.gz)
- [Recursos/animestream-addon/data/otaku-mappings.json](/C:/Users/lautaroturina/Desktop/Codex%20Stremio%20Addon/Recursos/animestream-addon/data/otaku-mappings.json)

Motivo:

- TMDB/IMDb solos fallan demasiado en anime
- el catalogo local aporta `synonyms`, `slug` e `imdb_id`
- `otaku-mappings.json` aporta puentes `tmdb/imdb/title` y flag `dub`

## Limpieza pendiente

### Revisar si se elimina o archiva

- [src/providers/webstreamerlatino.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/webstreamerlatino.js)

Ese archivo quedo conceptualmente reemplazado por providers individuales.

### Revisar antes de deployar sin mirar

- [data/source-penalties.json](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/data/source-penalties.json)
- providers locales todavia no integrados al flujo final

### Providers explorados pero no activos para deploy

- [src/providers/cinemacity.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/cinemacity.js)
  - el repo de referencia tambien devuelve `[]` en los casos probados
  - queda fuera de `index.js` y `manifest.js` hasta nueva validacion

## Orden recomendado para seguir

1. Validar `verhdlink` y `cinehdplus`
2. Limpiar o retirar `webstreamerlatino.js`
3. Revisar `streamwish` con casos concretos

## Tester CLI

Quedo agregado un tester local para validar providers por TMDB sin depender del navegador:

- [test.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/test.js)

Uso:

```powershell
node test.js <tmdbId> <movie|tv> [season] [episode] [provider] [basic|advanced]
```

Ejemplos:

```powershell
node test.js 550 movie null null cinecalidad
node test.js 1396 tv 1 1 lamovie
node test.js 1396 tv 1 1 seriesmetro
node test.js 1396 tv 1 1 netmirror advanced
node test.js 209867 tv 1 1 animeav1 advanced
node test.js 372058 movie null null animeav1 advanced
node test.js 209867 tv 1 1 animeflv advanced
node test.js 372058 movie null null animeflv advanced
node test.js <tmdbId> tv 1 1 lacartoons advanced
node test.js <tmdbId> movie null null lacartoons advanced
```

Atajo por npm:

```powershell
npm run test:provider -- 1396 tv 1 1 lamovie
```

Notas:

- usa TMDB para convertir a IMDb
- llama el debug real del provider desde [src/providers/index.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/index.js)
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

### Anime

- [AnimeAV1 Frieren S01E01](http://127.0.0.1:3000/_debug/provider/animeav1/stream/series/tt22248376:1:1.json)
- [AnimeAV1 Your Name](http://127.0.0.1:3000/_debug/provider/animeav1/stream/movie/tt5311514.json)
- [AnimeFLV Frieren S01E01](http://127.0.0.1:3000/_debug/provider/animeflv/stream/series/tt22248376:1:1.json)
- [AnimeFLV Your Name](http://127.0.0.1:3000/_debug/provider/animeflv/stream/movie/tt5311514.json)

### Animacion retro

- [LACartoons Matrix](http://127.0.0.1:3000/_debug/provider/lacartoons/stream/movie/tt0133093.json)
- [LACartoons Courage S02E01](http://127.0.0.1:3000/_debug/provider/lacartoons/stream/series/tt0220880:2:1.json)
