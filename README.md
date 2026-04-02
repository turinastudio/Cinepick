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
- `cuevana`
- `homecine`
- `tioplus`
- `mhdflix`
- `lamovie`
- `verseriesonline`
- `cineplus123`
- `serieskao`

### Providers HTTP preparados pero pendientes de validar mejor

- `verhdlink`
- `cinehdplus`

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

## Debug util

### Debug global

- [debug global Matrix](http://127.0.0.1:3000/_debug/stream/movie/tt0133093.json)
- [debug global Zootopia 2](http://127.0.0.1:3000/_debug/stream/movie/tt26443597.json)

### Debug por provider

- [CineCalidad Matrix](http://127.0.0.1:3000/_debug/provider/cinecalidad/stream/movie/tt0133093.json)
- [Cuevana Matrix](http://127.0.0.1:3000/_debug/provider/cuevana/stream/movie/tt0133093.json)
- [HomeCine Enredados](http://127.0.0.1:3000/_debug/provider/homecine/stream/movie/tt0398286.json)
- [TioPlus Hamnet](http://127.0.0.1:3000/_debug/provider/tioplus/stream/movie/tt14905854.json)

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

- `NODE_ENV=production`
- `ADDON_URL=https://TU-SERVICIO.up.railway.app`
- `STREAM_SELECTION_MODE=global`
- `STREAM_MAX_RESULTS=2`
- `PROVIDER_TIMEOUT_MS=25000`
- `PROVIDER_DEBUG_TIMEOUT_MS=40000`
- `TMDB_API_KEY=439c478a771f35c05022f9feabcca01c`
- `GNULA_BASE_URL=https://gnula.life`
- `CINECALIDAD_BASE_URL=https://www.cinecalidad.ec`
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

### Verificacion despues del deploy

- `https://TU-SERVICIO.up.railway.app/`
- `https://TU-SERVICIO.up.railway.app/manifest.json`

## Documentacion adicional

- [CONTINUATION_GUIDE.md](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/CONTINUATION_GUIDE.md)
- [RESOURCES_USED.md](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/RESOURCES_USED.md)
- [CLOUDSTREAM_EXTRACTORS_STATUS.md](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/CLOUDSTREAM_EXTRACTORS_STATUS.md)
- [PORTING_GUIDE_ANIYOMI_TO_STREMIO.md](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/PORTING_GUIDE_ANIYOMI_TO_STREMIO.md)
