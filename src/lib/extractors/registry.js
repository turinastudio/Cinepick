import requestContextShared from "../../config/request-context.cjs";
import { buildProxiedUrl, buildStream } from "./public-builders.js";
import { getHost, hostIncludes } from "./shared/html.js";
import { normalizeRequestHeaders } from "./shared/headers.js";
import { extractGenericM3u8Page, extractJWPlayer } from "./handlers/generic-m3u8.js";
import { extractMp4Upload } from "./handlers/mp4upload.js";
import { extractYourUpload } from "./handlers/yourupload.js";
import { extractStreamTape } from "./handlers/streamtape.js";
import { extractDood } from "./handlers/dood.js";
import { extractVoe } from "./handlers/voe.js";
import { extractStreamWish } from "./handlers/streamwish.js";
import { extractFilemoon } from "./handlers/filemoon.js";
import { extractVimeos } from "./handlers/vimeos.js";
import { extractVidHide } from "./handlers/vidhide.js";
import { extractRpmVid } from "./handlers/rpmvid.js";
import { extractNetuHqq } from "./handlers/netuhqq.js";
import { extractUqload } from "./handlers/uqload.js";
import { extractGoodstream } from "./handlers/goodstream.js";
import { extractMixdrop } from "./handlers/mixdrop.js";
import { extractEmturbovid } from "./handlers/emturbovid.js";
import { extractCuevanaPlayer } from "./handlers/cuevanaplayer.js";
import { extractStrp2p } from "./handlers/strp2p.js";
import { extractStreamEmbed } from "./handlers/streamembed.js";
import { extractVidSrc } from "./handlers/vidsrc.js";
import { extractDropload } from "./handlers/dropload.js";
import { extractVidora } from "./handlers/vidora.js";
import { extractFastream } from "./handlers/fastream.js";
import { extractLamovieEmbed } from "./handlers/lamovie.js";

const { isExtractorEnabled } = requestContextShared;

const extractorRegistry = [
  { id: "mp4upload", source: "cloudstream", aliases: ["mp4upload"], resolve: extractMp4Upload },
  { id: "yourupload", source: "cloudstream", aliases: ["yourupload"], resolve: extractYourUpload },
  { id: "streamtape", source: "cloudstream", aliases: ["streamtape", "stape", "shavetape"], resolve: extractStreamTape },
  { id: "dood", source: "cloudstream", aliases: ["dood", "ds2play", "ds2video", "dooood", "d000d", "d0000d"], resolve: extractDood },
  { id: "voe", source: "cloudstream", aliases: ["voe", "tubelessceliolymph", "simpulumlamerop", "urochsunloath", "nathanfromsubject", "yip", "metagnathtuggers", "donaldlineelse"], resolve: extractVoe },
  { id: "streamwish", source: "cloudstream", aliases: ["wishembed", "streamwish", "strwish", "streamgg", "kswplayer", "swhoi", "multimovies", "uqloads", "neko-stream", "swdyu", "iplayerhls", "hlswish", "hanerix", "hglink"], resolve: extractStreamWish },
  { id: "filemoon", source: "cloudstream", aliases: ["filemoon", "moonplayer", "moviesm4u", "files.im"], resolve: extractFilemoon },
  { id: "vimeos", source: "cinecalidad-addon-inspired", aliases: ["vimeos"], resolve: extractVimeos },
  { id: "vidhide", source: "cloudstream", aliases: ["ahvsh", "streamhide", "guccihide", "streamvid", "vidhide", "kinoger", "smoothpre", "dhtpre", "peytonepre", "earnvids", "ryderjet", "vidhidehub", "filelions", "vidhidevip", "vidhidepre", "cvid", "minochinos"], resolve: extractVidHide },
  { id: "rpmvid", source: "project-local", aliases: ["rpmvid", "cubeembed"], resolve: extractRpmVid },
  { id: "netu", source: "project-local", aliases: ["hqq", "netu", "waaw", "waaw.tv"], resolve: extractNetuHqq },
  { id: "uqload", source: "project-local", aliases: ["uqload", "uqload.is"], resolve: extractUqload },
  { id: "goodstream", source: "northstar-inspired", aliases: ["goodstream"], resolve: extractGoodstream },
  { id: "mixdrop", source: "northstar-inspired", aliases: ["mixdrop", "mixdrp", "mixdroop", "m1xdrop"], resolve: extractMixdrop },
  { id: "emturbovid", source: "northstar-inspired", aliases: ["emturbovid", "turbovidhls", "turboviplay"], resolve: extractEmturbovid },
  { id: "cuevana-player", source: "northstar-inspired", aliases: ["player.cuevana3.eu"], resolve: extractCuevanaPlayer },
  { id: "strp2p", source: "northstar-inspired", aliases: ["strp2p", "4meplayer", "upns.pro", "p2pplay"], resolve: extractStrp2p },
  { id: "streamembed", source: "northstar-inspired", aliases: ["bullstream", "mp4player", "watch.gxplayer"], resolve: extractStreamEmbed },
  { id: "vidsrc", source: "northstar-inspired", aliases: ["vidsrc", "vsrc"], resolve: extractVidSrc },
  { id: "dropload", source: "northstar-inspired", aliases: ["dropload", "dr0pstream"], resolve: extractDropload },
  { id: "vidora", source: "northstar-inspired", aliases: ["vidora"], resolve: extractVidora },
  { id: "fastream", source: "northstar-inspired", aliases: ["fastream"], resolve: extractFastream },
  { id: "lamovie", source: "lamovie-extension-inspired", aliases: ["lamovie.link"], resolve: extractLamovieEmbed }
];

