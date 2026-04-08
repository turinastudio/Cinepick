const cheerio = require("cheerio-without-node-native");
const {
  buildExternalStreams: buildProviderExternalStreams,
  buildInternalStreams: buildProviderInternalStreams
} = require("../lib/provider-streams");
const { isMovieTypeLabel, normalizeTypeLabel } = require("../lib/anime-types");

const ANIMEAV1_BASE = process.env.ANIMEAV1_BASE_URL || "https://animeav1.com";

function looksLikeMovieSearchItem(title, rawType, slug) {
  const normalizedType = normalizeTypeLabel(rawType);
  const normalizedTitle = String(title || "").toLowerCase();
  const normalizedSlug = String(slug || "").toLowerCase();
  const combined = `${normalizedTitle} ${normalizedSlug}`;

  if (normalizedSlug.includes("episode-0")) {
    return false;
  }

  return isMovieTypeLabel(normalizedType)
    || normalizedType.includes("pel")
    || normalizedTitle.includes(" movie")
    || normalizedTitle.includes("pelicula")
    || normalizedTitle.includes("película")
    || normalizedTitle.includes("film")
    || /(?:^|[-\s])(movie|film|pelicula|pel\u00edcula|red|stampede|gold|strong-world|zed|3d|3d2y|chase)(?:$|[-\s])/.test(combined);
}

async function fetchHtml(url) {
  const response = await fetch(url);
  if (!response || !response.ok || response.status !== 200) {
    throw new Error(`HTTP error! Status: ${response?.status}`);
  }
  return response.text();
}

function buildSearchUrl(query, type = undefined, genres = undefined, page = undefined) {
  const typeQuery = type
    ? (type === "movie"
      ? "category=pelicula&"
      : "category=tv-anime&category=ova&category=especial&")
    : "";

  return `${ANIMEAV1_BASE}/catalogo?${query ? `search=${encodeURIComponent(query)}&` : ""}${typeQuery}${genres ? `genre=${genres.join("&genre=")}` : ""}${page ? `&page=${page}` : ""}`;
}

function parseSearchResults(html, genres, gottenItems = 0) {
  const $ = cheerio.load(html);
  const items = [];

  $("body > div > div.container > main > section > div > article").each((_, el) => {
    const anchor = $(el).find("a").first();
    const href = anchor.attr("href") || "";
    const rawType = $(el).find("div > figure + div > div").text();

    items.push({
      title: $(el).find("header > h3").text(),
      rawType,
      type: isMovieTypeLabel(rawType) ? "movie" : "series",
      slug: href.replace("/media/", ""),
      poster: $(el).find("div > figure > img").attr("src"),
      overview: $(el).find("div > div > div > p").eq(1).text(),
      genres
    });
  });

  if (items.length < 1) {
    throw new Error("No search results!");
  }

  return items.slice(gottenItems);
}

function normalizeSearchTypes(results) {
  return results.map((item) => ({
    ...item,
    type: looksLikeMovieSearchItem(item.title, item.rawType, item.slug)
      ? "movie"
      : "series"
  }));
}

async function searchAnimeAV1(query, type = undefined, genres = undefined, page = undefined, gottenItems = 0) {
  if (!query && !genres) {
    throw new Error("No arguments passed to searchAnimeAV1()");
  }

  const html = await fetchHtml(buildSearchUrl(query, type, genres, page));
  return normalizeSearchTypes(parseSearchResults(html, genres, gottenItems));
}

