const { getNativeSlugAndEpisode, isNativeProviderId, parseVideoId } = require("../lib/ids");
const { combineStreams } = require("../lib/stream-combiner");
const { selectStreams } = require("../lib/stream-selection");
const { appendSupportStream } = require("../lib/support-stream");
const { getExternalStreams, getProviderById } = require("../providers");

async function getNativeStreams(videoId) {
  const native = getNativeSlugAndEpisode(videoId);
  const providerIds = ["animeflv", "animeav1", "henaojara", "tioanime"];
  const settled = await Promise.allSettled([
    getProviderById("animeflv").getStreams({ slug: native.slug, episode: native.episode }),
    getProviderById("animeav1").getStreams({ slug: native.slug, episode: native.episode }),
    getProviderById("henaojara").getStreams({ slug: native.slug, episode: native.episode }),
    getProviderById("tioanime").getStreams({ slug: native.slug, episode: native.episode })
  ]);

  const combined = combineStreams(
    settled
      .map((item, index) =>
        item.status === "fulfilled"
          ? item.value.map((stream) => ({
            ...stream,
            _providerId: providerIds[index]
          }))
          : []
      )
  );

  return selectStreams(combined);
}

async function resolveStreamResponse(type, videoId) {
  const parsed = parseVideoId(videoId);

  if (isNativeProviderId(parsed.prefix)) {
    const streams = appendSupportStream(await getNativeStreams(videoId));
    return {
      streams,
      message: streams.length > 0 ? "Got streams!" : "Failed getting Anime info"
    };
  }

  const streams = appendSupportStream(await getExternalStreams(type, videoId));
  return {
    streams,
    message: streams.length > 0 ? "Got streams!" : "Failed getting media info"
  };
}

module.exports = {
  resolveStreamResponse
};
