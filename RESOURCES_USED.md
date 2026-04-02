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
