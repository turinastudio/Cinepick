const { getProviderById } = require("../providers");
const { getCinemetaMeta, getTmdbMeta } = require("../lib/metadata");
const { getImdbIdFromAnimeId } = require("../lib/relations");
const { resolveExternalMetadata } = require("../lib/external-resolution");
const { getExternalMetaFromCandidates, resolveProviderCandidates } = require("../lib/external-pipeline");

function mapCatalogMeta(providerId, anime) {
  const rawSlug = String(anime.slug || "");
  const exposedSlug = providerId === "animeflv" && rawSlug.endsWith("-tv")
    ? rawSlug.slice(0, -3)
    : rawSlug;

  return {
    id: `${providerId}:${exposedSlug}`,
    type: anime.type,
    name: anime.title,
    poster: anime.poster,
    description: anime.overview,
    genres: anime.genres
      ? anime.genres.map((item) => item.slice(0, 1).toUpperCase() + item.slice(1))
      : undefined
  };
}

function getCatalogProvider(videoId) {
  if (videoId.startsWith("animeav1")) return getProviderById("animeav1");
  if (videoId.startsWith("henaojara")) return getProviderById("henaojara");
  return getProviderById("animeflv");
}

function getPageData(videoId, skip) {
  const itemsPerPage = videoId.startsWith("animeav1") ? 20 : 24;
  return {
    page: skip ? Math.floor(skip / itemsPerPage) + 1 : undefined,
    gottenItems: skip ? skip % itemsPerPage : undefined
  };
}

async function resolveCatalogResponse(type, videoId, extra = {}) {
  const provider = getCatalogProvider(videoId);
  let metas;

  if (Object.keys(extra).length > 0 && !videoId.includes("onair")) {
    const { page, gottenItems } = getPageData(videoId, Number(extra.skip || 0));
    const results = await provider.search({
      query: extra.search,
      type: type === "movie" || type === "series" ? type : undefined,
      genres: extra.genre,
      page,
      gottenItems
    });
    metas = results.map((anime) => mapCatalogMeta(provider.id, anime));
  } else {
    const results = await provider.getAiring();
    metas = results.map((anime) => mapCatalogMeta(provider.id, anime));
  }

  return {
    metas,
    message: "Got Anime metadata!"
  };
}

async function resolveCalendarVideos(calendarVideosIds) {
  const uniqueIds = [...new Set(
    String(calendarVideosIds)
      .slice(18)
      .split(",")
      .filter((id) =>
        id.startsWith("animeflv:")
        || id.startsWith("animeav1:")
        || id.startsWith("henaojara:")
        || id.startsWith("anilist:")
        || id.startsWith("kitsu:")
        || id.startsWith("mal:")
        || id.startsWith("anidb:")
      )
  )];

  const settled = await Promise.allSettled(uniqueIds.map(async (item) => {
    const [prefix, id] = item.split(":");
    if (prefix === "animeflv") return getProviderById("animeflv").getMeta({ slug: id });
    if (prefix === "animeav1") return getProviderById("animeav1").getMeta({ slug: id });
    if (prefix === "henaojara") return getProviderById("henaojara").getMeta({ slug: id });

    const resolvedMetadata = await resolveExternalMetadata("series", item)
      .catch(async () => {
        const imdbId = await getImdbIdFromAnimeId(prefix, id);
        const metadata = await getTmdbMeta(imdbId).catch(() => getCinemetaMeta(imdbId, "series"));
        return {
          metadata,
          season: undefined,
          episode: undefined
        };
      });
    const candidateState = await resolveProviderCandidates("series", resolvedMetadata);
    const { meta } = await getExternalMetaFromCandidates(candidateState.candidates);
    return meta;
  }));

  return {
    metasDetailed: settled
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value)
      .map((meta) => ({
        ...meta,
        videos: Array.isArray(meta.videos)
          ? meta.videos.filter((video) => video.released >= new Date())
          : []
      }))
  };
}

module.exports = {
  resolveCalendarVideos,
  resolveCatalogResponse
};
