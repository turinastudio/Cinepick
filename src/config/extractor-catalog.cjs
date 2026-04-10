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
