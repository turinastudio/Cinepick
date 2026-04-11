const { AsyncLocalStorage } = require("node:async_hooks");
const { resolveExtractorId } = require("./extractor-catalog.cjs");

const requestConfigStorage = new AsyncLocalStorage();

const FALLBACK_CONFIG = {
  version: 1,
  preset: "recommended",
  engines: {
    general: true,
    anime: true
  },
  providers: {
    general: {},
    anime: {}
  },
  extractors: {
    enabled: {}
  },
  selection: {
    mode: process.env.DEFAULT_SELECTION_MODE || "global",
    maxResults: parseInt(process.env.DEFAULT_MAX_RESULTS, 10) || 2,
    internalOnly: process.env.DEFAULT_INTERNAL_ONLY !== "false"
  },
  support: {
    showSupportStream: true
  }
};

function runWithRequestConfig(state, callback) {
  return requestConfigStorage.run(state, callback);
}

function getRequestState() {
  return requestConfigStorage.getStore() || {
    config: FALLBACK_CONFIG,
    token: null,
    basePathPrefix: ""
  };
}

function getRequestConfig() {
  return getRequestState().config || FALLBACK_CONFIG;
}

function getRequestConfigToken() {
  return getRequestState().token || null;
}

function getRequestBasePathPrefix() {
  return getRequestState().basePathPrefix || "";
}

function isEngineEnabled(engineId) {
  const config = getRequestConfig();
  return Boolean(config?.engines?.[engineId] ?? (engineId === "general"));
}

function isProviderEnabled(engineId, providerId) {
  const config = getRequestConfig();
  const section = config?.providers?.[engineId] || {};
  if (typeof section[providerId] === "boolean") {
    return section[providerId];
  }

  return true;
}

function isExtractorEnabled(value) {
  const extractorId = resolveExtractorId(value);
  if (!extractorId) {
    return true;
  }

  const config = getRequestConfig();
  const enabledMap = config?.extractors?.enabled || {};
  if (typeof enabledMap[extractorId] === "boolean") {
    return enabledMap[extractorId];
  }

  return true;
}

function getSelectionMode(defaultValue = "global") {
  const config = getRequestConfig();
  return String(config?.selection?.mode || defaultValue).trim().toLowerCase();
}

function getSelectionMaxResults(defaultValue = 2) {
  const config = getRequestConfig();
  const value = Number.parseInt(config?.selection?.maxResults, 10);
  return Number.isInteger(value) && value > 0 ? value : defaultValue;
}

function isInternalOnlyEnabled(defaultValue = true) {
  const config = getRequestConfig();
  if (typeof config?.selection?.internalOnly === "boolean") {
    return config.selection.internalOnly;
  }

  return defaultValue;
}

function shouldShowSupportStream(defaultValue = true) {
  const config = getRequestConfig();
  if (typeof config?.support?.showSupportStream === "boolean") {
    return config.support.showSupportStream;
  }

  return defaultValue;
}

module.exports = {
  getRequestBasePathPrefix,
  getRequestConfig,
  getRequestConfigToken,
  getSelectionMaxResults,
  getSelectionMode,
  isEngineEnabled,
  isExtractorEnabled,
  isInternalOnlyEnabled,
  isProviderEnabled,
  runWithRequestConfig,
  shouldShowSupportStream
};
