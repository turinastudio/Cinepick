/**
 * CinePick Stremio Addon - Refactored Server
 *
 * Architecture:
 * - server.js: HTTP server + routing orchestration
 * - routers/: Route handlers grouped by responsibility
 * - middleware/: Cross-cutting concerns (error handling, etc.)
 * - errors.js: Custom error types
 */

import crypto from "node:crypto";
import http from "node:http";
import { manifest } from "./manifest.js";
import {
  animeEngine,
  generalEngine
} from "../engines/index.js";
import { json, notFound } from "../lib/http.js";
import { createDebugLogger } from "../shared/debug.js";
import { resolveConfiguredPath, buildConfigureState, hashAddonConfig } from "../config/addon-config.js";
import { runWithRequestConfig } from "../config/request-context.cjs";
import { errorHandler } from "./middleware/error-handler.js";
import {
  handleRoot,
  handleManifest,
  handleLogo,
  handleConfigureIndex,
  handleConfigureApp,
  handleConfigureStyles,
  handleConfigureState,
  handleHealth
} from "./routers/main-router.js";
import {
  handleMeta,
  handleStream,
  handleCatalog,
  handleDebug,
  handleProviderDebug,
  handleAnimeSearchDebug
} from "./routers/stream-router.js";
import { handleProxy } from "./routers/proxy-router.js";

// ── Configuration ──────────────────────────────────────────────
const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10) || 3000;
const addonUrlOverride = String(process.env.ADDON_URL || "").trim().replace(/\/$/, "");
const animeEngineEnabled = !/^(0|false|no)$/i.test(String(process.env.ENABLE_ANIME_ENGINE || "true").trim());
const animeDebugLog = createDebugLogger("anime-engine", () =>
  /^(1|true|yes)$/i.test(String(process.env.ANIME_ENGINE_DEBUG || "").trim())
);

// ── Request helpers ────────────────────────────────────────────
function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
}

function normalizeAddonPath(pathname) {
  if (pathname === "/alt" || pathname.startsWith("/alt/")) {
    const normalized = pathname.slice("/alt".length) || "/";
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }
  return pathname;
}

function getRequestOrigin(req) {
  if (addonUrlOverride) {
    return addonUrlOverride;
  }
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || "http";
  const reqHost = req.headers.host || `${host}:${port}`;
  return `${proto}://${reqHost}`;
}

function buildManifest(req, requestConfig, basePathPrefix = "") {
  const origin = getRequestOrigin(req);
  const animeEnabled = Boolean(requestConfig?.engines?.anime) && animeEngineEnabled;
  const generalEnabled = Boolean(requestConfig?.engines?.general);
  const basePrefixes = (manifest.idPrefixes || []).filter((prefix) => {
    if (prefix === "tt") {
      return animeEnabled || generalEnabled;
    }
    if (!prefix.endsWith(":")) {
      return true;
    }
    const providerId = prefix.slice(0, -1);
    if (["animeflv", "animeav1", "henaojara"].includes(providerId)) {
      return animeEnabled ? requestConfig?.providers?.anime?.[providerId] !== false : false;
    }
    return generalEnabled
      ? requestConfig?.providers?.general?.[providerId] !== false
      : false;
  });
  const animeIdPrefixes = animeEnabled ? animeEngine.getIdPrefixes() : [];
  const manifestId = basePathPrefix
    ? `${manifest.id}.${hashAddonConfig(requestConfig)}`
    : manifest.id;
  return {
    ...manifest,
    id: manifestId,
    catalogs: animeEnabled ? manifest.catalogs : [],
    idPrefixes: [...new Set([...basePrefixes, ...animeIdPrefixes])],
    logo: `${origin}${basePathPrefix}/logo.png`
  };
}

