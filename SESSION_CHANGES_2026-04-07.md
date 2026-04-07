# Cambios de sesion 2026-04-07

## Objetivo

Documentar los cambios funcionales, visuales y de confiabilidad realizados sobre CinePick durante esta sesion.

## Identidad del addon

- nombre publico actualizado a `CinePick`
- descripcion del manifest actualizada
- logo servido desde `assets/Logo.png`
- el manifest expone `logo` usando una URL servida por el propio addon
- `ADDON_URL` ahora puede usarse como origen canonico para construir URLs publicas

## CTA de soporte

- se agrego un CTA de soporte al final de la respuesta de `/stream`
- el CTA solo aparece si ya existen streams reales
- no se inserta en providers, scoring ni debug
- variables relacionadas:
  - `SHOW_SUPPORT_STREAM`
  - `SUPPORT_URL`

## Cache y rutas de instalacion

- se agrego soporte para `\/alt\/manifest.json`
- las rutas `\/alt\/...` se normalizan internamente hacia el addon real
- esto permite reinstalar el addon en Stremio rompiendo cache sin duplicar logica

## Presentacion de streams

- la columna izquierda en Stremio ahora muestra `CinePick`
- el bloque visual de la derecha quedo en 3 lineas:
  - `Titulo`
  - `Idioma`
  - `Provider - Fuente`
- se desacoplo la presentacion de la logica interna:
  - `_rawTitle` para scoring, deteccion de idioma, dedupe y fuente
  - `_displayTitle` para renderizar titulos mas limpios

## Providers con `_displayTitle`

Se propago `_displayTitle` a providers principales para mejorar el titulo visible:

- `gnula`
- `cinecalidad`
- `castle`
- `netmirror`
- `cineplus123`
- `cuevana`
- `homecine`
- `lacartoons`
- `lamovie`
- `mhdflix`
- `serieskao`
- `seriesmetro`
- `tioplus`
- `verseriesonline`
- `cinehdplus`
- `verhdlink`

Nota:

- `cinehdplus` y `verhdlink` luego fueron removidos del flujo activo, pero la adaptacion interna quedo en codigo

## Hardening de confiabilidad

### Timeout y latencia

- `webstreamer/http` ahora toma `PROVIDER_TIMEOUT_MS` como base segura
- `extractors` incorporo timeout propio con `AbortController`
- se agrego timeout por candidato en `webstreamer/resolve`
- se ajusto el timeout efectivo de extractors para que sea una fraccion del timeout del provider

Variables nuevas o ahora relevantes:

- `EXTRACTOR_TIMEOUT_MS`
- `EXTRACTOR_CANDIDATE_TIMEOUT_MS`
- `WEBSTREAM_HTTP_TIMEOUT_MS`
- `WEBSTREAM_HTTP_RETRIES`

### Fallbacks

- si falla un extractor especifico, ahora se intenta fallback por:
  - `GenericM3U8`
  - `JWPlayer`

### Reintentos y HTTP

- se agregaron reintentos cortos y limitados para errores transitorios en `webstreamer/http`
- `fetchJson()` ahora tambien hace warm-up ante `403`

### Validacion y scoring

- se validan URLs antes de scorear y devolver streams
- la deteccion de fuente usa `_targetUrl` para no perder el host real tras el proxy
- se corrigio la deteccion de castellano/espanol para evitar problemas por encoding raro

## Matching interno

- se corrigio `scoreSearchCandidate()` para comparar tokens reales del titulo
- esto mejora busquedas internas y eleccion de candidatos en providers que usan esa utilidad

## Hardening contra falsos positivos

Se endurecio el matching de providers con logica custom para evitar casos donde, ante un match flojo, devolvian el primer resultado de busqueda aunque fuera incorrecto.

Providers ajustados:

- `cineplus123`
- `gnula`
- `mhdflix`
- `serieskao`
- `verseriesonline`
- `lamovie`

Comportamiento nuevo:

- si no hay evidencia suficiente de match, el provider devuelve `null` / sin resultados
- se prioriza no mostrar streams antes que colar una pelicula o serie equivocada

Caso concreto corregido:

- episodios o series que podian terminar mostrando resultados de otra franquicia por fallback demasiado permisivo

## Flujo activo de providers

Providers anime fuera del flujo activo:

- `animeav1`
- `animeflv`

Providers removidos del flujo activo en esta sesion por alineacion con el contrato actual:

- `verhdlink`
- `cinehdplus`

Ajustes relacionados:

- `idPrefixes` del manifest actualizados
- alias duplicado `waaw` corregido en extractors

## Ajustes chicos del core

- `PORT` ahora se parsea con `Number.parseInt(..., 10) || 3000`
- el debug publico sigue excluyendo `_rawTitle`
- el CTA no contamina debug ni scoring

## Nota sobre timeouts de providers

- logs como `[streams] provider fallo ... timeout after 12000ms` significan que ese provider puntual no llego a tiempo
- no implican por si solos que el addon este roto
- el agregador sigue usando resultados de otros providers que si respondieron dentro del tiempo

## Recomendacion de prueba local

```powershell
$env:ADDON_URL='http://127.0.0.1:3000'
$env:STREAM_SELECTION_MODE='global'
$env:SHOW_SUPPORT_STREAM='true'
$env:SUPPORT_URL='https://ko-fi.com/turinastudio'
$env:PROVIDER_TIMEOUT_MS='12000'
$env:EXTRACTOR_TIMEOUT_MS='3500'
$env:EXTRACTOR_CANDIDATE_TIMEOUT_MS='5000'
$env:WEBSTREAM_HTTP_RETRIES='1'
npm start
```

Instalacion recomendada en Stremio:

- `http://127.0.0.1:3000/alt/manifest.json`
