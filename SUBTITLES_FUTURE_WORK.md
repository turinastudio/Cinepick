# Subtitulos: Trabajo Futuro

Este archivo resume por que hoy los subtitulos no funcionan bien con los streams HTTP/HLS del addon y que estrategia conviene seguir mas adelante.

## Estado actual

Hoy el addon devuelve streams directos de video, por ejemplo:

- `.m3u8`
- `.mp4`

con `url` y `behaviorHints`, pero no devuelve pistas de subtitulos.

Por eso, aunque Stremio pueda reproducir el video, no siempre permite activar addons externos de subtitulos como si fuera un torrent.

## Sintoma observado

- con torrents, Stremio permite usar subtitulos normalmente
- con streams HTTP/HLS de este addon, Stremio muchas veces no deja activarlos

## Causa probable

No parece ser un problema general de Stremio, sino una combinacion de estos factores:

1. Los torrents tienen mejor integracion con el pipeline de subtitulos de Stremio.
2. Nuestros streams son `m3u8` o `mp4` directos con `behaviorHints` y, a veces, `Referer`.
3. El addon no devuelve un campo `subtitles` en la respuesta de `stream`.
4. Algunos hosts exponen solo video/audio y no una pista `.srt` o `.vtt` separada.

## Que NO resuelve el problema

- mejorar extractores de video solamente
- devolver mejor `url` del stream
- cambiar el orden de hosts

Eso ayuda a reproducir mejor, pero no agrega subtitulos por si solo.

## Estrategias posibles

### Opcion 1: Adjuntar subtitulos desde el propio addon

Objetivo:

- devolver `streams` con una lista `subtitles`

Esto requiere conseguir URLs `.srt` o `.vtt` por pelicula o episodio.

Fuentes posibles:

- pistas expuestas por el player del host
- archivos `.vtt/.srt` mencionados en el HTML o en el manifest
- un proveedor externo de subtitulos

Ventaja:

- no dependemos tanto de como Stremio matchee addons externos sobre HLS

### Opcion 2: Integrar un proveedor externo de subtitulos

Objetivo:

- buscar subtitulos por IMDb ID
- para series, tambien por temporada y episodio

Datos ya disponibles en el addon:

- `tt...`
- `tt...:season:episode`

Idea:

- al resolver un stream externo por Cinemeta, usar ese mismo ID para buscar subtitulos
- adjuntar los resultados al objeto `stream`

Ventaja:

- arquitectura mas reutilizable para futuros providers

### Opcion 3: Extraer subtitulos desde el host si existen

Ejemplos:

- `tracks` de JWPlayer
- manifests HLS con grupos de subtitulos
- JSON embebido del reproductor

Esta opcion puede convivir con la opcion 2.

## Orden recomendado de implementacion

1. Elegir una fuente externa de subtitulos compatible con peliculas y series.
2. Implementar una capa comun de `subtitle provider`, separada del provider de video.
3. Soportar busqueda por:
   - `tt...` para peliculas
   - `tt... + season + episode` para series
4. Adjuntar `subtitles` al objeto de stream de Stremio.
5. Solo despues investigar si algunos hosts ya exponen pistas propias para enriquecer resultados.

## Arquitectura sugerida

Separar esta logica en una capa nueva:

- `src/lib/subtitles.js`

con funciones del estilo:

- `searchMovieSubtitles({ imdbId, title, year, language })`
- `searchEpisodeSubtitles({ imdbId, season, episode, title, language })`
- `attachSubtitlesToStreams(streams, subtitleResults)`

## Regla importante para el futuro

Los subtitulos no deberian quedar acoplados a `gnula`.

La logica correcta es:

- provider de video descubre contenido y streams
- capa de subtitulos usa IMDb/temporada/episodio
- ambas se combinan al final en la respuesta del stream

Asi servira tambien para `cinecalidad`, `pelisplus`, u otros providers.

## Conclusion

Si queremos subtitulos confiables con estos streams, no alcanza con depender de los addons externos de Stremio. Lo mas robusto sera que nuestro addon adjunte subtitulos explicitamente, idealmente a traves de una capa comun reutilizable basada en IMDb ID y temporada/episodio.
