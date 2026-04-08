const cheerio = require("cheerio-without-node-native");
const { fetchText } = require("../../../../shared/fetch.cjs");
const {
  buildExternalStreams: buildProviderExternalStreams,
  buildInternalStreams: buildProviderInternalStreams
} = require("../lib/provider-streams");
const { isMovieTypeLabel, normalizeTypeLabel } = require("../lib/anime-types");

const HENAOJARA_BASE = process.env.HENAOJARA_BASE_URL || "https://ww1.henaojara.net";

async function fetchHtml(url) {
  return fetchText(url);
}

function buildSearchUrl(query, genres = undefined, page = undefined) {
  const queryPart = query ? `buscar=${encodeURIComponent(query).replaceAll("%20", "+")}&` : "";
  const genrePart = genres ? `genero=${genres.join(",")}` : "";
  const pagePart = page ? `&page=${page}` : "";
  return `${HENAOJARA_BASE}/animes?${queryPart}${genrePart}${pagePart}`;
}

function normalizeHref(href) {
  return String(href || "").replace(/^\.\//, "/").replace(/^\./, "");
}

function looksLikeMovieSearchItem(title, rawType, slug) {
  const normalizedTitle = String(title || "").toLowerCase();
  const normalizedType = normalizeTypeLabel(rawType);
  const normalizedSlug = String(slug || "").toLowerCase();
  const combined = `${normalizedTitle} ${normalizedSlug}`;

  if (
    normalizedSlug.includes("memories-of-nobody")
    || normalizedSlug.includes("fade-to-black")
    || normalizedSlug.includes("diamonddust-rebellion")
    || normalizedSlug.includes("jigoku-hen")
  ) {
    return true;
  }

  return isMovieTypeLabel(normalizedType)
    || /(?:^|[-\s])(movie|film|pelicula|pel\u00edcula|red|stampede|gold|strong-world|zed|3d|3d2y|chase)(?:$|[-\s])/.test(combined);
}

function parseSearchResults(html, genres, gottenItems = 0) {
  const $ = cheerio.load(html);
  const items = [];

  $("#m > section > div > article").each((_, el) => {
    const href = $(el).find("a").attr("href") || $(el).find("h3 > a").attr("href") || "";
    const title = $(el).find("h3").text() || $(el).find("figure > a > img").attr("alt");
    const slug = normalizeHref(href).replace("/anime/", "");
    const rawType = $(el).find("figure > a > b").text();

    items.push({
      title,
      type: looksLikeMovieSearchItem(title, rawType, slug) ? "movie" : "series",
      slug,
      poster: $(el).find("figure > a > img").attr("data-src"),
      overview: undefined,
      genres
    });
  });

  if (items.length < 1) {
    throw new Error("No search results!");
  }

  return items.slice(gottenItems);
}

async function searchHenaojara(query, genres = undefined, page = undefined, gottenItems = 0) {
  if (!query && !genres) {
    throw new Error("No arguments passed to searchHenaojara()");
  }

  const html = await fetchHtml(buildSearchUrl(query, genres, page));
  return parseSearchResults(html, genres, gottenItems);
}

function extractAnimeInfo(html, slug) {
  const $ = cheerio.load(html);
  const scripts = $("script");
  const episodesScript = scripts
    .map((_, el) => $(el).html())
    .get()
    .find((script) => script?.includes("var eps ="));
  const episodesArray = episodesScript?.match(/eps = (\[\[.*\].*])/s)?.[1];

  const animeInfo = {
    title: $("#l > div.info > div.info-b > h1").text() || $("#l > div.info > div.info-a > figure > img").attr("alt"),
    alternative_titles: $("#l > div.info > div.info-b > h3").text().split(",") || [],
    status: $("#l > div.info > div.info-b > span.e").text(),
    type: $("#l > div.info > div.info-b > ul.dt > li:first-child").text().replace("Tipo: ", ""),
    cover: $("#l > div.info > div.info-a > figure > img").attr("data-src") || `${HENAOJARA_BASE}/cdn/img/anime/${slug}.webp`,
    synopsis: $("#l > div.info > div.info-b > div.tx > p").text(),
    genres: $("#l > div.info > div.info-b > ul.gn > li").map((_, el) => $(el).find("a").text().trim()).get(),
    episodes: [],
    internalID: html.match(/data-ai="(\d+)"/)?.[1],
    url: `${HENAOJARA_BASE}/anime/${slug}`
  };

  const episodeObjects = episodesArray ? JSON.parse(episodesArray) : [];
  for (const ep of episodeObjects) {
    animeInfo.episodes.push({
      number: ep[0],
      slug: `${slug}-${ep[0]}`,
      url: `${HENAOJARA_BASE}/ver/${slug}-${ep[0]}`
    });
  }

  return animeInfo;
}

function buildMetaFromAnimeInfo(slug, animeInfo) {
  const epCount = animeInfo.episodes.length;
  const videos = animeInfo.episodes.map((ep) => {
    const d = new Date(Date.now());
    return {
      id: `henaojara:${slug}:${ep.number}`,
      title: `${animeInfo.title} Ep. ${ep.number}`,
      season: 1,
      episode: ep.number,
      number: ep.number,
      thumbnail: animeInfo.internalID
        ? `${HENAOJARA_BASE}/cdn/img/episodios/${animeInfo.internalID}-${ep.number}.webp?t=0.1`
        : undefined,
      released: new Date(d.setDate(d.getDate() - (epCount - ep.number))),
      available: true
    };
  });

  if (animeInfo.next_airing_episode !== undefined) {
    videos.push({
      id: `henaojara:${slug}:${epCount + 1}`,
      title: `${animeInfo.title} Ep. ${epCount + 1}`,
      season: 1,
      episode: epCount + 1,
      number: epCount + 1,
      thumbnail: "https://i.imgur.com/3U6r1nF.jpg",
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
    background: `${HENAOJARA_BASE}/cdn/img/portada/${animeInfo.slug}.webp?t=0.1`,
    genres: animeInfo.genres,
    description: String(animeInfo.synopsis || "").replaceAll(/\\n/g, "\n").replaceAll(/\\"/g, "\""),
    website: animeInfo.url,
    id: `henaojara:${slug}`,
    language: "jpn",
    ...(animeInfo.related && {
      links: animeInfo.related.map((r) => ({
        name: r.title,
        category: r.relation,
        url: `stremio:///detail/series/henaojara:${r.slug}`
      }))
    }),
    ...(animeInfo.next_airing_episode !== undefined && { behaviorHints: { hasScheduledVideos: true } }),
    ...(videos.length === 1 && { behaviorHints: { defaultVideoId: `henaojara:${slug}:1` } })
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

async function getHenaojaraMeta(slug) {
  const html = await fetchHtml(`${HENAOJARA_BASE}/anime/${slug}`);
  const animeInfo = extractAnimeInfo(html, slug);
  return buildMetaFromAnimeInfo(slug, animeInfo);
}

async function getHenaojaraAiringTitles() {
  const html = await fetchHtml(`${HENAOJARA_BASE}/animes?estado=en-emision`);
  const entries = parseSearchResults(html, undefined, 0);
  const settled = await Promise.allSettled(
    entries.map(async ({ slug }) => mapMetaToAiringEntry(slug, await getHenaojaraMeta(slug)))
  );

  return settled
    .filter((item) => item.status === "fulfilled" && item.value)
    .map((item) => item.value);
}

function buildEpisodeUrl(slug, episodeNumber = 1) {
  return `${HENAOJARA_BASE}/ver/${slug}-${episodeNumber}`;
}

function hexToAscii(hex) {
  let result = "";
  for (let index = 0; index < String(hex || "").length; index += 2) {
    result += String.fromCharCode(parseInt(hex.substr(index, 2), 16));
  }
  return result;
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

async function fetchServerOptions(slug, episodeNumber, html) {
  const $ = cheerio.load(html);
  const encrypted = $(".opt").attr("data-encrypt");
  if (!encrypted) {
    return "";
  }

  return fetchText(`${HENAOJARA_BASE}/hj`, {
    method: "POST",
    headers: {
      accept: "*/*",
      "accept-language": "en,en-US;q=0.9,es-ES;q=0.8,es;q=0.7,fr;q=0.6,no;q=0.5",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      priority: "u=1, i",
      "sec-ch-ua": "\"Opera GX\";v=\"125\", \"Not?A_Brand\";v=\"8\", \"Chromium\";v=\"141\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"Windows\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-requested-with": "XMLHttpRequest",
      Referer: `${HENAOJARA_BASE}/ver/${slug}-${episodeNumber}`
    },
    body: `acc=opt&i=${encrypted}`
  });
}

async function parseEpisodeLinks(html, slug, episodeNumber = 1) {
  const $ = cheerio.load(html);
  const episodeLinks = {
    title: $("#l > div > h1").text(),
    servers: []
  };

  const serversDiv = $("div.dwn");
  const downloadObj = JSON.parse(serversDiv.attr("data-dwn") || "null");
  const optionsHtml = await fetchServerOptions(slug, episodeNumber, html).catch(() => "");
  const $options = cheerio.load(optionsHtml);

  $options("li").each((_, el) => {
    const encrypted = $options(el).attr("encrypt");
    const decoded = hexToAscii(encrypted);
    const parsedUrl = new URL(decoded);
    episodeLinks.servers.push({
      name: getServerTitle(parsedUrl.hostname),
      embed: decoded.replace("mega.nz/embed#!", "mega.nz/embed/"),
      dub: false
    });
  });

  if (downloadObj) {
    for (const serverUrl of downloadObj) {
      const parsedUrl = new URL(serverUrl);
      episodeLinks.servers.push({
        name: getServerTitle(parsedUrl.hostname),
        download: serverUrl.replace("mega.nz/#!", "mega.nz/file/"),
        dub: false
      });
    }
  }

  return episodeLinks;
}

function buildExternalStreams(epName, servers) {
  return buildProviderExternalStreams({
    providerLabel: "Henaojara",
    bingePrefix: "henaojara",
    epName,
    servers
  });
}

async function buildInternalStreams(epName, servers) {
  return buildProviderInternalStreams({
    providerLabel: "Henaojara",
    bingePrefix: "henaojara",
    epName,
    servers,
    supportedHosts: ["YourUpload", "MP4Upload", "PDrain", "HLS"]
  });
}

async function getHenaojaraStreams(slug, episodeNumber = 1) {
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
  getHenaojaraAiringTitles,
  getHenaojaraMeta,
  getHenaojaraStreams,
  searchHenaojara
};
