# Cloudstream Extractors Status

Fuente inspeccionada:

- `C:\Users\lautaroturina\Desktop\Codex\Stremio_Addon_Antigravity\Stremio Addon\Recursos\cloudstream\library\src\commonMain\kotlin\com\lagradost\cloudstream3\extractors`

Cantidad detectada:

- `102` extractores

## Criterio

En este proyecto, Cloudstream es la fuente de verdad para la capa de extractores.

Eso significa:

- el provider del sitio puede seguir portándose desde Aniyomi o desde otra fuente
- pero la resolucion de hosts de video debe basarse en Cloudstream

## Implementados hoy en la extension

- `mp4upload`
- `yourupload`
- `streamtape`
- `dood`
- `voe`
- `streamwish`
- `filemoon`
- `vidhide`

## Fallbacks genericos de Cloudstream incorporados

- `GenericM3U8`
- `JWPlayer`
- `M3u8Manifest` como estrategia de parseo de manifests embebidos

## Pendientes de port explicito

Todavia no estan portados explicitamente los demas extractores presentes en la carpeta fuente de Cloudstream, entre ellos:

- `Acefile`
- `Bigwarp`
- `Blogger`
- `ByseSX`
- `Cda`
- `CineMMRedirect`
- `CloudMailRuExtractor`
- `ContentXExtractor`
- `Dailymotion`
- `Embedgram`
- `EmturbovidExtractor`
- `Evolaod`
- `Fastream`
- `Filesim`
- `GamoVideo`
- `GDMirrorbot`
- `Gdriveplayer`
- `Gofile`
- `GoodstreamExtractor`
- `GUpload`
- `HDMomPlayerExtractor`
- `HDPlayerSystemExtractor`
- `HDStreamAbleExtractor`
- `HotlingerExtractor`
- `HubCloud`
- `Hxfile`
- `InternetArchive`
- `Jeniusplay`
- `Krakenfiles`
- `Linkbox`
- `LuluStream`
- `MailRuExtractor`
- `Maxstream`
- `Mediafire`
- `Minoplres`
- `MixDrop`
- `Moviehab`
- `MultiQuality`
- `Mvidoo`
- `OdnoklassnikiExtractor`
- `OkRuExtractor`
- `PeaceMakerstExtractor`
- `Pelisplus`
- `PixelDrainExtractor`
- `PlayerVoxzer`
- `PlayLtXyz`
- `Rabbitstream`
- `RapidVidExtractor`
- `SBPlay`
- `SecvideoOnline`
- `Sendvid`
- `SibNetExtractor`
- `SobreatsesuypExtractor`
- `StreamEmbed`
- `Streamhub`
- `Streamlare`
- `StreamoUpload`
- `Streamplay`
- `StreamSB`
- `StreamSilk`
- `Streamup`
- `Supervideo`
- `Tantifilm`
- `TauVideoExtractor`
- `TRsTXExtractor`
- `Up4Stream`
- `UpstreamExtractor`
- `Uqload`
- `Userload`
- `Userscloud`
- `Uservideo`
- `Vicloud`
- `Videa`
- `VideoSeyredExtractor`
- `Vidmoly`
- `VidMoxyExtractor`
- `VidNest`
- `Vido`
- `Vidoza`
- `Vidsonic`
- `VidStack`
- `Vidstream`
- `Vinovo`
- `VkExtractor`
- `Vtbe`
- `WatchSB`
- `Wibufile`
- `XStreamCdn`
- `YoutubeExtractor`
- `Zplayer`

## Nota honesta

Portar los `102` extractores con calidad real implica adaptar:

- requests y headers
- unpackers de javascript
- crypto
- parseo de manifests
- en algunos casos interceptores tipo WebView

Eso no conviene hacerlo en una sola edicion masiva sin validar host por host. Este archivo deja trazabilidad clara para seguir la migracion por batches sin perder el estado.
