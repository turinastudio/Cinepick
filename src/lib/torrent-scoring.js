const DEFAULT_TORRENT_MAX_RESULTS = 1;
const DEFAULT_TORRENT_MAX_SIZE_BYTES = 4 * 1024 ** 3;

function parseSizeInBytes(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? value : 0;
  }

  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return 0;
  }

  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(tb|gb|mb|kb|b)\b/i);
  if (!match) {
    return 0;
  }

  const amount = Number(match[1].replace(",", ".")) || 0;
  const unit = match[2].toLowerCase();
  const multipliers = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4
  };

  return Math.round(amount * (multipliers[unit] || 1));
}

function buildTorrentText(stream) {
  return `${stream.title || ""} ${stream.name || ""} ${stream.description || ""}`.toLowerCase();
}

function detectResolutionScore(stream) {
  const text = buildTorrentText(stream);
  if (/\b1080p\b/.test(text)) return 26;
  if (/\b(2160p|4k)\b/.test(text)) return 22;
  if (/\b720p\b/.test(text)) return 16;
  if (/\b480p\b/.test(text)) return 6;
  return 0;
}

function detectLanguageScore(stream) {
  const text = buildTorrentText(stream);
  if (text.includes("[lat]") || /\blatino\b|\blatam\b/.test(text)) return 30;
  if (text.includes("[cast]") || /\bcastellano\b|\bespa[ñn]ol\b/.test(text)) return 22;
  if (/\bdual\b|\bdual audio\b|\bmulti(audio)?\b/.test(text)) return 14;
  if (text.includes("[sub]") || /\bsubtitulado\b|\bvose\b/.test(text)) return 8;
  return 0;
}

function detectSeederScore(stream) {
  const seeders = Number(stream.seeders ?? stream.seeds ?? 0) || 0;
  if (seeders >= 200) return 32;
  if (seeders >= 100) return 26;
  if (seeders >= 50) return 20;
  if (seeders >= 20) return 14;
  if (seeders >= 5) return 8;
  if (seeders >= 1) return 3;
  return 0;
}

function detectPeerScore(stream) {
  const peers = Number(stream.peers ?? 0) || 0;
  if (peers >= 100) return 10;
  if (peers >= 40) return 7;
  if (peers >= 10) return 4;
  if (peers >= 1) return 2;
  return 0;
}

function detectSizeScore(stream) {
  const sizeBytes = parseSizeInBytes(stream.size ?? stream.behaviorHints?.videoSize);
  if (sizeBytes >= 3 * 1024 ** 3 && sizeBytes <= 4 * 1024 ** 3) return 12;
  if (sizeBytes >= 1500 * 1024 ** 2 && sizeBytes < 3 * 1024 ** 3) return 16;
  if (sizeBytes >= 700 * 1024 ** 2 && sizeBytes < 1500 * 1024 ** 2) return 12;
  if (sizeBytes >= 350 * 1024 ** 2 && sizeBytes < 700 * 1024 ** 2) return 6;
  return 0;
}

function detectQualityScore(stream) {
  const text = buildTorrentText(stream);
  if (/\bweb[-\s]?dl\b/.test(text)) return 8;
  if (/\bwebrip\b/.test(text)) return 6;
  if (/\b(?:blu[-\s]?ray|bdrip|brrip)\b/.test(text)) return 7;
  if (/\bremux\b/.test(text)) return 4;
  if (/\bdvdrip\b/.test(text)) return -8;
  if (/\b(?:screener|camrip)\b/.test(text)) return -16;
  return 0;
}

function detectSeasonPackPenalty(stream) {
  const text = buildTorrentText(stream);
  if (/\b(complete season|season pack|temporada completa|pack temporada)\b/.test(text)) {
    return 10;
  }
  return 0;
}

function detectCamPenalty(stream) {
  const text = buildTorrentText(stream);
  if (/\b(cam|hdcam|ts|telesync)\b/.test(text)) {
    return 40;
  }
  return 0;
}

function detectVisualTagPenalty(stream) {
  const text = buildTorrentText(stream);
  let penalty = 0;
  if (/\b3d\b/.test(text)) penalty += 20;
  if (/\bai\b/.test(text)) penalty += 12;
  if ((/\bdv\b|\bdolby vision\b/.test(text)) && !/\bhdr\b/.test(text)) penalty += 6;
  return penalty;
}

function dedupeTorrents(streams) {
  const seen = new Set();
  const deduped = [];

  for (const stream of streams) {
    const key = `${stream.infoHash || ""}::${stream.fileIdx ?? ""}::${stream.title || ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(stream);
  }

  return deduped;
}

export function analyzeScoredTorrents(providerId, streams) {
  return dedupeTorrents(streams)
    .filter((stream) => {
      const sizeBytes = parseSizeInBytes(stream.size ?? stream.behaviorHints?.videoSize);
      return sizeBytes === 0 || sizeBytes <= DEFAULT_TORRENT_MAX_SIZE_BYTES;
    })
    .map((stream) => {
      const resolutionScore = detectResolutionScore(stream);
      const languageScore = detectLanguageScore(stream);
      const seederScore = detectSeederScore(stream);
      const peerScore = detectPeerScore(stream);
      const sizeScore = detectSizeScore(stream);
      const qualityScore = detectQualityScore(stream);
      const seasonPackPenalty = detectSeasonPackPenalty(stream);
      const camPenalty = detectCamPenalty(stream);
      const visualTagPenalty = detectVisualTagPenalty(stream);
      const score =
        20 +
        resolutionScore +
        languageScore +
        seederScore +
        peerScore +
        sizeScore +
        qualityScore -
        seasonPackPenalty -
        camPenalty -
        visualTagPenalty;

      return {
        stream: {
          ...stream,
          _providerId: stream._providerId || providerId
        },
        score,
        components: {
          base: 20,
          resolutionScore,
          languageScore,
          seederScore,
          peerScore,
          sizeScore,
          qualityScore,
          seasonPackPenalty,
          camPenalty,
          visualTagPenalty
        }
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function scoreAndSelectTorrents(providerId, streams, options = {}) {
  const maxResults =
    Number.parseInt(process.env.TORRENT_MAX_RESULTS || "", 10) ||
    options.maxResults ||
    DEFAULT_TORRENT_MAX_RESULTS;

  return analyzeScoredTorrents(providerId, streams)
    .slice(0, Math.max(1, maxResults))
    .map((item) => {
      const { _providerId, ...stream } = item.stream;
      return stream;
    });
}
