# Stremio Web Scraper Addon

Addon de Stremio orientado a providers web estilo Aniyomi/Cloudstream, con seleccion inteligente de streams y soporte para deploy en Render.

## Estado actual

- Providers integrados:
  - `gnula`
  - `cinecalidad`
- Recursos de Stremio:
  - `/manifest.json`
  - `/catalog/:type/:id.json`
  - `/meta/:type/:id.json`
  - `/stream/:type/:id.json`
  - `/_debug/stream/:type/:id.json`
- Soporte para IDs externos de Stremio/Cinemeta:
  - peliculas: `tt1234567`
  - series: `tt1234567:1:1`
- Seleccion de streams:
  - mejor global entre providers
  - o mejor por provider
- Penalidades persistentes por host para priorizar fuentes que rinden mejor

## Ejecutar en local

```powershell
npm start
```

El addon queda disponible en:

- `http://127.0.0.1:3000/manifest.json`

## Variables utiles

```powershell
$env:GNULA_BASE_URL='https://gnula.life'
$env:CINECALIDAD_BASE_URL='https://www.cinecalidad.ec'
$env:STREAM_SELECTION_MODE='global'
$env:STREAM_MAX_RESULTS='1'
$env:GNULA_DISABLED_SOURCES='streamwish,doodstream'
$env:CINECALIDAD_DISABLED_SOURCES='goodstream,streamwish'
npm start
```

Opciones:

- `STREAM_SELECTION_MODE=global`
  Devuelve el mejor stream absoluto entre todos los providers.
- `STREAM_SELECTION_MODE=per_provider`
  Devuelve el mejor stream de cada provider.
- `STREAM_MAX_RESULTS=1`
  Devuelve solo el mejor resultado.
- `STREAM_MAX_RESULTS=2`
  Devuelve mejor resultado mas backup.
- `GNULA_DISABLED_SOURCES=host1,host2`
- `CINECALIDAD_DISABLED_SOURCES=host1,host2`

## Probar rapido

Manifest:

- `http://127.0.0.1:3000/manifest.json`

Health check:

- `http://127.0.0.1:3000/`

Busqueda:

- `http://127.0.0.1:3000/catalog/movie/gnula-movies.json?search=matrix`
- `http://127.0.0.1:3000/catalog/movie/cinecalidad-movies.json?search=matrix`

Debug externo:

- `http://127.0.0.1:3000/_debug/stream/movie/tt2948356.json`
- `http://127.0.0.1:3000/_debug/stream/series/tt9813792:3:1.json`

## Deploy en Render

El proyecto ya esta preparado para Render:

- escucha en `0.0.0.0`
- usa `process.env.PORT`
- expone health check en `/`
- incluye [render.yaml](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/render.yaml)

### Opcion 1: usando `render.yaml`

1. Subi el repo a GitHub.
2. En Render, crea un `Web Service` desde ese repo.
3. Render deberia detectar [render.yaml](/C:/Users/lautaroturina/Desktop/Codex/Stremio%20Addon/render.yaml) automaticamente.
4. Agrega estas variables de entorno:
   - `GNULA_BASE_URL=https://gnula.life`
   - `CINECALIDAD_BASE_URL=https://www.cinecalidad.ec`
   - `STREAM_SELECTION_MODE=global`
   - `STREAM_MAX_RESULTS=1`

### Opcion 2: configuracion manual

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/`
- Runtime: `Node`
- Node version recomendada: `20`

Variables recomendadas:

- `GNULA_BASE_URL=https://gnula.life`
- `CINECALIDAD_BASE_URL=https://www.cinecalidad.ec`
- `STREAM_SELECTION_MODE=global`
- `STREAM_MAX_RESULTS=1`

URL final de instalacion:

- `https://TU-SERVICIO.onrender.com/manifest.json`

## Nota importante

El addon intenta devolver solo streams directos reproducibles. Si un host no se puede resolver a una `url` real, se descarta.

En algunos casos un sitio puede exponer varios players pero solo uno o dos resolverse bien. Para eso existe el sistema de score y penalidades, que ayuda a elegir automaticamente el host mas prometedor.