function extractMetadataObject(html) {
  const $ = cheerio.load(html);
  const scripts = $("script");
  const metadataJson = scripts
    .map((_, el) => $(el).html())
    .get()
    .find((script) => script?.includes("kit.start(app, element, {"));

  return metadataJson?.match(/data:(.+\]),/s)?.[1];
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractAnimeInfo(html, slug) {
  const $ = cheerio.load(html);
  const metadataObj = extractMetadataObject(html);

  const animeInfo = {
    title: metadataObj?.match(/title:\s?"(.+?)",/)?.[1] || $("body main > article > div > div > header > div > h1").text(),
    alternative_titles: [],
    status: metadataObj?.match(/title:\s?"(.*?)",/)?.[1] || $("body main > article > div > div > header > div > span:last-child").text(),
    rating: metadataObj?.match(/score:\s?(\d{0,2}\.\d{0,2}),/)?.[1] || $("div.ic-star-solid > div.text-lead").text(),
    type: metadataObj?.match(/category:\s?.+?name:"(.*?)",/)?.[1] || $("body main > article > div > div > header > div > span:first-child").text(),
    cover: $("body main > article > div > div > figure > img").attr("src"),
    synopsis: metadataObj?.match(/synopsis:\s?"(.*?)",/)?.[1] || $("body main > article > div > div > div.entry > p").text(),
    genres: metadataObj?.match(/genres:\s?(.*?)],/s)?.[1]?.matchAll(/name:\s?"(.+?)"/g)?.toArray().map((el) => el[1].trim())
      || $("body main > article > div > div > header > div > a").map((_, el) => $(el).text().trim()).get(),
    episodes: [],
    url: `${ANIMEAV1_BASE}/media/${slug}`,
    ...(metadataObj?.match(/runtime:\s?(.*?),/)?.[1] !== "null") && { runtime: `${metadataObj?.match(/runtime:\s?(.*?),/)?.[1]}m` || undefined },
    ...(metadataObj?.match(/trailer:\s?"(.*?)",/)?.[1]) && { trailers: metadataObj?.match(/trailer:\s?"(.*?)",/)?.[1] || undefined }
  };

  if (metadataObj?.includes("episodesCount")) {
    const episodesCount = Number(metadataObj?.match(/episodesCount:\s?(\d+),/)?.[1]);
    for (let i = 1; i <= episodesCount; i += 1) {
      animeInfo.episodes.push({
        number: i,
        slug: `${slug}-${i}`,
        url: `${ANIMEAV1_BASE}/media/${slug}/${i}`
      });
    }
  }

  if (metadataObj?.includes("aka:")) {
    const altTitles = safeJsonParse(metadataObj?.match(/aka:\s?({.+?}),/s)?.[1]);
    if (altTitles) {
      for (const value of Object.values(altTitles)) {
        animeInfo.alternative_titles.push(value);
      }
    }
  } else {
    $("body main > article > div > div > header > div > h2").each((_, el) => {
      animeInfo.alternative_titles.push($(el).text());
    });
  }

  const related = [];
  $("body > div > div.container > main > section:nth-child(2) > div > div.gradient-cut > div > div").each((_, el) => {
    const link = $(el).find("a");
    const href = link.attr("href");
    const title = $(el).find("h3").text().trim();
    const relation = $(el).find("h3 + span").text().trim();

    if (href && title) {
      related.push({
        title,
        relation,
        slug: href.match(/\/media\/([^/]+)/)?.[1] || href,
        url: `${ANIMEAV1_BASE}${href}`
      });
    }
  });

  if (related.length > 0) {
    animeInfo.related = related;
  }

  if (metadataObj?.includes("startDate:")) {
    const startDate = Date.parse(metadataObj?.match(/startDate:\s?"(.*?)",/)?.[1]);
    const endDate = Date.parse(metadataObj?.match(/endDate:\s?"(.*?)",/)?.[1]);
    if (!Number.isNaN(startDate)) animeInfo.startDate = new Date(startDate);
    if (!Number.isNaN(endDate)) animeInfo.endDate = new Date(endDate);
  }

  return animeInfo;
}

function buildMetaFromAnimeInfo(slug, animeInfo) {
  const epCount = animeInfo.episodes.length;
  const matches = /\/(\d+).jpg$/g.exec(animeInfo.cover || "");
  const imageId = matches?.[1];
  const videos = animeInfo.episodes.map((ep) => {
    const d = new Date(Date.now());
    return {
      id: `animeav1:${slug}:${ep.number}`,
      title: `${animeInfo.title} Ep. ${ep.number}`,
      season: 1,
      episode: ep.number,
      number: ep.number,
      thumbnail: imageId ? `https://cdn.animeav1.com/screenshots/${imageId}/${ep.number}.jpg` : undefined,
      released: new Date(d.setDate(d.getDate() - (epCount - ep.number))),
      available: true
    };
  });

  if (animeInfo.next_airing_episode !== undefined) {
    videos.push({
      id: `animeav1:${slug}:${epCount + 1}`,
      title: `${animeInfo.title} Ep. ${epCount + 1}`,
      season: 1,
      episode: epCount + 1,
      number: epCount + 1,
      thumbnail: "https://www3.animeflv.net/assets/animeflv/img/cnt/proximo.png",
      released: new Date(animeInfo.next_airing_episode),
      available: false
    });
  }

  if (videos.length === 1 && epCount === 1) {
    videos[0].title = videos[0].title.replace(" Ep. 1", "");
  }

  return {
    name: animeInfo.title,
    alternative_titles: animeInfo.alternative_titles,
    type: isMovieTypeLabel(animeInfo.type) ? "movie" : "series",
    videos,
    poster: animeInfo.cover,
    background: imageId ? `https://cdn.animeav1.com/thumbnails/${imageId}.jpg` : animeInfo.cover,
    genres: animeInfo.genres,
    description: String(animeInfo.synopsis || "").replaceAll(/\\n/g, "\n").replaceAll(/\\"/g, "\""),
    website: animeInfo.url,
    id: `animeav1:${slug}`,
    language: "jpn",
    ...(animeInfo.related && {
      links: animeInfo.related.map((r) => ({
        name: r.title,
        category: r.relation,
        url: `stremio:///detail/series/animeav1:${r.slug}`
      }))
    }),
    runtime: animeInfo.runtime,
    ...(animeInfo.startDate && {
      released: animeInfo.startDate,
      releaseInfo: `${animeInfo.startDate.getFullYear()}-${animeInfo.endDate !== undefined ? animeInfo.endDate?.getFullYear() : ""}`
    }),
    ...(animeInfo.trailers && { trailers: [{ source: animeInfo.trailers, type: "Trailer" }] }),
    ...(animeInfo.next_airing_episode !== undefined && { behaviorHints: { hasScheduledVideos: true } }),
    ...(videos.length === 1 && { behaviorHints: { defaultVideoId: `animeav1:${slug}:1` } })
  };
}

