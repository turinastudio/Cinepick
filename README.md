# Stremio Web Scraper Addon

Addon de Stremio para combinar:

- providers HTTP latinos/castellanos
- ranking global
- proxy interno para HLS/MP4
- debug por provider y debug global

La arquitectura actual mezcla lo mejor de dos mundos:

- la estructura de addon, ranking y debug de este repo
- una capa HTTP/extractors reforzada con ideas portadas desde `Northstar`

## Estado actual

### Providers HTTP funcionando

- `gnula`
- `cinecalidad`
- `netmirror`
- `castle`
- `cuevana`
- `homecine`
- `tioplus`
- `mhdflix`
- `lamovie`
- `seriesmetro`
- `verseriesonline`
- `cineplus123`
- `serieskao`

### Providers anime funcionando

- `animeav1`
  - soporta series y peliculas anime
  - separa `LAT SUB` y `LAT DUB`
  - usa mappings locales desde `animestream-addon` para mejorar matching
- `animeflv`
  - soporta series y peliculas anime
  - actualmente se trata como provider `LAT SUB`
  - usa mappings locales para mejorar matching anime

### Nota sobre providers multi-language

- `netmirror`
- `castle`

Hoy se tratan como `MULTI` salvo que haya evidencia clara de idioma.

Motivo:

- los sitios/proveedores no exponen de forma confiable la pista de audio real en todos los casos
- `NetMirror` suele devolver renditions y tracks auxiliares, pero no audio ES/LAT verificable
- `Castle` puede tener metadata util, pero por ahora conviene ser conservadores en el deploy publico

### Providers HTTP preparados pero pendientes de validar mejor

- `verhdlink`
- `cinehdplus`

### Providers explorados pero no activados para deploy

- `cinemacity`
  - en el repo de referencia y en este repo hoy no devuelve streams fiables
  - queda fuera del flujo publico hasta nueva validacion

## Arquitectura

### Entrada principal

- [src/server.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/server.js)
- [src/providers/index.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/index.js)
- [src/manifest.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/manifest.js)

### Capa HTTP nueva

- [src/providers/webstreambase.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/webstreambase.js)
- [src/lib/webstreamer/http.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/webstreamer/http.js)
- [src/lib/webstreamer/common.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/webstreamer/common.js)
- [src/lib/webstreamer/resolve.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/webstreamer/resolve.js)

Esta capa usa:

- `axios`
- `cheerio-without-node-native`
- `crypto-js`

### Capa de extractors

- [src/lib/extractors.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/extractors.js)

Hoy mezcla extractors previos del proyecto con ports/adaptaciones inspiradas en `Northstar` y `Cloudstream`.

### Ranking y formato

- [src/lib/stream-scoring.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/stream-scoring.js)
- [src/lib/stream-format.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/stream-format.js)

## Ejecutar en local

### Instalacion

```powershell
npm install
```

### Inicio rapido

```powershell
$env:ADDON_URL='http://127.0.0.1:3000'
$env:STREAM_SELECTION_MODE='global'
npm start
```

### Tester CLI rapido

Tambien existe un tester de providers por terminal:

```powershell
npm run test:provider -- 550 movie null null cinecalidad
npm run test:provider -- 1396 tv 1 1 lamovie
npm run test:provider -- 1396 tv 1 1 seriesmetro
npm run test:provider -- 1396 tv 1 1 netmirror advanced
```

Formato:

```powershell
node test.js <tmdbId> <movie|tv> [season] [episode] [provider] [basic|advanced]
```

Ejemplos utiles:

```powershell
node test.js 550 movie null null cinecalidad
node test.js 1396 tv 1 1 lamovie
node test.js 1396 tv 1 1 seriesmetro
node test.js 1396 tv 1 1 netmirror advanced
node test.js 209867 tv 1 1 animeav1 advanced
node test.js 372058 movie null null animeav1 advanced
node test.js 209867 tv 1 1 animeflv advanced
node test.js 372058 movie null null animeflv advanced
```

Modos:

- `basic`
  - salida corta, como el tester original
- `advanced`
  - agrega `bestMatch`, `searchAttempts`, `players`, `trackSummary`, etc.

Manifest local:

