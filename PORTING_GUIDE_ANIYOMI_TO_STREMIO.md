# Guia De Port De Aniyomi A Stremio

Esta guia resume el proceso que seguimos para portar una extension de Aniyomi a un addon de Stremio reutilizable. La idea no es copiar codigo Kotlin tal cual, sino reaprovechar la logica del provider y separarla de la capa propia de Stremio.

## Objetivo

Transformar una extension de Aniyomi que ya sabe:

- buscar contenido
- obtener metadata
- listar episodios
- descubrir players
- resolver extractores

en un provider compatible con Stremio que responda:

- `catalog`
- `meta`
- `stream`

## Idea base

Aniyomi y Stremio resuelven problemas distintos:

- Aniyomi trabaja con una API de extensiones en Kotlin
- Stremio trabaja con recursos HTTP y un contrato JSON

Por eso no conviene "ejecutar la extension" sino portarla por capas.

## Arquitectura recomendada

Separar el addon en estas partes:

1. `provider`
   Un modulo por sitio web, por ejemplo `gnula`.

2. `adapter`
   Traduce resultados del provider al formato de Stremio.

3. `ids`
   Mantiene IDs estables para que Stremio pueda volver a pedir `meta` y `stream`.

4. `extractors`
   Resuelven hosts de video concretos como `streamwish`, `voe`, `filemoon`, etc.

## Estructura usada en este proyecto

- [src/server.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/server.js)
- [src/manifest.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/manifest.js)
- [src/providers/base.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/base.js)
- [src/providers/gnula.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/gnula.js)
- [src/lib/ids.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/ids.js)
- [src/lib/extractors.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/extractors.js)

## Paso 1: localizar el codigo importante de la extension

Dentro del repo de Aniyomi normalmente hay que leer:

1. el archivo principal del provider
2. los data models
3. los extractores declarados en `build.gradle`

En el caso de Gnula usamos:

- [Gnula.kt](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/extensions-source/src/es/gnula/src/eu/kanade/tachiyomi/animeextension/es/gnula/Gnula.kt)
- [DataModel.kt](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/extensions-source/src/es/gnula/src/eu/kanade/tachiyomi/animeextension/es/gnula/DataModel.kt)
- [build.gradle](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/Recursos/extensions-source/src/es/gnula/build.gradle)

## Paso 2: identificar el contrato del provider original

En casi todas las extensiones de Aniyomi hay que mapear estas funciones:

- `searchAnimeRequest` / `searchAnimeParse`
- `animeDetailsParse`
- `episodeListParse`
- `videoListParse`
- alguna funcion de resolucion de hosts

La traduccion conceptual a Stremio fue:

- `searchAnime*` -> `provider.search`
- `animeDetailsParse` -> `provider.getMeta`
- `episodeListParse` -> `meta.videos` para series
- `videoListParse` -> `provider.getStreams`

## Paso 3: portar primero el scraping del sitio, no los extractores

Orden recomendado:

1. hacer que la busqueda devuelva items reales
2. hacer que `meta` devuelva poster, fondo, descripcion, genero
3. hacer que series devuelva episodios
4. recien despues resolver hosts de video

Esto evita mezclar dos problemas a la vez:

- scraping del sitio principal
- resolucion del host de video

## Paso 4: mapear IDs de forma estable

Stremio necesita IDs persistentes. En este proyecto usamos:

- peliculas: `gnula:movie:<slug>`
- series base: `gnula:series:<slug>`
- episodios: `gnula:series:<episode-slug>:<season>:<episode>`

Funciones usadas:

- [src/lib/ids.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/ids.js)

Regla practica:

- el ID debe permitir reconstruir la URL necesaria para volver a pedir metadata o streams

## Paso 5: soportar IDs externos de Stremio

Stremio no siempre usa tu ID interno. Muchas veces abre la ficha de Cinemeta, por ejemplo:

- peliculas: `tt0133093`
- episodios de series: `tt0944947:1:1`

Si solo soportas `gnula:...`, Stremio puede mostrar la ficha pero decir "sin transmisiones".

Por eso agregamos:

- `idPrefixes: ["gnula:", "tt"]`
- fallback de streams por IDs externos
- busqueda interna por nombre usando Cinemeta como fuente

