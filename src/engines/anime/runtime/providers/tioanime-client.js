const cheerio = require("cheerio-without-node-native");
const { fetchText } = require("../../../../shared/fetch.cjs");
const {
  buildExternalStreams: buildProviderExternalStreams,
  buildInternalStreams: buildProviderInternalStreams
} = require("../lib/provider-streams");

const TIOANIME_BASE = process.env.TIOANIME_BASE_URL || "https://tioanime.com";

async function fetchHtml(url) {
  return fetchText(url);
}

function buildSearchUrl(query, genres = undefined, page = undefined) {
  const queryPart = query ? `q=${encodeURIComponent(query)}&` : "";
  const genrePart = genres ? `genero%5B%5D=${genres.join("&genero%5B%5D=")}&` : "";
  const pagePart = page ? `p=${page}&` : "";
  return `${TIOANIME_BASE}/directorio?${queryPart}${genrePart}${pagePart}year=1950%2C2026&sort=recent`;
}

function normalizeHref(href) {
  return String(href || "").replace(/^\.\//, "/").replace(/^\./, "");
}

function parseSearchResults(html, genres, gottenItems = 0) {
  const $ = cheerio.load(html);
  const items = [];

  $("main > ul > li").each((_, el) => {
    const href = $(el).find("a").attr("href") || "";
    const title = $(el).find("h3.title").text() || $(el).find("figure > img").attr("alt");
    const slug = normalizeHref(href).replace("/anime/", "").replace(/^\//, "");

    items.push({
      title,
      type: "series", // TioAnime has movies but default to series mapped later
      slug,
      poster: `${TIOANIME_BASE}${$(el).find("figure > img").attr("src")}`,
      overview: undefined,
      genres
    });
  });

  return items.slice(gottenItems);
}

async function searchTioAnime(query, genres = undefined, page = undefined, gottenItems = 0) {
  if (!query && !genres) {
    throw new Error("No arguments passed to searchTioAnime()");
  }

  const html = await fetchHtml(buildSearchUrl(query, genres, page));
  return parseSearchResults(html, genres, gottenItems);
}

function extractAnimeInfo(html, slug) {
  const $ = cheerio.load(html);
  const scripts = $("script");
  
  const episodesScript = scripts.map((_, el) => $(el).html()).get().find(script => script?.includes("var episodes ="));
  const episodesMatch = episodesScript?.match(/episodes = (\[.*?\]);/s);
  let episodesArray = [];
  try {
    episodesArray = episodesMatch ? JSON.parse(episodesMatch[1]) : [];
  } catch (e) {
    // Ignore parse error
  }

  const nextAiringInfo = html?.match(/Proximo episodio: <span>([^<]+)<\/span>/i)?.[1];

  const posterPath = $("#tioanime > article > div > div > aside > div.thumb > figure > img").attr("src");
  
  const animeInfo = {
    title: $("#tioanime > article > div > div > aside > h1.title").text(),
    alternative_titles: [],
    status: $("#tioanime > article > div > div > aside > div.thumb > a.status").text(),
    type: $("#tioanime > article > div > div > aside > div.meta > span.anime-type-peli").text(),
    cover: posterPath ? `${TIOANIME_BASE}${posterPath}` : "",
    synopsis: $("#tioanime > article > div > div > aside > p.sinopsis").text(),
    genres: $("#tioanime > article > div > div > aside > p.genres > span").map((_, el) => $(el).find("a").text().trim()).get(),
    episodes: [],
    url: `${TIOANIME_BASE}/anime/${slug}`,
    next_airing_episode: nextAiringInfo ? Date.parse(nextAiringInfo) : undefined
  };

  const imgPattern = /\/(\d+).jpg$/;
  const matches = imgPattern.exec(animeInfo.cover) || [];
  animeInfo.internalID = matches[1];

  for (const ep of episodesArray) {
    animeInfo.episodes.push({
      number: ep,
      slug: `${slug}-${ep}`,
      url: `${TIOANIME_BASE}/ver/${slug}-${ep}`
    });
  }

  const relatedEls = $("#tioanime > div > div > aside > div > section > ul > li");
  const relatedAnimes = [];
  relatedEls.each((_, el) => {
    const link = $(el).find("a");
    const href = link.attr("href");
    const title = $(el).find("h3.title").text().trim();
    const relation = "Related"; 
    if (href && title) {
      const relSlug = href.match(/\/anime\/([^/]+)/)?.[1] || href;
      relatedAnimes.push({
        title,
        relation,
        slug: relSlug,
        url: `${TIOANIME_BASE}${href}`
      });
    }
  });

  if (relatedAnimes.length > 0) {
    animeInfo.related = relatedAnimes;
  }

  return animeInfo;
}

function buildMetaFromAnimeInfo(slug, animeInfo) {
  const epCount = animeInfo.episodes.length;
  const videos = animeInfo.episodes.map((ep) => {
    const d = new Date(Date.now());
    return {
      id: `tioanime:${slug}:${ep.number}`,
      title: `${animeInfo.title} Ep. ${ep.number}`,
      season: 1,
      episode: ep.number,
      number: ep.number,
      thumbnail: animeInfo.internalID
        ? `${TIOANIME_BASE}/uploads/thumbs/${animeInfo.internalID}.jpg`
        : undefined,
      released: new Date(d.setDate(d.getDate() - (epCount - ep.number))),
      available: true
    };
  });

  if (animeInfo.next_airing_episode !== undefined && !isNaN(animeInfo.next_airing_episode)) {
    videos.push({
      id: `tioanime:${slug}:${epCount + 1}`,
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
  
  const isMovieType = String(animeInfo.type || "").toLowerCase().includes("pel") || String(animeInfo.type || "").toLowerCase().includes("movie");

  return {
    name: animeInfo.title,
    alternative_titles: animeInfo.alternative_titles,
    type: isMovieType ? "movie" : "series",
    videos,
    poster: animeInfo.cover,
    background: animeInfo.internalID ? `${TIOANIME_BASE}/uploads/animes/thumbs/${animeInfo.internalID}.jpg` : animeInfo.cover,
    genres: animeInfo.genres,
    description: String(animeInfo.synopsis || "").trim(),
    website: animeInfo.url,
    id: `tioanime:${slug}`,
    language: "jpn",
    ...(animeInfo.related && {
      links: animeInfo.related.map((r) => ({
        name: r.title,
        category: r.relation,
        url: `stremio:///detail/series/tioanime:${r.slug}`
      }))
    }),
    ...(animeInfo.next_airing_episode !== undefined && { behaviorHints: { hasScheduledVideos: true } }),
    ...(videos.length === 1 && { behaviorHints: { defaultVideoId: `tioanime:${slug}:1` } })
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

async function getTioAnimeMeta(slug) {
  const html = await fetchHtml(`${TIOANIME_BASE}/anime/${slug}`);
  const animeInfo = extractAnimeInfo(html, slug);
  return buildMetaFromAnimeInfo(slug, animeInfo);
}

async function getTioAnimeAiringTitles() {
  const html = await fetchHtml(TIOANIME_BASE);
  const $ = cheerio.load(html);
  
  const entries = [];
  $("#tioanime > div > section:nth-child(3) > ul > li").each((_, el) => {
    const title = $(el).find("h3.title").text();
    const href = $(el).find("a").attr("href") || "";
    const slug = href.replace("/anime/", "").replace(/^\//, "");
    
    if (slug) {
      entries.push({ slug, title });
    }
  });
  
  const settled = await Promise.allSettled(
    entries.map(async ({ slug }) => mapMetaToAiringEntry(slug, await getTioAnimeMeta(slug)))
  );

  return settled
    .filter((item) => item.status === "fulfilled" && item.value)
    .map((item) => item.value);
}

function buildEpisodeUrl(slug, episodeNumber = 1) {
  return `${TIOANIME_BASE}/ver/${slug}-${episodeNumber}`;
}

function getServerTitle(serverDomain) {
  const cleanDom = String(serverDomain || "")
    .replace("bysesukior", "Filemoon")
    .replace("movearnpre", "Vidhide")
    .replace("luluvdo", "Lulustream")
    .replace("dhcplay", "Streamwish")
    .replace("listeamed", "Vidguard")
    .replace("rpmvip", "RPMshare")
    .replace("yourupload", "YourUpload")
    .replace("mp4upload", "MP4Upload")
    .replace("pdrain", "PDrain")
    .replace("hls", "HLS")
    .replace(".com", "")
    .replace(".net", "")
    .replace(".org", "")
    .replace(".top", "")
    .replace(".to", "")
    .replace(".ac", "")
    .replace(".sx", "")
    .replace(".ps", "");

  return cleanDom.charAt(0).toUpperCase() + cleanDom.slice(1);
}

async function parseEpisodeLinks(html, slug, episodeNumber = 1) {
  const $ = cheerio.load(html);
  const episodeLinks = {
    title: $("#tioanime > div > div > aside > h1.title").text(),
    number: episodeNumber,
    servers: []
  };

  const scripts = $("script");
  const serversScript = scripts.map((_, el) => $(el).html()).get().find(script => script?.includes("var videos ="));
  const serversMatch = serversScript?.match(/var videos = (\[\[.*?\]\]);/s);
  
  if (serversMatch) {
    try {
      const servers = JSON.parse(serversMatch[1]);
      for (const s of servers) {
        episodeLinks.servers.push({
          name: s[0],
          embed: String(s[1]).replace("mega.nz/embed#!", "mega.nz/embed/"),
          dub: false
        });
      }
    } catch (e) {
      // ignore
    }
  }

  return episodeLinks;
}

function buildExternalStreams(epName, servers) {
  return buildProviderExternalStreams({
    providerLabel: "TioAnime",
    bingePrefix: "tioanime",
    epName,
    servers
  });
}

async function buildInternalStreams(epName, servers) {
  return buildProviderInternalStreams({
    providerLabel: "TioAnime",
    bingePrefix: "tioanime",
    epName,
    servers,
    supportedHosts: ["YourUpload", "MP4Upload", "PDrain", "Uqload", "VidGuard", "Vidhide", "Filemoon", "Streamtape", "Streamwish", "Lulustream", "Mega", "DoodStream", "OkRu"]
  });
}

async function getTioAnimeStreams(slug, episodeNumber = 1) {
  const html = await fetchHtml(buildEpisodeUrl(slug, episodeNumber || 1));
  const episodeData = await parseEpisodeLinks(html, slug, episodeNumber || 1);
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
  getTioAnimeAiringTitles,
  getTioAnimeMeta,
  getTioAnimeStreams,
  searchTioAnime
};