// ── Manifest builder context (passed to routers) ───────────────
function createManifestBuilder(req, requestConfig, basePathPrefix) {
  return {
    requestConfig,
    basePathPrefix,
    buildManifest: (r, cfg, prefix) => buildManifest(r, cfg || requestConfig, prefix || basePathPrefix),
    getRequestOrigin: () => getRequestOrigin(req),
    buildConfigureState: (origin, cfg) => buildConfigureState(origin || getRequestOrigin(req), cfg || requestConfig)
  };
}

// ── Route dispatchers ──────────────────────────────────────────

async function dispatchMain(req, res, manifestBuilder) {
  const pathname = req.normalizedPathname;

  if (pathname === "/") {
    return handleRoot(req, res, manifestBuilder);
  }
  if (pathname === "/health") {
    return handleHealth(req, res);
  }
  if (pathname === "/manifest.json") {
    return handleManifest(req, res, manifestBuilder);
  }
  if (pathname === "/logo.png") {
    return handleLogo(req, res);
  }
  if (pathname === "/configure") {
    return handleConfigureIndex(req, res);
  }
  if (pathname === "/configure/app.js") {
    return handleConfigureApp(req, res);
  }
  if (pathname === "/configure/styles.css") {
    return handleConfigureStyles(req, res);
  }
  if (pathname === "/configure/state.json") {
    return handleConfigureState(req, res, manifestBuilder);
  }

  return false; // Not handled
}

async function dispatchStream(req, res, manifestBuilder) {
  const context = {
    requestConfig: manifestBuilder.requestConfig,
    animeEngineEnabled,
    getRequestOrigin: () => manifestBuilder.getRequestOrigin()
  };

  // Try meta route
  if (await handleMeta(req, res, context)) return true;

  // Try stream route
  if (await handleStream(req, res, context)) return true;

  // Try catalog route
  if (await handleCatalog(req, res, context)) return true;

  // Try debug routes
  if (await handleDebug(req, res, context)) return true;
  if (await handleProviderDebug(req, res, context)) return true;
  if (await handleAnimeSearchDebug(req, res, context)) return true;

  return false;
}

// ── HTTP Server ────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (!req.url) {
    notFound(res);
    return;
  }

  // Parse and normalize (synchronous, outside AsyncLocalStorage)
  const url = parseUrl(req);
  const originPathname = normalizeAddonPath(url.pathname);
  const resolvedPath = resolveConfiguredPath(originPathname);

  // Generate trace ID for request correlation
  const traceId = crypto.randomBytes(4).toString("hex");
  req.traceId = traceId;

  // Attach parsed data to request for routers
  req.normalizedPathname = resolvedPath.pathname;
  req.searchParams = url.searchParams;
  req.parsedUrl = url;

  // Wrap all request handling in AsyncLocalStorage so engines
  // can access the decoded config via request-context.cjs
  return runWithRequestConfig(
    {
      config: resolvedPath.config,
      token: resolvedPath.token,
      basePathPrefix: resolvedPath.basePathPrefix,
      traceId
    },
    async () => {
      try {
        const manifestBuilder = createManifestBuilder(req, resolvedPath.config, resolvedPath.basePathPrefix);

        // Route: main (/, /manifest, /logo, /configure)
        if (await dispatchMain(req, res, manifestBuilder)) return;

        // Route: stream (/stream, /meta, /catalog, /_debug)
        if (await dispatchStream(req, res, manifestBuilder)) return;

        // Route: proxy (/p/*)
        if (await handleProxy(req, res)) return;

        // No match
        notFound(res);
      } catch (error) {
        errorHandler(error, res, req);
      }
    }
  );
});

// ── Start server ───────────────────────────────────────────────
server.listen(port, host, () => {
  console.log(`Addon disponible en http://${host}:${port}/manifest.json`);
});

// ── Graceful shutdown ──────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  server.close((err) => {
    if (err) {
      console.error("Error during shutdown:", err.message);
      process.exit(1);
    }
    console.log("Server closed. Exiting.");
    process.exit(0);
  });

  // Force exit after 10s if connections don't close
  setTimeout(() => {
    console.error("Forced exit after timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
