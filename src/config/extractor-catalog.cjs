const EXTRACTOR_DEFINITIONS = [
  {
    id: "mp4upload",
    label: "MP4Upload",
    section: "reliable",
    mode: "internal_preferred",
    scopes: ["general", "anime"],
    description: "Host directo y hoy el mas confiable para reproduccion interna.",
    aliases: ["mp4upload"]
  },
  {
    id: "yourupload",
    label: "YourUpload",
    section: "reliable",
    mode: "internal_preferred",
    scopes: ["general", "anime"],
    description: "Suele funcionar bien, aunque puede ser inconsistente segun el caso.",
    aliases: ["yourupload"]
  },
  {
    id: "uqload",
    label: "Uqload",
    section: "reliable",
    mode: "internal_preferred",
    scopes: ["general", "anime"],
    description: "Puede funcionar como interno cuando expone media directa.",
    aliases: ["uqload", "uqload.is"]
  },
  {
    id: "pixeldrain",
    label: "PixelDrain",
    section: "reliable",
    mode: "internal_preferred",
    scopes: ["anime"],
    description: "Host anime util en algunos casos, con soporte interno puntual.",
    aliases: ["pixeldrain", "pdrain"]
  },
  {
    id: "netu",
    label: "Netu/HQQ",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general", "anime"],
    description: "Host fragil; a veces requiere tokens dinamicos y puede fallar dentro de Stremio.",
    aliases: ["netu", "hqq", "waaw", "waaw.tv"]
  },
  {
    id: "filemoon",
    label: "Filemoon",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general", "anime"],
    description: "Extractor disponible, pero con cambios frecuentes del host.",
    aliases: ["filemoon", "moonplayer", "moviesm4u", "files.im"]
  },
  {
    id: "streamwish",
    label: "StreamWish",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general", "anime"],
    description: "Suele abrir bien en navegador, pero es inestable para reproduccion interna.",
    aliases: ["streamwish", "sw", "wishembed", "streamgg", "hlswish", "kswplayer", "dhcplay"]
  },
  {
    id: "dood",
    label: "Dood",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general", "anime"],
    description: "Host fragil y muy sensible a protecciones anti-bot.",
    aliases: ["dood", "dooood", "dooodster", "d000d", "d0000d", "ds2play", "ds2video"]
  },
  {
    id: "streamtape",
    label: "StreamTape",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general", "anime"],
    description: "Disponible por extractor, aunque no siempre entrega media util para Stremio.",
    aliases: ["streamtape", "stape", "shavetape"]
  },
  {
    id: "mixdrop",
    label: "Mixdrop",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general", "anime"],
    description: "Puede resolver, pero es sensible a cambios del embed.",
    aliases: ["mixdrop", "mixdrp", "mixdroop", "m1xdrop"]
  },
  {
    id: "voe",
    label: "Voe",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general", "anime"],
    description: "Host util en algunos casos, con dominios alternativos y variaciones frecuentes.",
    aliases: ["voe", "tubelessceliolymph", "simpulumlamerop", "urochsunloath", "nathanfromsubject", "yip", "metagnathtuggers", "donaldlineelse"]
  },
  {
    id: "okru",
    label: "Okru",
    section: "experimental",
    mode: "external_preferred",
    scopes: ["anime"],
    description: "Conviene tratarlo mas como enlace externo que como stream interno confiable.",
    aliases: ["okru", "ok.ru"]
  },
  {
    id: "mega",
    label: "Mega",
    section: "experimental",
    mode: "external_preferred",
    scopes: ["anime"],
    description: "Mejor como apertura externa; no suele ser buen candidato para reproduccion interna.",
    aliases: ["mega", "mega.nz"]
  },
  {
    id: "hls",
    label: "HLS/Zilla",
    section: "experimental",
    mode: "external_preferred",
    scopes: ["anime"],
    description: "Abre bien en navegador, pero no es consistente dentro de Stremio.",
    aliases: ["hls", "zilla", "zilla-networks"]
  },
  {
    id: "vidhide",
    label: "VidHide/StreamHide",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general", "anime"],
    description: "Host popular con multiples dominios; puede variar en estabilidad.",
    aliases: ["vidhide", "ahvsh", "streamhide", "guccihide", "streamvid", "kinoger", "smoothpre", "dhtpre", "peytonepre", "earnvids", "ryderjet", "vidhidehub", "filelions", "vidhidevip", "vidhidepre", "cvid"]
  },
  {
    id: "vimeos",
    label: "Vimeos",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general", "anime"],
    description: "Host alternativo; calidad variable.",
    aliases: ["vimeos", "vimeos.net"]
  },
  {
    id: "goodstream",
    label: "GoodStream",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general", "anime"],
    description: "Host con multiples mirrors; puede ser inconsistente.",
    aliases: ["goodstream", "goodstream.cc"]
  },
  {
    id: "fastream",
    label: "Fastream",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general", "anime"],
    description: "Host disponible en varios providers; estabilidad variable.",
    aliases: ["fastream", "fastream.to"]
  },
  {
    id: "rpmvid",
    label: "RpmVid",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general", "anime"],
    description: "Host con cifrado AES; disponible en algunos embeds.",
    aliases: ["rpmvid", "cubeembed"]
  },
  {
    id: "emturbovid",
    label: "EmTurboVid",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general"],
    description: "Host HLS con dominios turbovid; puede variar.",
    aliases: ["emturbovid", "turbovidhls", "turboviplay"]
  },
  {
    id: "cuevanaplayer",
    label: "Cuevana Player",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general"],
    description: "Player propio de Cuevana; solo funciona con ese provider.",
    aliases: ["cuevanaplayer", "player.cuevana3.eu"]
  },
  {
    id: "strp2p",
    label: "StrP2P",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general"],
    description: "Player P2P embebido; disponibilidad variable.",
    aliases: ["strp2p", "4meplayer", "upns.pro", "p2pplay"]
  },
  {
    id: "streamembed",
    label: "StreamEmbed",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general"],
    description: "Host multi-mirror (BullStream, MP4Player).",
    aliases: ["streamembed", "bullstream", "mp4player", "watch.gxplayer"]
  },
  {
    id: "vidsrc",
    label: "VidSrc",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general"],
    description: "Fuente de terceros; puede ser inestable.",
    aliases: ["vidsrc", "vsrc"]
  },
  {
    id: "dropload",
    label: "Dropload",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general"],
    description: "Host alternativo con dominios DR0P.",
    aliases: ["dropload", "dr0pstream"]
  },
  {
    id: "vidora",
    label: "Vidora",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general"],
    description: "Host HLS; disponibilidad variable.",
    aliases: ["vidora"]
  },
  {
    id: "lamovie",
    label: "LaMovie",
    section: "experimental",
    mode: "internal_experimental",
    scopes: ["general"],
    description: "Player interno del provider LaMovie.",
    aliases: ["lamovie", "lamovie.link", "la.movie"]
  }
];

const extractorAliasMap = new Map();

for (const definition of EXTRACTOR_DEFINITIONS) {
  extractorAliasMap.set(definition.id, definition.id);
  for (const alias of definition.aliases) {
    extractorAliasMap.set(String(alias).trim().toLowerCase(), definition.id);
  }
}

function getExtractorDefinitions() {
  return EXTRACTOR_DEFINITIONS.map((definition) => ({
    ...definition,
    aliases: [...definition.aliases],
    scopes: [...definition.scopes]
  }));
}

function resolveExtractorId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return extractorAliasMap.get(normalized) || null;
}

module.exports = {
  getExtractorDefinitions,
  resolveExtractorId
};
