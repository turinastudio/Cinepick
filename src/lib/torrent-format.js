function normalizeSpaces(value) {
  return String(value || "").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
}

export function extractTorrentResolution(value) {
  const text = String(value || "");
  if (/\b(2160p|4k)\b/i.test(text)) return "UHD 4K";
  if (/\b1080p\b/i.test(text)) return "FHD";
  if (/\b720p\b/i.test(text)) return "720P";
  if (/\b480p\b/i.test(text)) return "480P";
  return "";
}

export function extractTorrentTags(value) {
  const text = String(value || "");
  const tags = [];

  if (/\b(?:hdr10|hdr)\b/i.test(text)) tags.push("HDR");
  if (/\bimax\b/i.test(text)) tags.push("IMAX");
  if (/\bweb[-.\s]?dl\b/i.test(text)) tags.push("WEB-DL");
  else if (/\bwebrip\b/i.test(text)) tags.push("WEBRip");
  else if (/\b(?:blu[-.\s]?ray|bdrip|brrip)\b/i.test(text)) tags.push("BluRay");
  else if (/\bdvdrip\b/i.test(text)) tags.push("DVDRip");
  else if (/\bremux\b/i.test(text)) tags.push("Remux");

  return tags;
}

function extractEncode(value) {
  const text = String(value || "");
  if (/\b(?:hevc|x265|h265)\b/i.test(text)) return "HEVC";
  if (/\b(?:av1)\b/i.test(text)) return "AV1";
  if (/\b(?:x264|h264|avc)\b/i.test(text)) return "x264";
  return "";
}

function extractAudioTags(value) {
  const text = String(value || "");
  const tags = [];
  if (/\batmos\b/i.test(text)) tags.push("Atmos");
  if (/\btruehd\b/i.test(text)) tags.push("TrueHD");
  if (/\bdts[-\s]?hd\b/i.test(text)) tags.push("DTS-HD");
  else if (/\bdts\b/i.test(text)) tags.push("DTS");
  if (/\bddp?\b|\bdolby digital\b/i.test(text)) tags.push("DD");
  if (/\baac\b/i.test(text)) tags.push("AAC");
  return tags;
}

function extractAudioChannels(value) {
  const text = String(value || "");
  const match = text.match(/\b(7\.1|5\.1|2\.0|1\.0)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function normalizeLanguageTag(languageTag) {
  return String(languageTag || "").replace(/[\[\]]/g, "").trim();
}

export function buildTorrentTitle({ languageTag = "", baseTitle = "", rawName = "", size = "" }) {
  const cleanBase = normalizeSpaces(baseTitle || rawName || "Torrent");
  const rawText = normalizeSpaces(rawName || baseTitle);
  const resolution = extractTorrentResolution(rawText);
  const tags = extractTorrentTags(rawText);
  const encode = extractEncode(rawText);
  const audioTags = extractAudioTags(rawText);
  const channels = extractAudioChannels(rawText);
  const language = normalizeLanguageTag(languageTag);
  const sizeLabel = String(size || "").trim();

  const header = ["🧲", language, resolution].filter(Boolean).join(" | ");
  const line1 = header || "🧲";
  const line2 = `⌜${cleanBase}⌟`;
  const line3Parts = [encode, ...tags];
  const line4Parts = [...audioTags, channels].filter(Boolean);
  const line5Parts = [sizeLabel].filter(Boolean);

  if (language) {
    line5Parts.push(language);
  }

  const lines = [
    line1,
    line2,
    line3Parts.length ? `✧ ${line3Parts.join(" · ")}` : "",
    line4Parts.length ? `♬ ${line4Parts.join(" · ")}` : "",
    line5Parts.length ? `◧ ${line5Parts.join(" · ")}` : ""
  ].filter(Boolean);

  return lines.join("\n");
}
