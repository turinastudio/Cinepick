# Cinepick

Addon de Stremio para combinar:

- providers HTTP latinos/castellanos
- ranking global
- proxy interno para HLS/MP4
- debug por provider y debug global

## Cambios recientes

### Sesion 2026-04-07 / 2026-04-08

- identidad publica actualizada a `CinePick`
- logo servido desde el propio addon usando `public/assets/Logo.png`
- soporte de `ADDON_URL` como override canonico para URLs publicas
- CTA de soporte agregado al final de la respuesta de `/stream`, sin tocar scoring ni matching
- ruta alternativa `\/alt\/manifest.json` para facilitar pruebas y romper cache de Stremio
- formato visual de streams simplificado:
  - izquierda: `CinePick`
  - derecha:
    - `Titulo`
    - `Latino/Castellano/Multilenguaje/Subtitulado`
    - `Provider - Fuente`
- separacion entre logica y presentacion:
  - `_rawTitle` para scoring y deteccion tecnica
  - `_displayTitle` para mostrar titulos mas limpios en Stremio
- `_displayTitle` propagado a los providers principales para mejorar como se ve el titulo final
- hardening del pipeline de streams:
  - validacion de URLs antes de scorear/devolver streams
  - deteccion de host usando `_targetUrl` para no perder la fuente real tras el proxy
  - timeouts mas agresivos en extractors para reducir latencia
  - timeout por candidato en `webstreamer/resolve`
  - fallback generico `GenericM3U8` / `JWPlayer` cuando falla un extractor especifico
  - headers y validacion de estado reforzados en `Dood`
  - reintentos cortos para errores HTTP transitorios en `webstreamer/http`
- matching interno mejorado en `scoreSearchCandidate()`
- matching endurecido contra falsos positivos en providers con logica custom:
  - `cineplus123`
  - `gnula`
  - `mhdflix`
  - `serieskao`
  - `verseriesonline`
  - `lamovie`
- set activo alineado con el contrato actual:
  - `animeav1` y `animeflv` removidos del repo y del flujo activo
  - `verhdlink` y `cinehdplus` removidos del flujo activo y de `idPrefixes`
  - conflicto de alias `waaw` corregido en extractors
  - catalogs removidos del manifest y del server
- integracion de motor anime dentro de Cinepick:
  - port de AniPick como subsistema aislado en `src/anime/legacy`
  - deteccion anime para ids explicitos (`animeflv:`, `animeav1:`, `henaojara:`, `anilist:`, `kitsu:`, `mal:`, `anidb:`)
  - deteccion anime para `tt...` / `tmdb:...` usando senales fuertes desde TMDB
  - `meta`, `stream`, debug global anime, debug por provider anime y debug de busqueda anime funcionando
  - branding y CTA del motor anime alineados a `Cinepick`
  - metadata anime enriquecida con `originalTitle` y aliases para mejorar matching ingles <-> romaji
  - deduplicacion anime reforzada con target canonico
  - matching anime relajado de forma controlada para aceptar candidatos correctos cuando el problema es falta de alias o diferencia ingles/romaji
- reorganizacion estructural del repo para reflejar la arquitectura real:
  - `src/app/` como contenedor del addon
  - `src/engines/general/` para el motor general
  - `src/engines/anime/` para el adaptador del motor anime
  - `src/shared/` para utilidades comunes (`support`, `format`, `dedupe`, `debug`)
  - `src/server.js` y `src/manifest.js` quedan como wrappers de compatibilidad
  - el arranque principal del proyecto ahora apunta a `src/app/server.js`

Detalle tecnico adicional:

- [SESSION_CHANGES_2026-04-07.md](/C:/Users/lautaroturina/Desktop/Codex/CinePick/docs/SESSION_CHANGES_2026-04-07.md)

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
- `lacartoons`

### Motor anime integrado

El repo vuelve a tener soporte anime, pero ya no como los archivos viejos mezclados en `src/providers`.

