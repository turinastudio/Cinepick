# Antigravity Handoff

Guia pensada para continuar este repo desde otro agente como Gemini o Claude dentro de Antigravity.

## Objetivo

Seguir evolucionando este addon de Stremio sin romper:

- el flujo HTTP actual
- el deploy en Render y Railway
- el ranking global
- la reproducibilidad local con `scripts/test-provider.js`

## Estado del proyecto

Este repo ya no es un addon mixto con foco en torrents.

El estado de deploy actual es:

- providers HTTP
- proxy interno para HLS y MP4
- scoring global con limite por defecto
- debug por provider
- tester CLI por TMDB

### Providers hoy activos y validos

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

### Providers presentes pero no activos para deploy

- `cinemacity`
  - explorado
  - el repo de referencia tambien falla en los casos probados
  - no reactivarlo sin evidencia nueva

### Providers multi-language

- `netmirror`
- `castle`

Regla actual:

- se muestran como `MULTI` por defecto
- no etiquetar `LAT` o `CAST` salvo evidencia fuerte

Motivo:

- `NetMirror` mostro `tracks` que en los casos validados eran `captions` o `thumbnails`, no audio ES confirmado
- `Castle` puede tener metadata, pero todavia no esta suficientemente validada para prometer idioma

## Restricciones importantes de deploy

### Railway

Railway bloquea cualquier rastro relevante de `torrent` en el repo que despliega.

No reintroducir en el deploy:

- providers torrent
- librerias torrent
- archivos trackeados con esa capa antigua

`railway.json` define:

- build
- start
- healthcheck

Pero no autoinyecta variables de entorno.

En Railway las variables se cargan manualmente.

### Render

Render si usa [render.yaml](/C:/Users/lautaroturina/Desktop/Codex/CinePick/render.yaml) para variables y comandos.

Si se suma un provider nuevo con `BASE_URL`, actualizar `render.yaml`.

## Defaults importantes ya decididos

- `CineCalidad` usa por defecto `https://www.cinecalidad.vg`
- `STREAM_SELECTION_MODE=global`
- `STREAM_MAX_RESULTS=2`

No cambiar esos defaults sin una razon clara.

## Archivos clave

### Entrada principal

- [src/server.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/server.js)
- [src/providers/index.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/index.js)
- [src/manifest.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/manifest.js)

### Base compartida para providers HTTP

- [src/providers/webstreambase.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/webstreambase.js)
- [src/lib/webstreamer/http.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/webstreamer/http.js)
- [src/lib/webstreamer/common.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/webstreamer/common.js)
- [src/lib/webstreamer/resolve.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/webstreamer/resolve.js)

### Extractors y proxy

- [src/lib/extractors.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/extractors.js)
- [src/lib/http.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/http.js)

### Scoring

- [src/lib/stream-scoring.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/stream-scoring.js)

### Utilidades TMDB

- [src/lib/tmdb.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/tmdb.js)

### Tester local

- [test-provider.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/scripts/test-provider.js)

## Flujo recomendado para portar un provider nuevo

### 1. Buscar referencia externa

Antes de escribir nada, revisar en [Recursos](/C:/Users/lautaroturina/Desktop/Codex/CinePick/Recursos):

- repos de Nuvio
- Cloudstream
- Northstar
- otros scrapers utiles

Documentar mentalmente:

- como busca
- como hace matching
- como extrae embeds
- si devuelve idioma real o solo labels ambiguos

### 2. Decidir si entra por `WebstreamBaseProvider` o `Provider`

Usar [webstreambase.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/webstreambase.js) si el sitio:

- se comporta como scraper HTML clasico
- usa search + pagina + embeds
- necesita aliases de TMDB y matching flexible

Usar `Provider` directo si el sitio:

- expone API propia
- usa payloads cifrados
- funciona mas como `netmirror` o `castle`

### 3. Implementar primero `debugStreamsFromExternalId`

No arrancar pensando solo en Stremio.

Primero lograr que el provider devuelva debug claro:

- `status`
- `queries` o `searchAttempts`
- `bestMatch`
- `players`
- `streams`

Eso ahorra muchisimo tiempo.

### 4. Validar con el tester CLI

Formato:

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

Usar `advanced` cuando falle.

### 5. Recien despues integrarlo en el flujo publico

Si el provider ya responde de forma repetible:

- agregarlo a [src/providers/index.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/index.js)
- agregar su prefijo a [src/manifest.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/manifest.js)
- sumar su `BASE_URL` a [render.yaml](/C:/Users/lautaroturina/Desktop/Codex/CinePick/render.yaml) si aplica
- documentarlo en [README.md](/C:/Users/lautaroturina/Desktop/Codex/CinePick/README.md) y [CONTINUATION_GUIDE.md](/C:/Users/lautaroturina/Desktop/Codex/CinePick/docs/CONTINUATION_GUIDE.md)

## Flujo recomendado para agregar funciones nuevas

### Si toca reproduccion o proxy

Revisar antes:

- [src/server.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/server.js)
- [src/lib/http.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/http.js)
- [src/lib/extractors.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/extractors.js)

No asumir que una URL relativa o un manifest simple va a funcionar en Stremio sin pasar por el proxy.

### Si toca ranking

Revisar antes:

- [src/lib/stream-scoring.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/lib/stream-scoring.js)

Reglas ya establecidas:

