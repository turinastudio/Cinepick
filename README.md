# Cinepick

Addon de Stremio para peliculas, series y anime con:

- providers HTTP
- proxy interno para HLS/MP4
- seleccion y ranking de streams
- debug global y por provider

## Estado actual

### Providers generales activos

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
- `lacartoons`

### Motor anime integrado

Anime vive como subsistema separado del core general.

Providers anime integrados:

- `animeflv`
- `animeav1`
- `henaojara`

Capacidades:

- `meta` anime
- `stream` anime
- debug global anime
- debug por provider anime
- debug de busqueda anime

## Arquitectura

### Canonico

- `src/app`
- `src/engines`
- `src/shared`

### Compatibilidad

Estos wrappers siguen existiendo para no romper imports o entrypoints viejos:

- [src/server.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/server.js)
- [src/manifest.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/manifest.js)
- [src/providers/index.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/index.js)
- [src/providers/base.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/base.js)
- [src/providers/webstreambase.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/webstreambase.js)
- [src/anime/index.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/anime/index.js)
- [src/anime/detection.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/anime/detection.js)
- [src/lib/stream-scoring.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/stream-scoring.js)

## Ejecutar en local

### Instalacion

```powershell
npm install
```

Version recomendada de Node:

- `20`
- el repo incluye [.nvmrc](/C:/Users/lautaroturina/Desktop/Codex/CinePick/.nvmrc) y [.node-version](/C:/Users/lautaroturina/Desktop/Codex/CinePick/.node-version)

### Inicio rapido

```powershell
$env:ADDON_URL='http://127.0.0.1:3000'
$env:STREAM_SELECTION_MODE='global'
npm start
```

### Inicio con motor anime

```powershell
$env:ADDON_URL='http://127.0.0.1:3000'
$env:STREAM_SELECTION_MODE='global'
$env:ENABLE_ANIME_ENGINE='true'
$env:ANIME_ENGINE_DEBUG='true'
npm start
```

Manifest local:

- [manifest local](http://127.0.0.1:3000/manifest.json)
- [manifest alt](http://127.0.0.1:3000/alt/manifest.json)

## Scripts utiles

### Provider tester

- [scripts/test-provider.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/scripts/test-provider.js)

```powershell
node scripts/test-provider.js <tmdbId> <movie|tv> [season] [episode] [provider] [basic|advanced]
```

Ejemplos:

```powershell
npm run test:provider -- 550 movie null null cinecalidad
npm run test:provider -- 1396 tv 1 1 lamovie
npm run test:provider -- 1396 tv 1 1 seriesmetro
npm run test:provider -- 1396 tv 1 1 netmirror advanced
```

### Smoke tests

```powershell
npm run test:smoke
```

Verifica:

- imports canonicos y wrappers de compatibilidad
- arranque real desde `src/app/server.js`
- dos `movie` generales
- dos `series` generales
- anime para `One Piece`
- anime para `Bunny Girl Senpai`

### Config validation

```powershell
npm run test:config
```

Verifica:

- `render.yaml`
- `railway.json`
- manifest canonico en `src/app/manifest.js`

### Arquitectura

```powershell
npm run test:arch
```

Verifica:

- que los wrappers de compatibilidad sigan existiendo
- que el codigo canonico no vuelva a importar desde wrappers viejos

### Test remoto

```powershell
$env:TEST_BASE_URL='https://autostream-http-production.up.railway.app'
npm run test:remote
```

o:

```powershell
npm run test:remote -- https://autostream-http-production.up.railway.app
```

Verifica:

- `/`
- `/manifest.json`
- debug movie general
- debug series general
- debug anime

### Test completo

```powershell
npm test
```

Resumen rapido:

- `npm run test:config`: valida deploy y manifest canonico
- `npm run test:arch`: valida wrappers e imports internos
- `npm run test:smoke`: valida arranque local y endpoints clave
- `npm run test:remote`: valida un deploy publico
- `npm test`: corre config + arquitectura + smoke

Nota:

- el repo tambien corre estas validaciones automaticamente en GitHub Actions

## Variables importantes

### Core

- `ADDON_URL`
- `STREAM_SELECTION_MODE`
- `STREAM_MAX_RESULTS`
- `SHOW_SUPPORT_STREAM`
- `SUPPORT_URL`
- `PROVIDER_TIMEOUT_MS`
- `PROVIDER_DEBUG_TIMEOUT_MS`
- `EXTRACTOR_TIMEOUT_MS`
- `EXTRACTOR_CANDIDATE_TIMEOUT_MS`
- `WEBSTREAM_HTTP_TIMEOUT_MS`
- `WEBSTREAM_HTTP_RETRIES`
- `TMDB_API_KEY`

### Anime

- `ENABLE_ANIME_ENGINE`
- `ANIME_ENGINE_DEBUG`
- `ANIMEFLV_BASE_URL`
- `ANIMEAV1_BASE_URL`
- `HENAOJARA_BASE_URL`

### Providers

- `GNULA_BASE_URL`
- `CINECALIDAD_BASE_URL`
- `NETMIRROR_BASE_URL`
- `NETMIRROR_PLAY_URL`
- `CASTLE_BASE_URL`
- `CUEVANA_BASE_URL`
- `HOMECINE_BASE_URL`
- `TIOPLUS_BASE_URL`
- `MHDFLIX_BASE_URL`
- `MHDFLIX_API_URL`
- `LAMOVIE_BASE_URL`
- `VERSERIESONLINE_BASE_URL`
- `CINEPLUS123_BASE_URL`
- `SERIESKAO_BASE_URL`
- `SERIESMETRO_BASE_URL`
- `LACARTOONS_BASE_URL`

## Debug

Nota:

- logs del tipo `[streams] <provider> fallo ... timeout after <n>ms` indican timeout de ese provider puntual
- no implican necesariamente fallo total del addon

### Debug global

- [Matrix](http://127.0.0.1:3000/_debug/stream/movie/tt0133093.json)
- [Zootopia 2](http://127.0.0.1:3000/_debug/stream/movie/tt26443597.json)

### Debug por provider

- [CineCalidad Matrix](http://127.0.0.1:3000/_debug/provider/cinecalidad/stream/movie/tt0133093.json)
- [Cuevana Matrix](http://127.0.0.1:3000/_debug/provider/cuevana/stream/movie/tt0133093.json)
- [NetMirror Breaking Bad S01E01](http://127.0.0.1:3000/_debug/provider/netmirror/stream/series/tt0903747:1:1.json)

### Debug anime

- [One Piece](http://127.0.0.1:3000/_debug/stream/series/tt0388629:1:1.json)
- [Bunny Girl Senpai](http://127.0.0.1:3000/_debug/stream/series/tt8993398:1:1.json)
- [AnimeFLV One Piece](http://127.0.0.1:3000/_debug/provider/animeflv/stream/series/tt0388629:1:1.json)
- [AnimeAV1 One Piece](http://127.0.0.1:3000/_debug/provider/animeav1/stream/series/tt0388629:1:1.json)

## Deploy

### Railway

Archivos:

- [package.json](/C:/Users/lautaroturina/Desktop/Codex/CinePick/package.json)
- [railway.json](/C:/Users/lautaroturina/Desktop/Codex/CinePick/railway.json)

Comandos:

- build: `npm install`
- start: `npm start`
- healthcheck: `/`

Variables recomendadas:

- `NODE_ENV=production`
- `ADDON_URL=https://TU-SERVICIO.up.railway.app`
- `STREAM_SELECTION_MODE=global`
- `STREAM_MAX_RESULTS=2`
- `PROVIDER_TIMEOUT_MS=25000`
- `PROVIDER_DEBUG_TIMEOUT_MS=40000`
- `EXTRACTOR_TIMEOUT_MS=3500`
- `EXTRACTOR_CANDIDATE_TIMEOUT_MS=5000`
- `WEBSTREAM_HTTP_RETRIES=1`

Nota:

- Railway no toma variables desde `railway.json`
- cargalas desde `Variables` -> `Raw Editor` en el panel

### Render

Archivo:

- [render.yaml](/C:/Users/lautaroturina/Desktop/Codex/CinePick/render.yaml)

Nota:

- `render.yaml` ya refleja el estado actual del addon
- incluye motor anime habilitable, CTA, timeouts de extractor y `HENAOJARA_BASE_URL`

### Chequeo remoto manual en GitHub

- workflow: [remote-check.yml](/C:/Users/lautaroturina/Desktop/Codex/CinePick/.github/workflows/remote-check.yml)
- uso: ejecutar `Remote Deploy Check` desde GitHub Actions y pasar la URL publica del addon

## Assets y runtime

- logo publico: [public/assets/Logo.png](/C:/Users/lautaroturina/Desktop/Codex/CinePick/public/assets/Logo.png)
- estado runtime: [runtime/data](/C:/Users/lautaroturina/Desktop/Codex/CinePick/runtime/data)

## Historial

- [CHANGELOG.md](/C:/Users/lautaroturina/Desktop/Codex/CinePick/docs/CHANGELOG.md)
