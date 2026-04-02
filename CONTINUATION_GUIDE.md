# Continuation Guide

## Objetivo del proyecto

Construir un addon de Stremio que combine:

- scrapers HTTP latinos/castellanos
- ranking global consistente
- debug real por provider
- proxy interno de medios

## Decision arquitectonica tomada

No se reinicio desde cero.

Se eligio una arquitectura hibrida:

- conservar la estructura actual del addon
  - server
  - manifest
  - debug
  - ranking
- reemplazar/mejorar la capa HTTP con runtime y extractors inspirados en `Northstar`

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

## Limpieza pendiente

### Revisar si se elimina o archiva

- [src/providers/webstreamerlatino.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/webstreamerlatino.js)

Ese archivo quedo conceptualmente reemplazado por providers individuales.

### Revisar antes de deployar sin mirar

- [data/source-penalties.json](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/data/source-penalties.json)
- providers locales todavia no integrados al flujo final

## Orden recomendado para seguir

1. Validar `verhdlink` y `cinehdplus`
2. Limpiar o retirar `webstreamerlatino.js`
3. Revisar `streamwish` con casos concretos

## Endpoints utiles para continuidad

### Global

- [debug global Matrix](http://127.0.0.1:3000/_debug/stream/movie/tt0133093.json)
- [debug global Zootopia 2](http://127.0.0.1:3000/_debug/stream/movie/tt26443597.json)

### HTTP

- [CineCalidad Matrix](http://127.0.0.1:3000/_debug/provider/cinecalidad/stream/movie/tt0133093.json)
- [Cuevana Matrix](http://127.0.0.1:3000/_debug/provider/cuevana/stream/movie/tt0133093.json)
- [HomeCine Enredados](http://127.0.0.1:3000/_debug/provider/homecine/stream/movie/tt0398286.json)
- [TioPlus Hamnet](http://127.0.0.1:3000/_debug/provider/tioplus/stream/movie/tt14905854.json)
