# Changelog

## [Unreleased] - 2026-04-01 — Media Proxy para solucionar 403 en Render

### Problema
El addon funcionaba en localhost pero fallaba con **error 403 Forbidden** en producción (Render.com). Los servidores de video (Streamwish, VidHide, etc.) bloquean IPs de datacenters o generan links atados a la IP del servidor que los solicitó.

### Solución implementada: Media Proxy interno

Todo el tráfico de video ahora pasa a través del propio servidor del addon en Render. El servidor de video "cree" que quien reproduce el video es el mismo servidor que extrajo el link, por lo que la IP coincide y autoriza la reproducción.

### Archivos modificados

#### `src/lib/http.js`
- **AÑADIDA** función `proxyStream(req, res, targetUrl, targetHeaders)`:
  - Hace `fetch` al servidor de video con `User-Agent` real, `Referer` y soporte de `Range` headers.
  - Transmite la respuesta directamente al reproductor de Stremio.

#### `src/server.js`
- **AÑADIDA** ruta `GET /p/:payload` → `handleProxy()`:
  - Decodifica el payload Base64 → `{ url, headers }`.
  - Llama a `proxyStream()` para tunelizar el video.

#### `src/lib/extractors.js`
- **AÑADIDA** función `buildProxiedUrl(targetUrl, referer)`:
  - Genera `https://{ADDON_URL}/p/{base64(JSON({url,headers}))}.mp4`
  - Usa la variable de entorno `ADDON_URL`.
- **MODIFICADA** función `buildStream(...)`: nuevo parámetro `shouldProxy`.
- **MODIFICADA** función `resolveExtractorStream(...)`: nuevo parámetro `shouldProxy`. Si está activo, reemplaza las URLs de todos los streams extraídos por URLs del proxy.

#### `src/providers/gnula.js`
- **MODIFICADO** `resolvePlayerStream`: `shouldProxy = true` para todos los streams.

#### `src/providers/cinecalidad.js`
- **MODIFICADO** `resolvePlayerStream`: `shouldProxy = true` para todos los streams.
- Eliminada lógica especial de `goodstream` (ya manejada por el proxy).

#### `render.yaml`
- **AÑADIDA** variable de entorno `ADDON_URL`:
  ```yaml
  - key: ADDON_URL
    value: https://stremio-web-scraper-addon.onrender.com
  ```
  > ⚠️ **Esta variable es crítica.** Sin ella el proxy genera URLs relativas y Stremio no puede reproducir.

### Variables de entorno requeridas en Render

| Variable | Valor |
|---|---|
| `NODE_VERSION` | `20` |
| `STREAM_SELECTION_MODE` | `global` |
| `STREAM_MAX_RESULTS` | `1` |
| `GNULA_BASE_URL` | `https://gnula.life` |
| `CINECALIDAD_BASE_URL` | `https://www.cinecalidad.ec` |
| `ADDON_URL` | `https://stremio-web-scraper-addon.onrender.com` |

### Notas para desarrollo futuro

- **Nuevos providers:** Recordar usar `resolveExtractorStream(url, label, true)` y `buildStream(name, title, url, referer, true)` para que los streams sean proxeados.
- **HLS (`.m3u8`):** El proxy actual funciona para `.mp4` y streams directos. Si se necesita soporte completo de HLS (proxy de segmentos), habría que extender `proxyStream` para manejar playlists M3U8.
- **Ancho de banda:** Todo el video pasa por Render. Monitorear el uso mensual en el plan gratuito.