function mapMetaToAiringEntry(slug, meta) {
  return {
    title: meta.name,
    type: meta.type,
    slug,
    poster: meta.poster,
    overview: meta.description
  };
}

async function getAnimeAV1Meta(slug) {
  const html = await fetchHtml(`${ANIMEAV1_BASE}/media/${slug}`);
  const animeInfo = extractAnimeInfo(html, slug);
  return buildMetaFromAnimeInfo(slug, animeInfo);
}

async function getAnimeAV1AiringTitles() {
  const html = await fetchHtml(`${ANIMEAV1_BASE}/catalogo?status=emision`);
  const entries = parseSearchResults(html, undefined, 0);
  const settled = await Promise.allSettled(
    entries.map(async ({ slug }) => mapMetaToAiringEntry(slug, await getAnimeAV1Meta(slug)))
  );

  return settled
    .filter((item) => item.status === "fulfilled" && item.value)
    .map((item) => item.value);
}

function buildEpisodeUrl(slug, episodeNumber = 1) {
  return `${ANIMEAV1_BASE}/media/${slug}/${episodeNumber}`;
}

function parseEpisodeLinks(html, episodeNumber = 1) {
  const $ = cheerio.load(html);
  const episodeLinks = {
    title: $("body > div > div.container > main > article > div > div > header > div > div > a").text(),
    number: isMovieTypeLabel($("body > div > div.container > main > article > div > div > header > div.flex > span").first().text().trim())
      ? undefined
      : Number($("body > div > div.container > main > article > div > div > header > div.flex + h1").text().replace("Episodio ", "")) || episodeNumber,
    servers: []
  };

  const scripts = $("script");
  const metadataJSON = scripts.map((_, el) => $(el).html()).get().find((script) => script?.includes("kit.start(app, element, {"));
  const serversObj = metadataJSON?.match(/embeds:\s?.*?SUB:\s?(\[.*?\])/s)?.[1];
  const downloadObj = metadataJSON?.match(/downloads:\s?.*?SUB:\s?(\[.*?\])/s)?.[1];
  const serversObjDub = metadataJSON?.match(/embeds:\s?.*?DUB:\s?(\[.*?\])/s)?.[1];
  const downloadObjDub = metadataJSON?.match(/downloads:\s?.*?DUB:\s?(\[.*?\])/s)?.[1];

  let servers = [];
  if (serversObj) {
    servers = servers.concat(serversObj.split("},").map((item) => ({
      title: item.match(/server:\s?"(.*?)"/)?.[1],
      code: item.match(/url:\s?"(.*?)"/)?.[1]
    })));
  }
  if (downloadObj) {
    servers = servers.concat(downloadObj.split("},").map((item) => ({
      title: item.match(/server:\s?"(.*?)"/)?.[1],
      url: item.match(/url:\s?"(.*?)"/)?.[1]
    })));
  }
  if (serversObjDub) {
    servers = servers.concat(serversObjDub.split("},").map((item) => ({
      title: item.match(/server:\s?"(.*?)"/)?.[1],
      code: item.match(/url:\s?"(.*?)"/)?.[1],
      dub: true
    })));
  }
  if (downloadObjDub) {
    servers = servers.concat(downloadObjDub.split("},").map((item) => ({
      title: item.match(/server:\s?"(.*?)"/)?.[1],
      url: item.match(/url:\s?"(.*?)"/)?.[1],
      dub: true
    })));
  }

  for (const s of servers) {
    episodeLinks.servers.push({
      name: s?.title,
      download: s?.url?.replace("mega.nz/#!", "mega.nz/file/"),
      embed: s?.code?.replace("mega.nz/embed#!", "mega.nz/embed/"),
      dub: s?.dub || false
    });
  }

  return episodeLinks;
}

function buildExternalStreams(epName, servers) {
  return buildProviderExternalStreams({
    providerLabel: "AnimeAV1",
    bingePrefix: "animeAV1",
    epName,
    servers
  });
}

async function buildInternalStreams(epName, servers) {
  return buildProviderInternalStreams({
    providerLabel: "AnimeAV1",
    bingePrefix: "animeAV1",
    epName,
    servers,
    supportedHosts: ["YourUpload", "MP4Upload"]
  });
}

async function getAnimeAV1Streams(slug, episodeNumber = 1) {
  const html = await fetchHtml(buildEpisodeUrl(slug, episodeNumber || 1));
  const episodeData = parseEpisodeLinks(html, episodeNumber || 1);
  const epName = episodeData.number
    ? `${episodeData.title} Ep. ${episodeData.number}`
    : episodeData.title;
  const [internalStreams, externalStreams] = await Promise.all([
    buildInternalStreams(epName, episodeData.servers),
    Promise.resolve(buildExternalStreams(epName, episodeData.servers))
  ]);

  return internalStreams.concat(externalStreams);
}

module.exports = {
  getAnimeAV1AiringTitles,
  getAnimeAV1Meta,
  getAnimeAV1Streams,
  searchAnimeAV1
};