Implementacion:

- [src/manifest.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/manifest.js)
- [src/providers/gnula.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/gnula.js)
- [src/providers/index.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/providers/index.js)

## Paso 6: series requieren logica especial

En series, Stremio pide streams por episodio, no por serie completa.

Ejemplo:

- Stremio pide `tt0944947:1:1`
- el provider debe buscar la serie correcta
- luego encontrar el episodio correspondiente en `meta.videos`
- luego pedir streams del episodio real del sitio

Si no haces esto, las peliculas pueden funcionar y las series no.

## Paso 7: devolver `url` cuando sea posible

Regla clave de Stremio:

- `url` reproduce dentro de Stremio
- `externalUrl` abre navegador o reproductor externo

Por eso:

- si solo tenes una pagina intermedia del host, devolves `externalUrl`
- si logras sacar el `.m3u8` o `.mp4`, devolves `url`

## Paso 8: portar extractores por prioridad

No hace falta portar todos los extractores al principio.

Importante para este proyecto:

- la fuente de verdad de extractores pasa a ser Cloudstream
- Aniyomi puede seguir sirviendo para entender el provider del sitio
- pero los hosts de video deben mantenerse contra Cloudstream

Conviene priorizar:

1. los que mas aparecen en ese sitio
2. los que entregan HLS o MP4 directo
3. los que tienen port simple a JS

En Gnula empezamos con:

- `streamwish`
- `voe`
- `mp4upload`
- `yourupload`
- `streamtape`
- `dood`
- `filemoon`
- `vidhide`

Archivo:

- [src/lib/extractors.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/extractors.js)

### Registro reutilizable de extractores

La implementacion actual ya no depende de `if`s pegados al provider. Los extractores viven en un registro comun, de modo que otro provider puede reutilizarlos sin copiar logica.

Conceptualmente cada extractor define:

- `id`
- `source`
- `aliases` de host
- `resolve(url, label)`

Y el provider solo necesita llamar:

- `resolveExtractorStream(url, label)`

Funciones utiles:

- `getExtractorRegistry()`
- `matchExtractorByUrl(url)`
- `resolveExtractorStream(url, label)`

Esto permite que un futuro provider como `cinecalidad` reutilice `streamwish`, `voe`, `filemoon`, etc., con solo descubrir la URL del host y delegar la resolucion.

Nota practica:

- si un host no aparece en la carpeta de extractores de Cloudstream, no conviene improvisarlo
- en ese caso es mejor dejar fallback externo hasta ubicar el extractor correcto o el alias real del host
- por ahora eso aplica a la familia `netu/hqq/waaw`, que no aparecio en la ruta inspeccionada

## Paso 9: no asumir que el HTML es identico

Una trampa importante: el Kotlin original de Aniyomi a veces busca un patron HTML muy especifico. En Stremio tuvimos que flexibilizar el parser porque Gnula no siempre expone `self.__NEXT_DATA__` del mismo modo.

Aprendizaje:

- soportar mas de un formato de script
- evitar regex demasiado fragiles
- si el sitio usa Next.js, intentar parsear `pageProps`

## Paso 10: hacer debugging por etapas

La secuencia mas util de pruebas fue:

1. `manifest`
2. `catalog`
3. `meta`
4. `stream`
5. Stremio Desktop

URLs de prueba:

- `http://127.0.0.1:3000/manifest.json`
- `http://127.0.0.1:3000/catalog/movie/gnula-movies.json?search=matrix`
- `http://127.0.0.1:3000/meta/movie/gnula%3Amovie%3Amatrix.json`
- `http://127.0.0.1:3000/stream/movie/gnula%3Amovie%3Amatrix.json`
- `http://127.0.0.1:3000/stream/movie/tt0133093.json`

## Paso 11: seleccionar el mejor stream, no todos

En providers web tipo `gnula` o `cinecalidad`, devolver "todos los streams" no siempre da la mejor experiencia.

Muchos links:

- arrancan lento
- requieren cookies o headers raros
- responden de forma inestable
- o directamente funcionan peor dentro de Stremio que en navegador

Por eso el proyecto ahora tiene una capa de seleccion inteligente inspirada parcialmente en AutoStream, pero adaptada a scrapers HTTP.