export function getExtractorRegistry() {
  return extractorRegistry.map((extractor) => ({
    id: extractor.id,
    source: extractor.source,
    aliases: [...extractor.aliases]
  }));
}

export function matchExtractorByUrl(url) {
  const host = getHost(url);
  return extractorRegistry.find((extractor) => hostIncludes(host, extractor.aliases)) || null;
}

export async function resolveExtractorStream(url, label, shouldProxy = false) {
  const matchedExtractor = matchExtractorByUrl(url);
  if (matchedExtractor && !isExtractorEnabled(matchedExtractor.id)) {
    return [];
  }

  let streams = [];
  let extractorFailed = false;

  try {
    if (matchedExtractor) {
      streams = await matchedExtractor.resolve(url, label);
    } else if (/\.(m3u8|mp4)(\?|$)/i.test(url)) {
      streams = [buildStream("Gnula", label, url, null)];
    } else {
      const genericM3u8 = await extractGenericM3u8Page(url, label);
      if (genericM3u8.length) {
        streams = genericM3u8;
      } else {
        const jwPlayer = await extractJWPlayer(url, label);
        if (jwPlayer.length) {
          streams = jwPlayer;
        }
      }
    }
  } catch {
    extractorFailed = true;
  }

  if ((extractorFailed || streams.length === 0) && !/\.(m3u8|mp4)(\?|$)/i.test(url)) {
    const genericM3u8 = await extractGenericM3u8Page(url, label).catch(() => []);
    if (genericM3u8.length > 0) {
      streams = genericM3u8;
    } else {
      const jwPlayer = await extractJWPlayer(url, label).catch(() => []);
      if (jwPlayer.length > 0) {
        streams = jwPlayer;
      }
    }
  }

  if (streams.length === 0) {
    return [];
  }

  if (shouldProxy && streams.length > 0) {
    return streams.map((stream) => {
      if (stream.url && !/\/p\//.test(stream.url)) {
        const upstreamHeaders =
          stream._proxyHeaders ||
          stream.behaviorHints?.proxyHeaders?.request ||
          normalizeRequestHeaders(url);

        const proxiedBehaviorHints = { ...(stream.behaviorHints || {}) };
        delete proxiedBehaviorHints.proxyHeaders;

        return {
          ...stream,
          url: buildProxiedUrl(stream._targetUrl || stream.url, upstreamHeaders),
          _proxyHeaders: upstreamHeaders,
          _targetUrl: stream._targetUrl || stream.url,
          behaviorHints: Object.keys(proxiedBehaviorHints).length > 0 ? proxiedBehaviorHints : undefined
        };
      }
      return stream;
    });
  }

  return streams;
}
