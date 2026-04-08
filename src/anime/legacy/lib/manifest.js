const fsPromises = require("fs/promises");
const path = require("path");
const { buildCatalogs } = require("./catalog-definitions");

const DEFAULT_LOGO = "https://play-lh.googleusercontent.com/ZIjIwO5FJe9R1rplSd4uz54OwBxQhwDcznjljSPl2MgHaCoyF3qG6R4kRMCB40f4l2A=w256";
const DEFAULT_DESCRIPTION = "Olvidate de probar streams uno por uno. Anipick busca en multiples fuentes y elige automaticamente el mejor disponible. Gratis, sin anuncios, sin suscripcion. Te gusto? Podes invitarme un cafe y ayudar a mantener el proyecto vivo.";

async function readPackageManifest() {
  const packagePath = path.resolve(__dirname, "..", "..", "package.json");
  const raw = await fsPromises.readFile(packagePath, "utf8");
  return JSON.parse(raw);
}

function absolutizeAsset(origin, assetPath, fallback) {
  const normalized = String(assetPath || "").trim();
  if (!normalized) {
    return fallback;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  const safeOrigin = String(origin || "").replace(/\/$/, "");
  return safeOrigin ? `${safeOrigin}${normalized}` : fallback;
}

async function buildManifest(origin = "") {
  const packageJson = await readPackageManifest();

  return {
    id: "com.anipick.stremio.addon.v2",
    version: packageJson.version,
    name: "Anipick",
    logo: absolutizeAsset(origin, "/logo.png", DEFAULT_LOGO),
    description: process.env.MANIFEST_DESCRIPTION || DEFAULT_DESCRIPTION,
    resources: ["stream", "meta", "catalog"],
    types: ["movie", "series", "anime", "other"],
    idPrefixes: [
      "tt",
      "animeflv:",
      "animeav1:",
      "henaojara:",
      "tmdb:",
      "anilist:",
      "kitsu:",
      "mal:",
      "anidb:"
    ],
    catalogs: buildCatalogs(),
    behaviorHints: {
      newEpisodeNotifications: true
    }
  };
}

module.exports = {
  buildManifest
};