- `LAT` debe ganar sobre `CAST` cuando hay evidencia confiable
- evitar repetir provider en el top global cuando hay alternativas razonables
- no inventar idioma si el provider no lo expone de verdad

## Criterios para aceptar o no un provider

Mantenerlo activo si:

- encuentra contenido real
- resuelve streams reproducibles
- no depende de un estado demasiado fragil
- no rompe deploy

Dejarlo fuera si:

- solo matchea pero no saca players
- el repo de referencia tambien falla
- la estructura del sitio cambia todo el tiempo
- el idioma es engañoso y no hay forma clara de representarlo

`CinemaCity` hoy cae en esta segunda categoria.

## Casos de prueba recomendados

### Peliculas

- `Fight Club` -> TMDB `550`
- `The Matrix` -> IMDb `tt0133093`
- `Tangled` -> IMDb `tt0398286`

### Series

- `Breaking Bad` S01E01 -> TMDB `1396`
- `The Boys` S01E01 -> TMDB `76479`
- `Something Very Bad Is Going to Happen` S01E01 -> IMDb `tt32937780`, TMDB `259265`

## Debug rapido

### Global

- [http://127.0.0.1:3000/_debug/stream/movie/tt0133093.json](http://127.0.0.1:3000/_debug/stream/movie/tt0133093.json)
- [http://127.0.0.1:3000/_debug/stream/movie/tt26443597.json](http://127.0.0.1:3000/_debug/stream/movie/tt26443597.json)

### Por provider

- [http://127.0.0.1:3000/_debug/provider/cinecalidad/stream/movie/tt0137523.json](http://127.0.0.1:3000/_debug/provider/cinecalidad/stream/movie/tt0137523.json)
- [http://127.0.0.1:3000/_debug/provider/lamovie/stream/series/tt0903747:1:1.json](http://127.0.0.1:3000/_debug/provider/lamovie/stream/series/tt0903747:1:1.json)
- [http://127.0.0.1:3000/_debug/provider/netmirror/stream/series/tt1190634:1:1.json](http://127.0.0.1:3000/_debug/provider/netmirror/stream/series/tt1190634:1:1.json)
- [http://127.0.0.1:3000/_debug/provider/castle/stream/series/tt0903747:1:1.json](http://127.0.0.1:3000/_debug/provider/castle/stream/series/tt0903747:1:1.json)
- [http://127.0.0.1:3000/_debug/provider/seriesmetro/stream/series/tt0903747:1:1.json](http://127.0.0.1:3000/_debug/provider/seriesmetro/stream/series/tt0903747:1:1.json)

## Providers ya comparados contra repos de referencia

### LaMovie

- quedo bien en peliculas
- quedo bien en series
- para `Fight Club` llego a devolver incluso mas streams que la referencia de Nuvio

### CineCalidad

- quedo bien en peliculas usando `.vg`
- no usar como referencia fuerte para series

### NetMirror

- funciona
- para PrimeVideo puede requerir fallback al `contentId` principal, no siempre a episodio explicito
- no asumir idioma de audio a partir de `tracks`

### Castle

- funciona en peliculas y series
- por ahora tratar como `MULTI`

### CinemaCity

- no funciona de forma confiable ni siquiera en el repo de referencia probado

## Reglas para no romper el repo

- no reactivar torrents en el flujo de deploy
- no agregar dependencias que Railway pueda banear
- no meter providers nuevos al manifest si todavia estan en fase experimental
- si un provider queda exploratorio, dejarlo fuera de [src/providers/index.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/index.js) y [src/manifest.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/manifest.js)
- mantener actualizado [render.yaml](/C:/Users/lautaroturina/Desktop/Codex/CinePick/render.yaml) cuando se agrega una variable nueva

## Recursos mas utiles para seguir

- [README.md](/C:/Users/lautaroturina/Desktop/Codex/CinePick/README.md)
- [CONTINUATION_GUIDE.md](/C:/Users/lautaroturina/Desktop/Codex/CinePick/docs/CONTINUATION_GUIDE.md)
- [RESOURCES_USED.md](/C:/Users/lautaroturina/Desktop/Codex/CinePick/docs/RESOURCES_USED.md)
- [Recursos/Northstar-main](/C:/Users/lautaroturina/Desktop/Codex/CinePick/Recursos/Northstar-main)
- [Recursos/Nuvio-Providers-Latino](/C:/Users/lautaroturina/Desktop/Codex/CinePick/Recursos/Nuvio-Providers-Latino)
- [Recursos/nuvio-providers](/C:/Users/lautaroturina/Desktop/Codex/CinePick/Recursos/nuvio-providers)
- [Recursos/cloudstream-extensions-phisher](/C:/Users/lautaroturina/Desktop/Codex/CinePick/Recursos/cloudstream-extensions-phisher)
- [Recursos/NetMirror-Extension](/C:/Users/lautaroturina/Desktop/Codex/CinePick/Recursos/NetMirror-Extension)

## Siguiente backlog razonable

1. Validar `verhdlink`
2. Validar `cinehdplus`
3. Revisar `streamwish` con casos concretos
4. Revisar si `Castle` expone metadata suficiente para diferenciar `LAT` y `CAST`
5. Retirar o archivar [src/providers/webstreamerlatino.js](/C:/Users/lautaroturina/Desktop/Codex/CinePick/src/providers/webstreamerlatino.js)