Archivos:

- [src/lib/penalty-reliability.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/penalty-reliability.js)
- [src/lib/stream-scoring.js](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/src/lib/stream-scoring.js)

### Que hace esta capa

1. cada provider marca exito o fallo por fuente
   Ejemplos:
   - `gnula:vidhide`
   - `gnula:streamwish`
   - `cinecalidad:goodstream`
   - `cinecalidad:vimeos`

2. las penalidades se guardan en disco
   Archivo:
   - [data/source-penalties.json](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/data/source-penalties.json)

3. cada stream recibe un score antes de devolverse a Stremio

El score mezcla:

- prioridad base por host
- resolucion detectada
- idioma
- si es `mp4` o `m3u8`
- complejidad de `behaviorHints` y cookies
- penalidades acumuladas

### Objetivo practico

No buscamos "adivinar perfecto" que va a reproducir Stremio, porque con hosts HTTP eso no siempre se puede saber desde el servidor.

Lo que buscamos es:

- mostrar primero el stream que mas probablemente funcione
- ocultar basura o links peores
- y devolver como mucho el mejor stream y un backup

### Limitaciones

- el addon no recibe feedback perfecto del player interno de Stremio
- un host puede resolver bien pero igual fallar al reproducir en cierto dispositivo
- las penalidades se basan en exito o fallo al resolver el host, no en confirmacion de playback real
- en Render free no conviene hacer probes pesados de red para cada stream

### Criterio recomendado

Para scrapers web, esta estrategia suele ser un buen punto medio:

1. resolver todos los hosts posibles
2. puntuar
3. devolver `best + backup`
4. ajustar pesos despues de pruebas reales del usuario

Es una buena idea cuando:

- el sitio devuelve muchos hosts
- algunos son claramente peores o mas lentos
- queres una experiencia mas parecida a "click y mirar"

No conviene complicarlo demasiado cuando:

- el provider ya devuelve muy pocos hosts
- o el cuello de botella real esta en extractores todavia no portados

## Problemas encontrados en este port

### 1. Dominio inaccesible

`gnula.nu` no resolvia bien en la red del usuario, pero `gnula.life` y `gnula.se` si.

Solucion:

- hacer el dominio configurable por variable de entorno `GNULA_BASE_URL`

### 2. Stremio Web no era buena prueba

`web.stremio.com` intentaba cargar el addon local bajo `https`, mientras el server local corria en `http`.

Solucion:

- probar primero con navegador normal
- instalar el addon en Stremio Desktop

### 3. Streams visibles pero sin reproduccion interna

El addon encontraba hosts, pero muchos se devolvian como `externalUrl`.

Solucion:

- priorizar extractores que devuelven `url`
- aceptar que los hosts no portados se abran afuera

### 4. Peliculas funcionaban pero series no

Faltaba traducir correctamente el ID externo de episodio de Stremio.

Solucion:

- mapear `tt...:season:episode` al episodio interno del provider

## Checklist reutilizable para futuros ports

1. Identificar `baseUrl`, search, details, episodes, videos y extractores.
2. Portar los data models minimos necesarios.
3. Implementar `search`.
4. Implementar `getMeta`.
5. Implementar episodios si es serie.
6. Implementar `getStreams`.
7. Separar extractores en archivo aparte.
8. Agregar soporte para IDs externos de Stremio.
9. Probar `manifest`, `catalog`, `meta`, `stream`.
10. Verificar que algunos resultados usen `url` y no solo `externalUrl`.

## Recomendaciones para el proximo provider

Cuando portemos otra extension de Aniyomi, conviene repetir este orden:

1. leer provider principal y modelos
2. detectar formato de IDs y URLs del sitio
3. implementar search y meta
4. verificar si el sitio usa JSON embebido o HTML clasico
5. portar solo los extractores realmente usados por ese sitio
6. probar primero peliculas
7. despues series
8. recien al final pulir matching con Cinemeta

## Conclusion

La clave del port no fue "traducir Kotlin a JavaScript" sino separar:

- logica del sitio
- contrato de Stremio
- resolucion de hosts

Si mantenemos esa disciplina, el trabajo de futuros ports baja mucho y los extractores se vuelven reutilizables entre providers.
