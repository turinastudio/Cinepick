const cheerio = require("cheerio-without-node-native");
const { fetchText } = require("../../../../shared/fetch.cjs");
const {
  buildExternalStreams: buildProviderExternalStreams,
  buildInternalStreams: buildProviderInternalStreams
} = require("../lib/provider-streams");
const { isMovieTypeLabel } = require("../lib/anime-types");

const ANIMEFLV_BASE = process.env.ANIMEFLV_BASE_URL || "https://www3.animeflv.net";
const ANIMEFLV_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  Referer: "https://www3.animeflv.net/"
};

async function fetchHtml(url) {
  return fetchText(url, {
    headers: ANIMEFLV_HEADERS,
    redirect: "follow"
  });
}

function buildSlugCandidates(slug) {
  const normalized = String(slug || "").trim();
  if (!normalized) {
    return [];
  }

  const candidates = [normalized];
  if (normalized.endsWith("-tv")) {
    candidates.push(normalized.slice(0, -3));
  } else {
    candidates.push(`${normalized}-tv`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function buildSearchUrl(query, genres = undefined, page = undefined) {
  return `${ANIMEFLV_BASE}/browse?${query ? `q=${encodeURIComponent(query)}&` : ""}${genres ? `genre[]=${genres.join("&genre[]=")}` : ""}${page ? `&page=${page}` : ""}`;
}

function parseSearchResults(html, genres, gottenItems = 0) {
  const $ = cheerio.load(html);
  const items = [];

  $("body > div.Wrapper > div > div > main > ul > li").each((_, el) => {
    const anchor = $(el).find("a").first();
    const href = anchor.attr("href") || "";
    const slug = href.replace("/anime/", "");

    items.push({
      title: $(el).find("h3").text(),
      type: isMovieTypeLabel($(el).find("a > div > span.Type").text()) ? "movie" : "series",
      slug,
      poster: $(el).find("figure > img").attr("src"),
      overview: $(el).find("div.Description > p").eq(1).text(),
      genres
    });
  });

  if (items.length < 1) {
    throw new Error("No search results!");
  }

  return items.slice(gottenItems);
}

function normalizeSearchTypes(results) {
  return results.map((item) => {
    const rawType = String(item.type || "");
    const title = String(item.title || "").toLowerCase();
    const slug = String(item.slug || "").toLowerCase();

    if (slug.includes("naruto-ga-hokage-ni-natta-hi")) {
      return {
        ...item,
        type: "series"
      };
    }

    if (slug.includes("blood-prison")) {
      return {
        ...item,
        type: "movie"
      };
    }

    const looksLikeMovieTitle = [
      "pelicula",
      "película",
      "road to ninja",
      "blood prison"
    ].some((marker) => title.includes(marker));

    return {
      ...item,
      type: item.type === "movie"
        || isMovieTypeLabel(rawType)
        || rawType.includes("Pel")
        || looksLikeMovieTitle
        || /(?:^|[-])(movie|peliculas|pelicula|film)(?:$|[-])/i.test(slug)
        ? "movie"
        : "series"
    };
  });
}

async function searchAnimeFLV(query, genres = undefined, page = undefined, gottenItems = 0) {
  if (!query && !genres) {
    throw new Error("No arguments passed to searchAnimeFLV()");
  }

  const html = await fetchHtml(buildSearchUrl(query, genres, page));
  const results = parseSearchResults(html, genres, gottenItems);
  return normalizeSearchTypes(results);
}

function extractAnimeInfo(html, slug) {
  const $ = cheerio.load(html);
  const scripts = $("script");
  const nextAiringScript = scripts
    .map((_, el) => $(el).html())
    .get()
    .find((script) => script?.includes("var anime_info ="));
  const nextAiringInfo = nextAiringScript?.match(/anime_info\s*=\s*(\[[\s\S]*?\]);?$/m)?.[1];
  const episodesScript = scripts
    .map((_, el) => $(el).html())
    .get()
    .find((script) => script?.includes("var episodes ="));
  const episodesArray = episodesScript?.match(/episodes\s*=\s*(\[\[[\s\S]*?\]\]);?$/m)?.[1];

  const animeInfo = {
    title: $("body > div.Wrapper > div > div > div.Ficha.fchlt > div.Container > h1").text(),
    alternative_titles: [],
    status: $("body > div.Wrapper > div > div > div.Container > div > aside > p > span").text(),
    rating: $("#votes_prmd").text(),
    type: $("body > div.Wrapper > div > div > div.Ficha.fchlt > div.Container > span").text(),
    cover: `https://animeflv.net${$("body > div.Wrapper > div > div > div.Container > div > aside > div.AnimeCover > div > figure > img").attr("src") || ""}`,
    synopsis: $("body > div.Wrapper > div > div > div.Container > div > main > section:nth-child(1) > div.Description > p").text(),
    genres: $("body > div.Wrapper > div > div > div.Container > div > main > section:nth-child(1) > nav > a")
      .map((_, el) => $(el).text().trim())
      .get(),
    next_airing_episode: nextAiringInfo ? JSON.parse(nextAiringInfo)?.[3] : undefined,
    episodes: [],
    url: `${ANIMEFLV_BASE}/anime/${slug}`
  };

  const episodeObjects = episodesArray ? JSON.parse(episodesArray) : [];
  for (const ep of episodeObjects) {
    animeInfo.episodes.push({
      number: ep[0],
      slug: `${slug}-${ep[0]}`,
      url: `${ANIMEFLV_BASE}/ver/${slug}-${ep[0]}`
    });
  }

  $("body > div.Wrapper > div > div > div.Ficha.fchlt > div.Container > div:nth-child(3) > span").each((_, el) => {
    animeInfo.alternative_titles.push($(el).text());
  });

  const related = [];
  $("ul.ListAnmRel > li").each((_, el) => {
    const link = $(el).find("a");
    const href = link.attr("href");
    const title = link.text().trim();
    const relation = $(el).text().match(/\(([^)]+)\)$/)?.[1];

    if (href && title) {
      related.push({
        title,
        relation,
        slug: href.match(/\/anime\/([^/]+)/)?.[1] || href,
        url: `${ANIMEFLV_BASE}${href}`
      });
    }
  });

  if (related.length > 0) {
    animeInfo.related = related;
  }

  return animeInfo;
}

function isValidAnimeInfo(animeInfo) {
  return Boolean(
    animeInfo
    && typeof animeInfo.title === "string"
    && animeInfo.title.trim() !== ""
  );
}

function buildMetaFromAnimeInfo(slug, animeInfo) {
  const epCount = animeInfo.episodes.length;
  const matches = /\/(\d+).jpg$/g.exec(animeInfo.cover);
  const imageId = matches?.[1];
  const videos = animeInfo.episodes.map((ep) => {
    const d = new Date(Date.now());
    return {
      id: `animeflv:${slug}:${ep.number}`,
      title: `${animeInfo.title} Ep. ${ep.number}`,
      season: 1,
      episode: ep.number,
      number: ep.number,
      thumbnail: imageId ? `https://cdn.animeflv.net/screenshots/${imageId}/${ep.number}/th_3.jpg` : undefined,
      released: new Date(d.setDate(d.getDate() - (epCount - ep.number))),
      available: true
    };
  });

  if (animeInfo.next_airing_episode !== undefined) {
    videos.push({
      id: `animeflv:${slug}:${epCount + 1}`,
      title: `${animeInfo.title} Ep. ${epCount + 1}`,
      season: 1,
      episode: epCount + 1,
      number: epCount + 1,
      thumbnail: `${ANIMEFLV_BASE}/assets/animeflv/img/cnt/proximo.png`,
      released: new Date(animeInfo.next_airing_episode),
      available: false
    });
  }

  return {
    name: animeInfo.title,
    alternative_titles: animeInfo.alternative_titles,
    type: animeInfo.type === "Anime" ? "series" : "movie",
    videos,
    poster: animeInfo.cover,
    background: imageId ? `${ANIMEFLV_BASE}/uploads/animes/thumbs/${imageId}.jpg` : animeInfo.cover,
    genres: animeInfo.genres,
    description: animeInfo.synopsis,
    website: animeInfo.url,
    id: `animeflv:${slug}`,
    language: "jpn",
    ...(animeInfo.related && {
      links: animeInfo.related.map((r) => ({
        name: r.title,
        category: r.relation,
        url: `stremio:///detail/series/animeflv:${r.slug}`
      }))
    }),
    ...(animeInfo.next_airing_episode !== undefined && { behaviorHints: { hasScheduledVideos: true } }),
    ...(videos.length === 1 && { behaviorHints: { defaultVideoId: `animeflv:${slug}:1` } })
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

async function getAnimeFLVMeta(slug) {
  let lastError;

  for (const candidateSlug of buildSlugCandidates(slug)) {
    try {
      const html = await fetchHtml(`${ANIMEFLV_BASE}/anime/${candidateSlug}`);
      const animeInfo = extractAnimeInfo(html, candidateSlug);

      if (!isValidAnimeInfo(animeInfo)) {
        throw new Error("Invalid AnimeFLV metadata page");
      }

      return buildMetaFromAnimeInfo(candidateSlug, animeInfo);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("AnimeFLV metadata not found");
}

function parseAiringSlugs(html) {
  const $ = cheerio.load(html);
  const entries = [];

  $(".ListSdbr > li").each((_, el) => {
    const href = $(el).find("a").attr("href") || "";
    entries.push({
      slug: href.replace("/anime/", "")
    });
  });

  if (entries.length < 1) {
    throw new Error("No on-air results!");
  }

  return entries;
}

async function getAnimeFLVAiringTitles() {
  const html = await fetchHtml(ANIMEFLV_BASE);
  const entries = parseAiringSlugs(html);
  const settled = await Promise.allSettled(
    entries.map(async ({ slug }) => mapMetaToAiringEntry(slug, await getAnimeFLVMeta(slug)))
  );

  return settled
    .filter((item) => item.status === "fulfilled" && item.value)
    .map((item) => item.value);
}

function buildEpisodeUrl(slug, episodeNumber = 1) {
  return `${ANIMEFLV_BASE}/ver/${slug}-${episodeNumber}`;
}

function parseEpisodeLinks(html) {
  const $ = cheerio.load(html);
  const episodeLinks = {
    title: $("body > div.Wrapper > div.Body > div > div > div > nav.Brdcrmb > a").next("i").next("a").text(),
    number: Number($("body > div.Wrapper > div.Body > div > div > div > div.CapiTop > h2.SubTitle").text().replace("Episodio ", "")),
    servers: []
  };

  const scripts = $("script");
  const serversFind = scripts.map((_, el) => $(el).html()).get().find((script) => script?.includes("var videos ="));
  const serversObj = serversFind?.match(/var videos\s*=\s*(\{[\s\S]*?\});?$/m)?.[1];

  if (serversObj) {
    const parsed = JSON.parse(serversObj);
    const subtitled = parsed.SUB || [];
    const dubbed = parsed.DUB || [];

    for (const s of subtitled) {
      episodeLinks.servers.push({
        name: s?.title,
        download: s?.url?.replace("mega.nz/#!", "mega.nz/file/"),
        embed: s?.code?.replace("mega.nz/embed#!", "mega.nz/embed/"),
        dub: false
      });
    }

    for (const s of dubbed) {
      episodeLinks.servers.push({
        name: s?.title,
        download: s?.url?.replace("mega.nz/#!", "mega.nz/file/"),
        embed: s?.code?.replace("mega.nz/embed#!", "mega.nz/embed/"),
        dub: true
      });
    }
  }

  $("body > div.Wrapper > div.Body > div > div > div > div > div > table > tbody > tr").each((_, el) => {
    const name = $(el).find("td").eq(0).text();
    if (["Zippyshare", "1Fichier"].includes(name)) {
      episodeLinks.servers.push({
        name,
        download: $(el).find("td:last-child a").attr("href")
      });
    }
  });

  if (!episodeLinks.title || episodeLinks.servers.length < 1) {
    throw new Error("No AnimeFLV episode links found");
  }

  return episodeLinks;
}

function buildExternalStreams(epName, servers) {
  return buildProviderExternalStreams({
    providerLabel: "AnimeFLV",
    bingePrefix: "animeFLV",
    epName,
    servers
  });
}

async function buildInternalStreams(epName, servers) {
  return buildProviderInternalStreams({
    providerLabel: "AnimeFLV",
    bingePrefix: "animeFLV",
    epName,
    servers,
    supportedHosts: ["YourUpload"]
  });
}

async function getAnimeFLVStreams(slug, episodeNumber = 1) {
  let lastError;

  for (const candidateSlug of buildSlugCandidates(slug)) {
    try {
      const html = await fetchHtml(buildEpisodeUrl(candidateSlug, episodeNumber || 1));
      const episodeData = parseEpisodeLinks(html);
      const epName = episodeData.number
        ? `${episodeData.title} Ep. ${episodeData.number}`
        : episodeData.title;

      const [internalStreams, externalStreams] = await Promise.all([
        buildInternalStreams(epName, episodeData.servers),
        Promise.resolve(buildExternalStreams(epName, episodeData.servers))
      ]);

      return internalStreams.concat(externalStreams);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("AnimeFLV streams not found");
}

module.exports = {
  getAnimeFLVAiringTitles,
  getAnimeFLVMeta,
  getAnimeFLVStreams,
  searchAnimeFLV
};