Ahora vive como subsistema encapsulado:

- [src/anime/index.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/anime/index.js)
- [src/anime/legacy](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/anime/legacy)

Providers anime hoy integrados:

- `animeflv`
- `animeav1`
- `henaojara`

Capacidades ya soportadas:

- `meta` anime
- `stream` anime
- debug global anime
- debug por provider anime
- debug de busqueda por provider anime

Decision importante:

- el motor anime usa su propio pipeline interno de resolucion y seleccion
- no se mezclo a la fuerza con el scoring general de Cinepick
- la integracion se hace por routing en `server.js`, no inyectando los providers anime dentro del core general

Motivo:

- reducir riesgo sobre el flujo ya estable de peliculas/series
- mantener aislada la logica especifica de anime
- poder depurar anime sin contaminar providers generales

### Providers animacion retro funcionando

- `lacartoons`
  - soporta series y peliculas animadas clasicas
  - actualmente se trata como provider `LAT`
  - usa HTML simple del sitio:
    - busqueda por `?Titulo=...`
    - temporadas por paneles
    - reproduccion desde `iframe`
  - validado con:
    - `Coraje, el perro cobarde` S02E01

### Nota sobre providers multi-language

- `netmirror`
- `castle`

Hoy se tratan como `MULTI` salvo que haya evidencia clara de idioma.

Motivo:

- los sitios/proveedores no exponen de forma confiable la pista de audio real en todos los casos
- `NetMirror` suele devolver renditions y tracks auxiliares, pero no audio ES/LAT verificable
- `Castle` puede tener metadata util, pero por ahora conviene ser conservadores en el deploy publico

### Providers explorados pero no activados para deploy

- `cinemacity`
  - en el repo de referencia y en este repo hoy no devuelve streams fiables
  - queda fuera del flujo publico hasta nueva validacion

## Arquitectura

### Contenedor

- [src/app/server.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/app/server.js)
- [src/app/manifest.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/app/manifest.js)
- [src/server.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/server.js)
- [src/manifest.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/manifest.js)

`src/server.js` y `src/manifest.js` siguen existiendo para no romper entrypoints, pero ahora delegan en `src/app/`.

### Motor general

- [src/engines/general/index.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/engines/general/index.js)
- [src/engines/general/providers/index.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/engines/general/providers/index.js)
- [src/engines/general/providers/core.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/engines/general/providers/core.js)
- [src/engines/general/providers/base.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/engines/general/providers/base.js)
- [src/engines/general/providers/webstreambase.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/engines/general/providers/webstreambase.js)
- [src/engines/general/scoring.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/engines/general/scoring.js)
- [src/engines/general/scoring/core.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/engines/general/scoring/core.js)
- [src/providers/index.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/index.js)

### Subsistema anime

- [src/engines/anime/index.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/engines/anime/index.js)
- [src/engines/anime/core.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/engines/anime/core.js)
- [src/engines/anime/detection.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/engines/anime/detection.js)
- [src/anime/index.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/anime/index.js)
- [src/anime/detection.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/anime/detection.js)
- [src/anime/legacy/lib/external-pipeline.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/anime/legacy/lib/external-pipeline.js)
- [src/anime/legacy/lib/external-resolution.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/anime/legacy/lib/external-resolution.js)
- [src/anime/legacy/lib/metadata.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/anime/legacy/lib/metadata.js)
- [src/anime/legacy/lib/stream-selection.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/anime/legacy/lib/stream-selection.js)

Flujo actual del motor anime:

- Stremio manda un `id`
- `server.js` decide si deriva al motor anime
- si el id es anime explicito, entra directo
- si el id es `tt...` o `tmdb:...`, [detection.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/anime/detection.js) usa TMDB para decidir si es anime
- el motor anime resuelve metadata externa
- la metadata se enriquece con `originalTitle` y aliases
- luego se generan `searchTerms` en ingles, original, romaji y variantes
- cada provider anime busca candidatos
- el pipeline acepta candidatos correctos aunque el score no sea perfecto cuando la evidencia es suficiente
- recien ahi se resuelven streams y se aplica la seleccion del motor anime

