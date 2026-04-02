# Stremio Web Scraper Addon

Addon de Stremio orientado a providers web estilo Aniyomi/Cloudstream, con seleccion inteligente de streams, proxy interno de medios y deploy en Render.

## Estado actual

- Providers integrados:
  - `gnula`
  - `cinecalidad`
  - `mhdflix`
  - `verseriesonline`
  - `cineplus123`
- Recursos:
  - `/manifest.json`
  - `/catalog/:type/:id.json`
  - `/meta/:type/:id.json`
  - `/stream/:type/:id.json`
  - `/_debug/stream/:type/:id.json`
- Soporte para IDs externos de Stremio/Cinemeta:
  - peliculas: `tt1234567`
  - series: `tt1234567:1:1`

## Ejecutar en local

Opcion rapida:

```powershell
.\start-local.bat
```

Opcion manual:

```powershell
$env:ADDON_URL='http://127.0.0.1:3000'
$env:STREAM_SELECTION_MODE='per_provider'
npm start
```

Manifest local:

- `http://127.0.0.1:3000/manifest.json`

Health check:

- `http://127.0.0.1:3000/`

## Variables utiles

```powershell
$env:GNULA_BASE_URL='https://gnula.life'
$env:CINECALIDAD_BASE_URL='https://www.cinecalidad.ec'
$env:MHDFLIX_BASE_URL='https://ww1.mhdflix.com'
$env:MHDFLIX_API_URL='https://core.mhdflix.com'
$env:VERSERIESONLINE_BASE_URL='https://www.verseriesonline.net'
$env:CINEPLUS123_BASE_URL='https://cineplus123.org'
$env:STREAM_SELECTION_MODE='global'
$env:STREAM_MAX_RESULTS='1'
$env:GNULA_DISABLED_SOURCES='streamwish,doodstream'
$env:CINECALIDAD_DISABLED_SOURCES='goodstream,streamwish'
$env:MHDFLIX_DISABLED_SOURCES='mixdrop,lulu'
$env:VERSERIESONLINE_DISABLED_SOURCES='doodstream,uqload'
$env:CINEPLUS123_DISABLED_SOURCES='uqload,cvid'
$env:ADDON_URL='http://127.0.0.1:3000'
npm start
```

Opciones principales:

- `STREAM_SELECTION_MODE=global`
  Devuelve el mejor stream absoluto entre todos los providers.
- `STREAM_SELECTION_MODE=per_provider`
  Devuelve el mejor stream de cada provider.
- `STREAM_MAX_RESULTS=1`
  Devuelve solo el mejor resultado.
- `STREAM_MAX_RESULTS=2`
  Devuelve mejor resultado mas backup.
- `*_DISABLED_SOURCES=host1,host2`
  Evita procesar esos hosts para el provider correspondiente.

## Seleccion de streams

El addon no devuelve simplemente el primer host que encuentra.

Usa:

- score por host
- idioma
- transporte (`mp4` vs `m3u8`)
- complejidad de headers/cookies
- penalidades persistentes por fuente

Las penalidades se guardan en:

- [data/source-penalties.json](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/data/source-penalties.json)

## Proxy de medios

Los providers integrados usan proxy interno para mejorar compatibilidad en localhost y Render:

- los streams se entregan como `/p/...`
- el proxy preserva headers reales
- para HLS reescribe manifests y segmentos

`ADDON_URL` es critico:

- en local: `http://127.0.0.1:3000`
- en Render: `https://TU-SERVICIO.onrender.com`

Sin `ADDON_URL`, los streams proxyeados pueden quedar mal armados.

## Providers

### Gnula

- peliculas, series, anime y otros
- matching por `tt...`
- debug externo estable

### CineCalidad

- peliculas y series
- soporte de episodios tipo `ver-el-episodio/...`
- matching por `tt...`
- soporte de `vimeos`, `goodstream`, `voe`, `filemoon`, `streamwish`

### MhdFlix

- peliculas y series
- usa la API `core.mhdflix.com`
- soporta meta, episodios y streams
- matching por `tt...`
- para titulos cortos/ambiguos ahora prioriza no inventar matches

### VerSeriesOnline

- series
- soporte para estructura actual:
  - `/series/<slug>/`
  - `/series/<slug>/temporada-1/`
  - `/series/<slug>/temporada-1/episodio-1/`
- busqueda por URL directa
- fallback de busqueda por slug
- `csrf + cookies + POST /hashembedlink`
- parser de players ajustado a `play-option`
- titulos de stream mas limpios en debug y seleccion global

### Cineplus123

- peliculas y series
- soporte DooPlay con `POST /wp-admin/admin-ajax.php`
- series:
  - busqueda
  - meta
  - episodios tipo `/capitulo/<slug>-1x1/`
  - streams
- peliculas:
  - meta y players funcionando
  - resolucion parcial de hosts
  - `hanerix/streamwish` validado
  - `cvid` y `uqload` siguen siendo mas irregulares

## Probar rapido

Busqueda:

