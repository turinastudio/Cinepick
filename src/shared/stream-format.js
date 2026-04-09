function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getRawTitle(stream) {
  return normalizeSpaces(stream._rawTitle || stream.title || "");
}

function extractLanguage(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("[lat]") || /\blatino\b|\blatam\b/.test(value)) return "Latino";
  if (value.includes("[cast]") || /\bcastellano\b|\bespa(?:n|\u00f1)ol\b/.test(value)) return "Castellano";
  if (value.includes("[sub]") || /\bsubtitulado\b|\bvose\b/.test(value)) return "Subtitulado";
  return "Multilenguaje";
}

function humanizeSource(source) {
  const normalized = String(source || "").trim().toLowerCase();
  const aliases = {
    vidhide: "VidHide",
    netu: "Netu",
    hqq: "HQQ",
    streamwish: "StreamWish",
    hlswish: "HLSWish",
    filemoon: "FileMoon",
    vimeos: "Vimeos",
    voe: "VOE",
    goodstream: "GoodStream",
    mp4upload: "MP4Upload",
    okru: "OK.RU",
    streamtape: "StreamTape",
    upstream: "UpStream",
    uqload: "Uqload",
    dood: "DoodStream",
    generic: "Directo"
  };

  return aliases[normalized] || String(source || "Directo").trim() || "Directo";
}

function extractSource(stream) {
  const explicit = String(stream._sourceLabel || "").trim();
  if (explicit) {
    return humanizeSource(explicit);
  }

  const title = getRawTitle(stream);
  const name = normalizeSpaces(stream.name || "");
  return humanizeSource(title.split(/\s+/).at(-1) || name || "Directo");
}

function stripPresentationTokens(text) {
  return normalizeSpaces(
    String(text || "")
      .replace(/\[(lat|cast|sub)\]/gi, " ")
      .replace(/\b(latino|latam|castellano|subtitulado|vose)\b/gi, " ")
      .replace(/\b(2160p|4k|1080p|720p|480p|full hd|hd)\b/gi, " ")
      .replace(/\b(vidhide|netu|hqq|streamwish|hlswish|filemoon|vimeos|voe|goodstream|mp4upload|okru|streamtape|upstream|uqload|dood)\b/gi, " ")
      .replace(/[|[\]]/g, " ")
  );
}

function extractDisplayTitle(stream) {
  const preferred = normalizeSpaces(stream.descriptionTitle || stream._displayTitle || "");
  if (preferred) {
    return preferred;
  }

  const rawTitle = getRawTitle(stream);
  const cleaned = stripPresentationTokens(rawTitle);
  if (cleaned) {
    return cleaned;
  }

  const shortDescription = normalizeSpaces(stream.description || "");
  if (shortDescription && shortDescription.length <= 120 && !/[.!?].+[.!?]/.test(shortDescription)) {
    return shortDescription;
  }

  return rawTitle || "Stream";
}

export function buildHttpStreamTitle(stream) {
  const currentTitle = String(stream.title || "");
  if (currentTitle.startsWith("Apoyar ")) {
    return currentTitle;
  }

  const rawTitle = getRawTitle(stream);
  const language = extractLanguage(`${rawTitle} ${stream.name || ""}`);
  const source = extractSource(stream);
  const displayTitle = extractDisplayTitle(stream);
  const provider = normalizeSpaces(stream.name || "Cinepick");

  return [
    displayTitle,
    language,
    `${provider} - ${source}`
  ].join("\n");
}