### Shared

- [src/shared/support-stream.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/shared/support-stream.js)
- [src/shared/stream-format.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/shared/stream-format.js)
- [src/shared/dedupe.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/shared/dedupe.js)
- [src/shared/debug.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/shared/debug.js)

Estas piezas ya se usan desde ambos motores para evitar duplicacion y preparar una migracion futura mas limpia.

### Capa HTTP nueva

- [src/providers/webstreambase.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/webstreambase.js)
- [src/lib/webstreamer/http.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/webstreamer/http.js)
- [src/lib/webstreamer/common.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/webstreamer/common.js)
- [src/lib/webstreamer/resolve.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/webstreamer/resolve.js)

Esta capa usa:

- `axios`
- `cheerio-without-node-native`
- `crypto-js`

### Capa de extractors

- [src/lib/extractors.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/extractors.js)

Hoy mezcla extractors previos del proyecto con ports/adaptaciones inspiradas en `Northstar` y `Cloudstream`.

### Ranking y formato

- [src/lib/stream-scoring.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/stream-scoring.js)
- [src/lib/stream-format.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/stream-format.js)

Regla importante actual:

- el flujo global activo hoy prioriza solo providers actualmente habilitados en `index.js` y `manifest.js`
- el addon ya no publica catalogs y responde solo con `meta` y `stream`

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

`npm start` ahora arranca desde [src/app/server.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/app/server.js).

### Inicio rapido con motor anime

```powershell
$env:ADDON_URL='http://127.0.0.1:3000'
$env:STREAM_SELECTION_MODE='global'
$env:ENABLE_ANIME_ENGINE='true'
$env:ANIME_ENGINE_DEBUG='true'
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
node scripts/test-provider.js <tmdbId> <movie|tv> [season] [episode] [provider] [basic|advanced]
```

Ejemplos utiles:

```powershell
node scripts/test-provider.js 550 movie null null cinecalidad
node scripts/test-provider.js 1396 tv 1 1 lamovie
node scripts/test-provider.js 1396 tv 1 1 seriesmetro
node scripts/test-provider.js 1396 tv 1 1 netmirror advanced
node scripts/test-provider.js <tmdbId> tv 1 1 lacartoons advanced
node scripts/test-provider.js <tmdbId> movie null null lacartoons advanced
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
- `SHOW_SUPPORT_STREAM`
- `SUPPORT_URL`
- `PROVIDER_TIMEOUT_MS`
- `PROVIDER_DEBUG_TIMEOUT_MS`
- `EXTRACTOR_TIMEOUT_MS`
- `EXTRACTOR_CANDIDATE_TIMEOUT_MS`
- `WEBSTREAM_HTTP_TIMEOUT_MS`
- `WEBSTREAM_HTTP_RETRIES`
- `TMDB_API_KEY`
- `ENABLE_ANIME_ENGINE`
- `ANIME_ENGINE_DEBUG`

### HTTP providers

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

### Animacion retro

- `LACARTOONS_BASE_URL`

### Motor anime

- `ANIMEFLV_BASE_URL`
- `ANIMEAV1_BASE_URL`
- `HENAOJARA_BASE_URL`

## Debug util

Nota operativa:

- logs del tipo `[streams] <provider> fallo ... timeout after <n>ms` indican que ese provider puntual no llego a tiempo
- no significan necesariamente que el addon haya fallado completo
- mientras otros providers respondan, Stremio puede seguir mostrando streams normalmente

### Debug global

- [debug global Matrix](http://127.0.0.1:3000/_debug/stream/movie/tt0133093.json)
- [debug global Zootopia 2](http://127.0.0.1:3000/_debug/stream/movie/tt26443597.json)

### Debug por provider

- [CineCalidad Matrix](http://127.0.0.1:3000/_debug/provider/cinecalidad/stream/movie/tt0133093.json)

### Debug anime

- [anime debug One Piece](http://127.0.0.1:3000/_debug/stream/series/tt0388629:1:1.json)
- [anime debug Bunny Girl Senpai](http://127.0.0.1:3000/_debug/stream/series/tt8993398:1:1.json)
- [anime provider animeflv One Piece](http://127.0.0.1:3000/_debug/provider/animeflv/stream/series/tt0388629:1:1.json)
- [anime provider animeav1 One Piece](http://127.0.0.1:3000/_debug/provider/animeav1/stream/series/tt0388629:1:1.json)
- [anime provider henaojara One Piece](http://127.0.0.1:3000/_debug/provider/henaojara/stream/series/tt0388629:1:1.json)
- [anime search animeflv Bunny Girl Senpai](http://127.0.0.1:3000/_debug/search/animeflv/series/Rascal%20Does%20Not%20Dream%20of%20Bunny%20Girl%20Senpai.json)
- [anime search animeav1 Bunny Girl Senpai](http://127.0.0.1:3000/_debug/search/animeav1/series/Rascal%20Does%20Not%20Dream%20of%20Bunny%20Girl%20Senpai.json)
- [Cuevana Matrix](http://127.0.0.1:3000/_debug/provider/cuevana/stream/movie/tt0133093.json)
- [HomeCine Enredados](http://127.0.0.1:3000/_debug/provider/homecine/stream/movie/tt0398286.json)
- [TioPlus Hamnet](http://127.0.0.1:3000/_debug/provider/tioplus/stream/movie/tt14905854.json)
- [NetMirror Breaking Bad S01E01](http://127.0.0.1:3000/_debug/provider/netmirror/stream/series/tt0903747:1:1.json)
- [Castle Breaking Bad S01E01](http://127.0.0.1:3000/_debug/provider/castle/stream/series/tt0903747:1:1.json)
- [SeriesMetro Breaking Bad S01E01](http://127.0.0.1:3000/_debug/provider/seriesmetro/stream/series/tt0903747:1:1.json)
- [LACartoons Matrix](http://127.0.0.1:3000/_debug/provider/lacartoons/stream/movie/tt0133093.json)
- [LACartoons Courage S02E01](http://127.0.0.1:3000/_debug/provider/lacartoons/stream/series/tt0220880:2:1.json)

## Deploy en Railway

### Archivos preparados

- [package.json](/C:/Users/lautaroturina/Desktop/Codex/CinePick/package.json)
- [package-lock.json](/C:/Users/lautaroturina/Desktop/Codex/CinePick/package-lock.json)
- [railway.json](/C:/Users/lautaroturina/Desktop/Codex/CinePick/railway.json)

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
- `MHDFLIX_BASE_URL=https://ww1.mhdflix.com`
- `MHDFLIX_API_URL=https://core.mhdflix.com`
- `LAMOVIE_BASE_URL=https://la.movie`
- `VERSERIESONLINE_BASE_URL=https://www.verseriesonline.net`
- `CINEPLUS123_BASE_URL=https://cineplus123.org`
- `SERIESKAO_BASE_URL=https://serieskao.top`
- `SERIESMETRO_BASE_URL=https://www3.seriesmetro.net`
- `LACARTOONS_BASE_URL=https://www.lacartoons.com`
- `EXTRACTOR_TIMEOUT_MS=3500`
- `EXTRACTOR_CANDIDATE_TIMEOUT_MS=5000`
- `WEBSTREAM_HTTP_RETRIES=1`

### Verificacion despues del deploy

- `https://TU-SERVICIO.up.railway.app/`
- `https://TU-SERVICIO.up.railway.app/manifest.json`

## Documentacion adicional

- [SESSION_CHANGES_2026-04-07.md](/C:/Users/lautaroturina/Desktop/Codex/CinePick/docs/SESSION_CHANGES_2026-04-07.md)