- `http://127.0.0.1:3000/catalog/movie/gnula-movies.json?search=matrix`
- `http://127.0.0.1:3000/catalog/movie/cinecalidad-movies.json?search=matrix`
- `http://127.0.0.1:3000/catalog/movie/mhdflix-movies.json?search=matrix`
- `http://127.0.0.1:3000/catalog/movie/cineplus123-movies.json?search=matrix`
- `http://127.0.0.1:3000/catalog/series/verseriesonline-series.json?search=the%20madison`
- `http://127.0.0.1:3000/catalog/series/cineplus123-series.json?search=breaking`

Debug externo:

- `http://127.0.0.1:3000/_debug/stream/movie/tt2948356.json`
- `http://127.0.0.1:3000/_debug/stream/series/tt9813792:3:1.json`

Debug interno:

- `http://127.0.0.1:3000/_debug/stream/series/verseriesonline%3Aseries%3Aep%3AL3Nlcmllcy90aGUtbWFkaXNvbi90ZW1wb3JhZGEtMS9lcGlzb2Rpby0xLw%3A1%3A1%3AL3Nlcmllcy90aGUtbWFkaXNvbi8.json`

## Deploy en Render

### 1. Subir cambios a GitHub

```powershell
git status
git add .
git commit -m "Update providers and proxy"
git push origin main
```

### 2. En Render

Si el servicio ya existe:

1. Abri el servicio.
2. Hace click en `Manual Deploy`.
3. Elegi `Deploy latest commit`.

Si el servicio todavia no existe:

1. Crea un `Web Service` desde el repo.
2. Deja que use [render.yaml](/C:/Users/lautaroturina/Desktop/Codex%20Stremio%20Addon/render.yaml).

### 3. Variables recomendadas en Render

- `NODE_VERSION=20`
- `ADDON_URL=https://TU-SERVICIO.onrender.com`
- `STREAM_SELECTION_MODE=global`
- `STREAM_MAX_RESULTS=1`
- `GNULA_BASE_URL=https://gnula.life`
- `CINECALIDAD_BASE_URL=https://www.cinecalidad.ec`
- `MHDFLIX_BASE_URL=https://ww1.mhdflix.com`
- `MHDFLIX_API_URL=https://core.mhdflix.com`
- `VERSERIESONLINE_BASE_URL=https://www.verseriesonline.net`
- `CINEPLUS123_BASE_URL=https://cineplus123.org`

### 4. Verificar deploy

Proba:

- `https://TU-SERVICIO.onrender.com/`
- `https://TU-SERVICIO.onrender.com/manifest.json`

La URL de instalacion en Stremio es:

- `https://TU-SERVICIO.onrender.com/manifest.json`

## Hallazgos importantes

- Los problemas actuales suelen ser por host concreto, no por provider base.
- `goodstream` sigue siendo irregular en Stremio.
- `vimeos` resulto util para `cinecalidad`.
- Las mejoras en extractores compartidos si pegaron en providers pesados:
  - `cinecalidad` levanto mas hosts en peliculas como `Zootopia`
  - `cineplus123` y `verseriesonline` sumaron mejores resultados en series como `From`
- `verseriesonline` cambio bastante respecto de la extension original; la estructura nueva es `/series/...`.
- `mhdflix` funciona bien a nivel API, pero la reproduccion final depende de los hosts que devuelva cada item.
- `mhdflix` antes inventaba matches en titulos ambiguos como `From`; ahora se aparta cuando no hay coincidencia razonable.
- `cineplus123` ya quedo bien encaminado en series.
- `cineplus123` peliculas dependen mas de mirrors concretos:
  - `hanerix` respondio bien
  - `cvid` y `uqload` siguen siendo incompletos

## Guia rapida para actualizar Render

### 1. Verificar y subir cambios

```powershell
git status
git add .
git commit -m "Update providers, extractors and matching"
git push origin main
```

### 2. Confirmar `render.yaml`

Render toma estas variables desde [render.yaml](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/render.yaml):

- `NODE_VERSION`
- `STREAM_SELECTION_MODE`
- `STREAM_MAX_RESULTS`
- `GNULA_BASE_URL`
- `CINECALIDAD_BASE_URL`
- `MHDFLIX_BASE_URL`
- `MHDFLIX_API_URL`
- `VERSERIESONLINE_BASE_URL`
- `CINEPLUS123_BASE_URL`
- `ADDON_URL`

Si cambias la URL publica del servicio, actualiza tambien `ADDON_URL`.

### 3. Redeploy

Si tenes auto deploy:

- con `git push` normalmente alcanza

Si queres forzarlo:

1. Abri el servicio en Render.
2. Entra a `Manual Deploy`.
3. Elegi `Deploy latest commit`.

### 4. Verificar despues del deploy

Proba:

- [health](https://stremio-web-scraper-addon.onrender.com/)
- [manifest](https://stremio-web-scraper-addon.onrender.com/manifest.json)

Y si queres validar streams:

- [Zootopia debug](https://stremio-web-scraper-addon.onrender.com/_debug/stream/movie/tt2948356.json)
- [From 3x1 debug](https://stremio-web-scraper-addon.onrender.com/_debug/stream/series/tt9813792:3:1.json)
