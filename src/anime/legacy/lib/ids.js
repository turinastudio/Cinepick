function parseVideoId(videoId) {
  const parts = String(videoId || "").split(":");
  return {
    parts,
    prefix: parts[0] || "",
    values: parts.slice(1)
  };
}

function isNativeProviderId(prefix) {
  return ["animeflv", "animeav1", "henaojara"].includes(String(prefix || ""));
}

function getNativeSlugAndEpisode(videoId) {
  const parsed = parseVideoId(videoId);
  return {
    providerId: parsed.prefix,
    slug: parsed.values[0],
    episode: parsed.values[1]
  };
}

function getExternalIdDetails(videoId) {
  const parsed = parseVideoId(videoId);
  const prefix = parsed.prefix;

  if (prefix.startsWith("tt")) {
    return {
      kind: "imdb",
      imdbId: prefix,
      season: parsed.values[0],
      episode: parsed.values[1]
    };
  }

  if (prefix === "tmdb") {
    return {
      kind: "tmdb",
      tmdbId: parsed.values[0],
      season: parsed.values[1],
      episode: parsed.values[2]
    };
  }

  if (["kitsu", "mal", "anidb", "anilist"].includes(prefix)) {
    return {
      kind: "anime-id",
      provider: prefix,
      providerId: parsed.values[0],
      episode: parsed.values[1]
    };
  }

  return null;
}

module.exports = {
  getExternalIdDetails,
  getNativeSlugAndEpisode,
  isNativeProviderId,
  parseVideoId
};
