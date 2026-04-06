# Resources Used

Esta es la lista de repositorios o carpetas dentro de [Recursos](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos) que se usaron durante el trabajo y para que sirvio cada una.

## Northstar-main

Ruta:

- [Recursos/Northstar-main](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/Northstar-main)

Nos sirvio para:

- validar que `webstreamer-latino` realmente funcionaba
- entender su runtime HTTP mas robusto
- portar ideas y extractors
- separar el bloque latino en providers individuales

Partes especialmente utiles:

- [src/webstreamer-latino/sources.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/Northstar-main/src/webstreamer-latino/sources.js)
- [src/webstreamer-latino/extractors.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/Northstar-main/src/webstreamer-latino/extractors.js)
- [src/webstreamer-latino/http.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/Northstar-main/src/webstreamer-latino/http.js)

## yarr-stremio

Ruta:

- [Recursos/yarr-stremio](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/yarr-stremio)

Nos sirvio para:

- encontrar fuentes hispanas y caminos de scraping alternativos
- ver la forma antigua de varias fuentes hispanas, incluido `cinecalidad`
- detectar que providers parecian mas faciles de portar

Partes utiles:

- carpeta de scrapers hispanos dentro de `yarr-stremio`

## cinecalidad-python-torznab

Ruta:

- [Recursos/cinecalidad-python-torznab](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/cinecalidad-python-torznab)

Nos sirvio para:

- entender una via vieja de extraccion alternativa en `CineCalidad`
- probar el camino:
  - boton de descarga
  - `data-url`
  - base64
  - link intermedio
  - enlace final

Conclusion practica:

- fue una pista util
- pero la version actual de `CineCalidad` ya no se comporta exactamente igual

Archivo clave:

- [cinecalidad_scraper.py](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/cinecalidad-python-torznab/cinecalidad_scraper.py)

## hackstoshort

Ruta:

- [Recursos/hackstoshort](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/hackstoshort)

Nos sirvio para:

- investigar `acortalink`
- confirmar que habia una capa de cifrado o AES en shorteners similares

Conclusion practica:

- fue util como pista conceptual
- no alcanzo para resolver el flujo actual de `acortalink`

## SEL-Filtering-and-Sorting

Ruta:

- [Recursos/SEL-Filtering-and-Sorting](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/SEL-Filtering-and-Sorting)

Nos sirvio para:

- mejorar el criterio de ranking y presentacion
- inspirar:
  - preferencia por tamanos moderados
  - lenguaje priorizado
  - formato de titulos

Conclusion practica:

- muy util para scoring y formato
- no para scrapers o extractores

## Nuvio-Providers-Latino

Ruta:

- [Recursos/Nuvio-Providers-Latino](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/Nuvio-Providers-Latino)

Nos sirvio para:

- comparar providers latinos contra nuestro port
- validar cobertura real de `lamovie` y `cinecalidad`
- revisar providers nuevos como:
  - `seriesmetro`
  - `xupalace`
  - `embed69`
- confirmar que `cinecalidad` en esa referencia no era una base fuerte para series

Conclusion practica:

- fue una referencia muy util para peliculas
- fue clave para terminar de cerrar `lamovie`
- `seriesmetro` surgio de ahi como provider interesante para series

## nuvio-providers

Ruta:

- [Recursos/nuvio-providers](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/nuvio-providers)

Nos sirvio para:

- comparar el comportamiento real de:
  - `netmirror`
  - `castle`
  - `cinemacity`
- confirmar si nuestros problemas eran del port o del provider fuente

Conclusion practica:

- `netmirror` funciona tambien en la referencia
- `castle` funciona tambien en la referencia
- `cinemacity` tambien falla ahi en los casos probados

## cloudstream-extensions-phisher

Ruta:

- [Recursos/cloudstream-extensions-phisher](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/cloudstream-extensions-phisher)

Nos sirvio para:

- revisar implementaciones de Cloudstream mas robustas
- especialmente el modulo `Cinemacity`
- entender mejor:
  - PlayerJS
  - extraccion con `atob`
  - metadata de idioma

