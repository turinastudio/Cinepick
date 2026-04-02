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

- encontrar providers torrent hispanos
- ver la forma antigua de `mitorrent`, `cinecalidad`, `mejortorrent`, `wolfmax4k`, `elitetorrent`, etc.
- detectar que providers parecian mas faciles de portar

Partes utiles:

- [src/torrent](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/yarr-stremio/src/torrent)

## torrentia

Ruta:

- [Recursos/torrentia](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/torrentia)

Nos sirvio para:

- portar `DonTorrent`
- entender su flujo de:
  - busqueda
  - `.protected-download`
  - `api_validate_pow.php`
  - proof-of-work
  - descarga de `.torrent`
  - calculo de `infoHash`

Archivo clave:

- [src/services/Scraper.ts](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/torrentia/src/services/Scraper.ts)

## pelispanda-stremio-addon

Ruta:

- [Recursos/pelispanda-stremio-addon](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/pelispanda-stremio-addon)

Nos sirvio para:

- descubrir la API real de `PelisPanda`
- migrar de scraping HTML a API-first
- dejar `PelisPanda` funcionando de verdad como provider torrent

Archivo clave:

- [pelis-panda-api.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/pelispanda-stremio-addon/pelis-panda-api.js)

## cinecalidad-python-torznab

Ruta:

- [Recursos/cinecalidad-python-torznab](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/cinecalidad-python-torznab)

Nos sirvio para:

- entender una via vieja de extraccion torrent en `CineCalidad`
- probar el camino:
  - boton torrent
  - `data-url`
  - base64
  - link intermedio
  - magnet

Conclusion practica:

- fue una pista util
- pero la version actual de `CineCalidad` ya no se comporta exactamente igual

Archivo clave:

- [cinecalidad_scraper.py](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/cinecalidad-python-torznab/cinecalidad_scraper.py)

## torrentio-scraper

Ruta:

- [Recursos/torrentio-scraper](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/torrentio-scraper)

Nos sirvio para:

- confirmar naming de algunos providers
- entender una arquitectura mas separada entre scraping y addon

Conclusion practica:

- como inspiracion general, si
- como fuente directa de extractors latinos o bypasses, no tanto

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
