import crypto from "node:crypto";
import { manifest } from "./manifest.js";
import {
  animeEngine,
  generalEngine
} from "../engines/index.js";
import { notFound } from "../lib/http.js";
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

const addonUrlOverride = String(process.env.ADDON_URL || "").trim().replace(/\/$/, "");
const animeEngineEnabled = !/^(0|false|no)$/i.test(String(process.env.ENABLE_ANIME_ENGINE || "true").trim());
createDebugLogger("anime-engine", () =>
  /^(1|true|yes)$/i.test(String(process.env.ANIME_ENGINE_DEBUG || "").trim())
);

function parseUrl(req, { host = "0.0.0.0", port = 3000 } = {}) {
  return new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
}

function normalizeAddonPath(pathname) {
  if (pathname === "/alt" || pathname.startsWith("/alt/")) {
    const normalized = pathname.slice("/alt".length) || "/";
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }
  return pathname;
}

function getRequestOrigin(req, { host = "0.0.0.0", port = 3000 } = {}) {
  if (addonUrlOverride) {
    return addonUrlOverride;
  }
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || "http";
  const reqHost = req.headers.host || `${host}:${port}`;
  return `${proto}://${reqHost}`;
}

function buildManifest(req, requestConfig, basePathPrefix = "", runtimeConfig = {}) {
  const origin = getRequestOrigin(req, runtimeConfig);
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

function createManifestBuilder(req, requestConfig, basePathPrefix, runtimeConfig) {
  return {
    requestConfig,
    basePathPrefix,
    buildManifest: (r, cfg, prefix) => buildManifest(r, cfg || requestConfig, prefix || basePathPrefix, runtimeConfig),
    getRequestOrigin: () => getRequestOrigin(req, runtimeConfig),
    buildConfigureState: (origin, cfg) => buildConfigureState(origin || getRequestOrigin(req, runtimeConfig), cfg || requestConfig)
  };
}

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

  return false;
}

async function dispatchStream(req, res, manifestBuilder) {
  const context = {
    requestConfig: manifestBuilder.requestConfig,
    animeEngineEnabled,
    getRequestOrigin: () => manifestBuilder.getRequestOrigin()
  };

  if (await handleMeta(req, res, context)) return true;
  if (await handleStream(req, res, context)) return true;
  if (await handleCatalog(req, res, context)) return true;
  if (await handleDebug(req, res, context)) return true;
  if (await handleProviderDebug(req, res, context)) return true;
  if (await handleAnimeSearchDebug(req, res, context)) return true;

  return false;
}

export async function handleAddonRequest(req, res, runtimeConfig = {}) {
  const host = runtimeConfig.host || process.env.HOST || "0.0.0.0";
  const port = runtimeConfig.port || Number.parseInt(process.env.PORT || "3000", 10) || 3000;

  if (!req.url) {
    notFound(res);
    return;
  }

  const url = parseUrl(req, { host, port });
  const originPathname = normalizeAddonPath(url.pathname);
  const resolvedPath = resolveConfiguredPath(originPathname);
  const traceId = crypto.randomBytes(4).toString("hex");

  req.traceId = traceId;
  req.normalizedPathname = resolvedPath.pathname;
  req.searchParams = url.searchParams;
  req.parsedUrl = url;

  return runWithRequestConfig(
    {
      config: resolvedPath.config,
      token: resolvedPath.token,
      basePathPrefix: resolvedPath.basePathPrefix,
      traceId
    },
    async () => {
      try {
        const manifestBuilder = createManifestBuilder(req, resolvedPath.config, resolvedPath.basePathPrefix, { host, port });

        if (await dispatchMain(req, res, manifestBuilder)) return;
        if (await dispatchStream(req, res, manifestBuilder)) return;
        if (await handleProxy(req, res)) return;

        notFound(res);
      } catch (error) {
        errorHandler(error, res, req);
      }
    }
  );
}