- [manifest local](http://127.0.0.1:3000/manifest.json)

Healthcheck:

- [health local](http://127.0.0.1:3000/)

## Variables de entorno importantes

### Core

- `ADDON_URL`
- `STREAM_SELECTION_MODE`
- `STREAM_MAX_RESULTS`
- `PROVIDER_TIMEOUT_MS`
- `PROVIDER_DEBUG_TIMEOUT_MS`
- `TMDB_API_KEY`

### HTTP providers

- `GNULA_BASE_URL`
- `CINECALIDAD_BASE_URL`
- `NETMIRROR_BASE_URL`
- `NETMIRROR_PLAY_URL`
- `CASTLE_BASE_URL`
- `CUEVANA_BASE_URL`
- `HOMECINE_BASE_URL`
- `TIOPLUS_BASE_URL`
- `VERHDLINK_BASE_URL`
- `CINEHDPLUS_BASE_URL`
- `MHDFLIX_BASE_URL`
- `MHDFLIX_API_URL`
- `LAMOVIE_BASE_URL`
- `VERSERIESONLINE_BASE_URL`
- `CINEPLUS123_BASE_URL`
- `SERIESKAO_BASE_URL`
- `SERIESMETRO_BASE_URL`

### Anime providers

- `ANIMEAV1_BASE_URL`
- `ANIMEFLV_BASE_URL`

## Debug util

### Debug global

- [debug global Matrix](http://127.0.0.1:3000/_debug/stream/movie/tt0133093.json)
- [debug global Zootopia 2](http://127.0.0.1:3000/_debug/stream/movie/tt26443597.json)

### Debug por provider

- [CineCalidad Matrix](http://127.0.0.1:3000/_debug/provider/cinecalidad/stream/movie/tt0133093.json)
- [Cuevana Matrix](http://127.0.0.1:3000/_debug/provider/cuevana/stream/movie/tt0133093.json)
- [HomeCine Enredados](http://127.0.0.1:3000/_debug/provider/homecine/stream/movie/tt0398286.json)
- [TioPlus Hamnet](http://127.0.0.1:3000/_debug/provider/tioplus/stream/movie/tt14905854.json)
- [NetMirror Breaking Bad S01E01](http://127.0.0.1:3000/_debug/provider/netmirror/stream/series/tt0903747:1:1.json)
- [Castle Breaking Bad S01E01](http://127.0.0.1:3000/_debug/provider/castle/stream/series/tt0903747:1:1.json)
- [SeriesMetro Breaking Bad S01E01](http://127.0.0.1:3000/_debug/provider/seriesmetro/stream/series/tt0903747:1:1.json)
- [AnimeAV1 Frieren S01E01](http://127.0.0.1:3000/_debug/provider/animeav1/stream/series/tt22248376:1:1.json)
- [AnimeAV1 Your Name](http://127.0.0.1:3000/_debug/provider/animeav1/stream/movie/tt5311514.json)
- [AnimeFLV Frieren S01E01](http://127.0.0.1:3000/_debug/provider/animeflv/stream/series/tt22248376:1:1.json)
- [AnimeFLV Your Name](http://127.0.0.1:3000/_debug/provider/animeflv/stream/movie/tt5311514.json)

## Deploy en Railway

### Archivos preparados

- [package.json](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/package.json)
- [package-lock.json](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/package-lock.json)
- [railway.json](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/railway.json)

### Comandos esperados por Railway

- Build: `npm install`
- Start: `npm start`
- Healthcheck: `/`

### Variables recomendadas en Railway

- `render.yaml` ya deja precargadas estas variables para Render.
- En Railway, `railway.json` no autoinyecta `envVars`, asi que estas se cargan manualmente en `Variables`.

- `NODE_ENV=production`
- `ADDON_URL=https://TU-SERVICIO.up.railway.app`
- `STREAM_SELECTION_MODE=global`
- `STREAM_MAX_RESULTS=2`
- `PROVIDER_TIMEOUT_MS=25000`
- `PROVIDER_DEBUG_TIMEOUT_MS=40000`
- `TMDB_API_KEY=439c478a771f35c05022f9feabcca01c`
- `GNULA_BASE_URL=https://gnula.life`
- `CINECALIDAD_BASE_URL=https://www.cinecalidad.vg`
- `NETMIRROR_BASE_URL=https://net22.cc`
- `NETMIRROR_PLAY_URL=https://net52.cc`
- `CASTLE_BASE_URL=https://api.fstcy.com`
- `CUEVANA_BASE_URL=https://ww1.cuevana3.is`
- `HOMECINE_BASE_URL=https://homecine.to`
- `TIOPLUS_BASE_URL=https://tioplus.app`
- `VERHDLINK_BASE_URL=https://verhdlink.com`
- `CINEHDPLUS_BASE_URL=https://cinehdplus.gratis`
- `MHDFLIX_BASE_URL=https://ww1.mhdflix.com`
- `MHDFLIX_API_URL=https://core.mhdflix.com`
- `LAMOVIE_BASE_URL=https://la.movie`
- `VERSERIESONLINE_BASE_URL=https://www.verseriesonline.net`
- `CINEPLUS123_BASE_URL=https://cineplus123.org`
- `SERIESKAO_BASE_URL=https://serieskao.top`
- `SERIESMETRO_BASE_URL=https://www3.seriesmetro.net`

### Verificacion despues del deploy

- `https://TU-SERVICIO.up.railway.app/`
- `https://TU-SERVICIO.up.railway.app/manifest.json`

## Documentacion adicional

- [CONTINUATION_GUIDE.md](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/CONTINUATION_GUIDE.md)
- [ANTIGRAVITY_HANDOFF.md](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/ANTIGRAVITY_HANDOFF.md)
- [RESOURCES_USED.md](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/RESOURCES_USED.md)
- [CLOUDSTREAM_EXTRACTORS_STATUS.md](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/CLOUDSTREAM_EXTRACTORS_STATUS.md)
- [PORTING_GUIDE_ANIYOMI_TO_STREMIO.md](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/PORTING_GUIDE_ANIYOMI_TO_STREMIO.md)