Conclusion practica:

- fue mas util como referencia tecnica que el repo Nuvio para `CinemaCity`
- no alcanzo para justificar reactivarlo en deploy

## NetMirror-Extension

Ruta:

- [Recursos/NetMirror-Extension](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/NetMirror-Extension)

Nos sirvio para:

- entender la estructura real de `NetMirror`
- confirmar como manejan `tracks`
- verificar si esas pistas representaban audio o captions

Conclusion practica:

- confirmo que `NetMirror` trata `tracks` principalmente como captions
- reforzo la decision de no etiquetar `LAT` o `CAST` alegremente
- sirvio como respaldo para dejar `netmirror` como `MULTI` por defecto

## animestream-addon

Ruta:

- [Recursos/animestream-addon](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/animestream-addon)

Nos sirvio para:

- reforzar la parte anime del addon
- usar mappings locales en vez de depender solo de TMDB o IMDb
- mejorar matching de titulos anime con:
  - `synonyms`
  - `slug`
  - puentes `tmdb`/`imdb`
  - flag `dub`

Partes especialmente utiles:

- [data/catalog.json.gz](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/animestream-addon/data/catalog.json.gz)
- [data/otaku-mappings.json](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/animestream-addon/data/otaku-mappings.json)
- [src/utils/databaseLoader.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/animestream-addon/src/utils/databaseLoader.js)

Conclusion practica:

- fue clave para que `animeav1` pueda matchear mejor anime como:
  - `Frieren`
  - `Your Name.`
- tambien sirvio como base para reforzar soporte de `dub` y criterio de elegibilidad anime
- el addon completo de `animestream-addon` no se porto tal cual
- lo mas reutilizable para nuestro caso fue la capa de mappings/catalogo, no su flujo de streams por `AllAnime`

## extensions-source

Ruta:

- [Recursos/extensions-source](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/extensions-source)

Nos sirvio para:

- portar providers anime desde extensiones Tachiyomi/Aniyomi
- tomar la logica real de:
  - busqueda
  - episodios
  - parsing de players

Partes especialmente utiles:

- [src/es/animeav1](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/extensions-source/src/es/animeav1)
- [src/es/animeflv](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/extensions-source/src/es/animeflv)
- [src/es/lacartoons](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/extensions-source/src/es/lacartoons)

Conclusion practica:

- `animeav1`, `animeflv` y `lacartoons` salieron de aca
- la arquitectura original no se porto literal
- se adapto la logica al runtime HTTP/extractors de este addon
- la parte anime se beneficio especialmente de:
  - parsing de `anime_info`
  - parsing de `episodes`
  - parsing de `videos`
  - estructura `SUB/DUB`

Ademas, `lacartoons` obligo a reforzar extractors:

- se porto soporte real para `RpmVid`
- fue validado con `Coraje, el perro cobarde` S02E01

## animeflv-stremio-addon

Ruta:

- [Recursos/animeflv-stremio-addon](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/animeflv-stremio-addon)

Nos sirvio para:

- revisar una implementacion Stremio dedicada a anime
- comparar nuestro `animeav1` y `animeflv` contra otro addon ya armado
- detectar mejoras concretas para:
  - metadata anime
  - soporte de IDs anime alternativos
  - parsing mas fino de `AnimeAV1`

Partes especialmente utiles:

- [routes/animeFLV.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/animeflv-stremio-addon/routes/animeFLV.js)
- [routes/animeav1.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/animeflv-stremio-addon/routes/animeav1.js)
- [routes/relations.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/animeflv-stremio-addon/routes/relations.js)

Conclusion practica:

- no convino portar su arquitectura express ni su capa de combinacion de streams
- no convino reemplazar nuestros extractors
- si convino reutilizar ideas para:
  - metadata mas rica en `animeav1` y `animeflv`
  - soporte de IDs `mal`, `anilist`, `kitsu` y `anidb`
  - mejor parsing de `AnimeAV1` para `embeds` y `downloads`
- toda esa linea de trabajo queda documentada, pero anime queda desactivado del addon activo hasta nueva revision
