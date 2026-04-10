import crypto from "node:crypto";
import extractorCatalogShared from "./extractor-catalog.cjs";
import { providers as generalBaseProviders } from "../engines/general/providers/core.js";
import animeRegistryShared from "../engines/anime/runtime/providers/registry.js";

const { getExtractorDefinitions } = extractorCatalogShared;
const { providers: animeBaseProviders = [] } = animeRegistryShared;

export const CONFIG_VERSION = 1;
export const CONFIG_PATH_PREFIX = "/c";
export const DEFAULT_PRESET = "recommended";

const RECOMMENDED_EXTRACTOR_IDS = new Set([
  "mp4upload",
  "yourupload",
  "uqload",
  "pixeldrain"
]);

function asBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function getDeploymentAnimeEnabled() {
  return !/^(0|false|no)$/i.test(String(process.env.ENABLE_ANIME_ENGINE || "true").trim());
}

function getAllowedGeneralProviderIds() {
  const configured = String(
    process.env.ACTIVE_PROVIDERS ||
    process.env.ENABLED_PROVIDERS ||
    ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (configured.length === 0) {
    return new Set(generalBaseProviders.map((provider) => provider.id));
  }

  return new Set(configured);
}

function getGeneralProviderDefinitions() {
  const allowed = getAllowedGeneralProviderIds();
  return generalBaseProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    available: allowed.has(provider.id)
  }));
}

function getAnimeProviderDefinitions() {
  const enabled = getDeploymentAnimeEnabled();
  return animeBaseProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    available: enabled
  }));
}

export function getConfigCapabilities() {
  const extractors = getExtractorDefinitions().map((definition) => ({
    ...definition,
    available: true
  }));

  return {
    version: CONFIG_VERSION,
    presets: [
      {
        id: DEFAULT_PRESET,
        label: "Recomendado",
        description: "Balancea cobertura y estabilidad con una configuracion curada."
      }
    ],
    engines: [
      {
        id: "general",
        label: "Motor general",
        description: "Resuelve peliculas y series del motor principal.",
        available: true
      },
      {
        id: "anime",
        label: "Motor anime",
        description: "Resuelve anime con providers dedicados.",
        available: getDeploymentAnimeEnabled()
      }
    ],
    providers: {
      general: getGeneralProviderDefinitions(),
      anime: getAnimeProviderDefinitions()
    },
    extractors
  };
}

export function getDefaultAddonConfig() {
  const capabilities = getConfigCapabilities();
  const generalProviders = Object.fromEntries(
    capabilities.providers.general.map((provider) => [provider.id, provider.available])
  );
  const animeProviders = Object.fromEntries(
    capabilities.providers.anime.map((provider) => [provider.id, provider.available])
  );
  const extractors = Object.fromEntries(
    capabilities.extractors.map((extractor) => [
      extractor.id,
      extractor.available && RECOMMENDED_EXTRACTOR_IDS.has(extractor.id)
    ])
  );

  return {
    version: CONFIG_VERSION,
    preset: DEFAULT_PRESET,
    engines: {
      general: true,
      anime: capabilities.engines.find((engine) => engine.id === "anime")?.available || false
    },
    providers: {
      general: generalProviders,
      anime: animeProviders
    },
    extractors: {
      enabled: extractors
    },
    selection: {
      mode: "global",
      maxResults: 2,
      internalOnly: true
    },
    support: {
      showSupportStream: true
    }
  };
}

function normalizeBooleanMap(rawMap, definitions, fallbackMap) {
  const result = {};
  for (const definition of definitions) {
    const fallback = fallbackMap?.[definition.id] ?? false;
    const requested = rawMap && typeof rawMap === "object" ? rawMap[definition.id] : undefined;
    result[definition.id] = definition.available
      ? asBoolean(requested, fallback)
      : false;
  }
  return result;
}

export function normalizeAddonConfig(rawConfig = {}) {
  const defaults = getDefaultAddonConfig();
  const capabilities = getConfigCapabilities();
  const requested = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const maxResults = Number.parseInt(requested?.selection?.maxResults, 10);

  return {
    version: CONFIG_VERSION,
    preset: String(requested.preset || defaults.preset || DEFAULT_PRESET).trim() || DEFAULT_PRESET,
    engines: {
      general: capabilities.engines.find((engine) => engine.id === "general")?.available
        ? asBoolean(requested?.engines?.general, defaults.engines.general)
        : false,
      anime: capabilities.engines.find((engine) => engine.id === "anime")?.available
        ? asBoolean(requested?.engines?.anime, defaults.engines.anime)
        : false
    },
    providers: {
      general: normalizeBooleanMap(
        requested?.providers?.general,
        capabilities.providers.general,
        defaults.providers.general
      ),
      anime: normalizeBooleanMap(
        requested?.providers?.anime,
        capabilities.providers.anime,
        defaults.providers.anime
      )
    },
    extractors: {
      enabled: normalizeBooleanMap(
        requested?.extractors?.enabled,
        capabilities.extractors,
        defaults.extractors.enabled
      )
    },
    selection: {
      mode: ["global", "per_provider", "off"].includes(String(requested?.selection?.mode || "").trim().toLowerCase())
        ? String(requested.selection.mode).trim().toLowerCase()
        : defaults.selection.mode,
      maxResults: Number.isInteger(maxResults)
        ? Math.max(1, Math.min(50, maxResults))
        : defaults.selection.maxResults,
      internalOnly: asBoolean(requested?.selection?.internalOnly, defaults.selection.internalOnly)
    },
    support: {
      showSupportStream: asBoolean(requested?.support?.showSupportStream, defaults.support.showSupportStream)
    }
  };
}

export function encodeAddonConfig(config) {
  const normalized = normalizeAddonConfig(config);
  return Buffer.from(JSON.stringify(normalized)).toString("base64url");
}

export function decodeAddonConfig(encoded) {
  if (!encoded) {
    return null;
  }

  try {
    const decoded = Buffer.from(String(encoded), "base64url").toString("utf8");
    return normalizeAddonConfig(JSON.parse(decoded));
  } catch {
    return null;
  }
}

export function hashAddonConfig(config) {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(normalizeAddonConfig(config)))
    .digest("hex")
    .slice(0, 12);
}

export function buildConfigBasePath(token) {
  return token ? `${CONFIG_PATH_PREFIX}/${token}` : "";
}

export function resolveConfiguredPath(pathname) {
  const rawPathname = String(pathname || "/");
  const match = rawPathname.match(/^\/c\/([^/]+)(\/.*)?$/);

  if (!match) {
    return {
      token: null,
      basePathPrefix: "",
      pathname: rawPathname,
      config: getDefaultAddonConfig(),
      usedFallback: false
    };
  }

  const token = match[1];
  const innerPath = match[2] || "/";
  const decoded = decodeAddonConfig(token);

  return {
    token,
    basePathPrefix: buildConfigBasePath(token),
    pathname: innerPath,
    config: decoded || getDefaultAddonConfig(),
    usedFallback: !decoded
  };
}

export function buildConfigureState(origin, config) {
  const normalized = normalizeAddonConfig(config);
  const token = encodeAddonConfig(normalized);
  const basePath = buildConfigBasePath(token);

  return {
    version: CONFIG_VERSION,
    config: normalized,
    defaultConfig: getDefaultAddonConfig(),
    capabilities: getConfigCapabilities(),
    token,
    installUrl: `${origin}${basePath}/manifest.json`,
    manifestUrl: `${origin}${basePath}/manifest.json`,
    configureUrl: `${origin}/configure?config=${encodeURIComponent(token)}`
  };
}
