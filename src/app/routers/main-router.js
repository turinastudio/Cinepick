import fs from "node:fs";
import path from "node:path";
import { json } from "../../lib/http.js";
import { streamResultCache, cinemetaCache, tmdbCache, animeDetectionCache } from "../../shared/cache.js";
import { getCircuitStatus } from "../../lib/circuit-breaker.js";
import { rateLimiter } from "../../lib/rate-limiter.js";
import { getProviderById } from "../../engines/general/providers/core.js";

/**
 * Pre-load static assets at startup to avoid sync I/O on requests.
 */
function preloadStaticAssets() {
  const assets = {};

  const publicDir = path.join(process.cwd(), "public");

  // Configure panel
  const configureIndex = path.join(publicDir, "configure", "index.html");
  const configureApp = path.join(publicDir, "configure", "app.js");
  const configureStyles = path.join(publicDir, "configure", "styles.css");

  // Logo
  const logoPath = path.join(publicDir, "assets", "Logo.png");

  if (fs.existsSync(configureIndex)) {
    assets.configureIndex = fs.readFileSync(configureIndex);
  }
  if (fs.existsSync(configureApp)) {
    assets.configureApp = fs.readFileSync(configureApp);
  }
  if (fs.existsSync(configureStyles)) {
    assets.configureStyles = fs.readFileSync(configureStyles);
  }
  if (fs.existsSync(logoPath)) {
    assets.logo = fs.readFileSync(logoPath);
  }

  return assets;
}

const staticAssets = preloadStaticAssets();

/**
 * Main router: handles /, /manifest, /logo, /configure routes.
 */

export async function handleRoot(req, res, manifestBuilder) {
  const { requestConfig, basePathPrefix, buildManifest } = manifestBuilder;
  const builtManifest = buildManifest(req, requestConfig, basePathPrefix);

  json(res, 200, {
    ok: true,
    name: builtManifest.name,
    version: builtManifest.version
  });
  return true;
}

export async function handleManifest(req, res, manifestBuilder) {
  const { requestConfig, basePathPrefix, buildManifest } = manifestBuilder;

  json(res, 200, buildManifest(req, requestConfig, basePathPrefix), {
    "Cache-Control": "max-age=300, stale-while-revalidate=86400"
  });
  return true;
}

export async function handleLogo(req, res) {
  if (!staticAssets.logo) {
    res.writeHead(404);
    res.end();
    return true;
  }

  res.writeHead(200, { "Content-Type": "image/png" });
  res.end(staticAssets.logo);
  return true;
}

// Configure panel routes

// Cache headers for static assets (1 hour)
const STATIC_CACHE = "public, max-age=3600, stale-while-revalidate=86400";

export async function handleConfigureIndex(req, res) {
  if (!staticAssets.configureIndex) {
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end("<h1>Configure page not found</h1>");
    return true;
  }

  res.writeHead(200, {
    "Content-Type": "text/html",
    "Cache-Control": STATIC_CACHE
  });
  res.end(staticAssets.configureIndex);
  return true;
}

export async function handleConfigureApp(req, res) {
  if (!staticAssets.configureApp) {
    res.writeHead(404, { "Content-Type": "application/javascript" });
    res.end("");
    return true;
  }

  res.writeHead(200, {
    "Content-Type": "application/javascript",
    "Cache-Control": STATIC_CACHE
  });
  res.end(staticAssets.configureApp);
  return true;
}

export async function handleConfigureStyles(req, res) {
  if (!staticAssets.configureStyles) {
    res.writeHead(404, { "Content-Type": "text/css" });
    res.end("");
    return true;
  }

  res.writeHead(200, {
    "Content-Type": "text/css",
    "Cache-Control": STATIC_CACHE
  });
  res.end(staticAssets.configureStyles);
  return true;
}

export async function handleConfigureState(req, res, manifestBuilder) {
  const { getRequestOrigin, requestConfig, buildConfigureState } = manifestBuilder;

  json(res, 200, buildConfigureState(getRequestOrigin(req), requestConfig));
  return true;
}

/**
 * Health check endpoint with cache metrics.
 * GET /health
 */
export async function handleHealth(req, res) {
  const uptime = process.uptime();
  const memory = process.memoryUsage();

  json(res, 200, {
    ok: true,
    uptime: Math.floor(uptime),
    memory: {
      rss: `${(memory.rss / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(memory.heapTotal / 1024 / 1024).toFixed(2)} MB`
    },
    cache: {
      streams: streamResultCache.stats(),
      cinemeta: cinemetaCache.stats(),
      tmdb: tmdbCache.stats(),
      animeDetection: animeDetectionCache.stats()
    },
    circuits: getCircuitStatus(),
    rateLimiter: rateLimiter.getStats(),
    providers: getProviderHealthSnapshot()
  });
  return true;
}

function getProviderHealthSnapshot() {
  const circuitStatus = getCircuitStatus();
  const providers = {};

  // General providers
  const generalProviders = [
    "lacartoons", "gnula", "cinecalidad", "netmirror", "castle",
    "cuevana", "homecine", "tioplus", "mhdflix", "seriesmetro",
    "verseriesonline", "cineplus123", "lamovie", "serieskao"
  ];

  for (const id of generalProviders) {
    const circuit = circuitStatus[`provider:${id}`] || { state: "CLOSED", failures: 0 };
    providers[id] = {
      type: "general",
      circuit: circuit.state,
      failures: circuit.failures,
      status: circuit.state === "CLOSED" ? "available" : circuit.reason || "open"
    };
  }

  // Anime providers
  const animeProviders = ["animeflv", "animeav1", "henaojara", "tioanime"];
  for (const id of animeProviders) {
    const circuit = circuitStatus[`provider:${id}`] || { state: "CLOSED", failures: 0 };
    providers[id] = {
      type: "anime",
      circuit: circuit.state,
      failures: circuit.failures,
      status: circuit.state === "CLOSED" ? "available" : circuit.reason || "open"
    };
  }

  return providers;
}
