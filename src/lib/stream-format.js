function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractLanguage(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("[lat]") || /\blatino\b|\blatam\b/.test(value)) return "LAT";
  if (value.includes("[cast]") || /\bcastellano\b|\bespa[ñn]ol\b/.test(value)) return "CAST";
  if (value.includes("[sub]") || /\bsubtitulado\b|\bvose\b/.test(value)) return "SUB";
  return "";
}

function extractQuality(text) {
  const value = String(text || "").toLowerCase();
  if (/\b(full hd|1080p)\b/.test(value)) return "FHD";
  if (/\b(2160p|4k)\b/.test(value)) return "UHD 4K";
  if (/\b720p\b/.test(value)) return "720P";
  if (/\b480p\b/.test(value)) return "480P";
  if (/\bhd\b/.test(value)) return "HD";
  return "";
}

function extractSource(stream) {
  const explicit = String(stream._sourceLabel || "").trim();
  if (explicit) {
    return explicit;
  }

  const title = normalizeSpaces(stream.title || "");
  const name = normalizeSpaces(stream.name || "");
  return title.split(/\s+/).at(-1) || name || "Stream";
}

export function buildHttpStreamTitle(stream) {
  const currentTitle = String(stream.title || "");
  if (/^[🌐📺]/u.test(currentTitle)) {
    return currentTitle;
  }

  const language = extractLanguage(`${stream.title || ""} ${stream.name || ""}`);
  const quality = extractQuality(stream.title || "");
  const source = extractSource(stream);
  const provider = normalizeSpaces(stream.name || "");
  const header = ["🌐", language, quality, source].filter(Boolean).join(" | ");
  return provider ? `${header}\n[${provider}]` : header;
}
