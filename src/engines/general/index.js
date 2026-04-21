import {
  debugProviderStreamsFromExternalId,
  debugStreamsFromExternalId,
  getProviderById as getProviderByIdInternal,
  resolveProviderFromMetaId,
  resolveStreamsFromExternalId
} from "./providers/core.js";

function getGeneralEngineIdPrefixes() {
  return [];
}

export function getIdPrefixes() {
  return getGeneralEngineIdPrefixes();
}

function isGeneralInternalId(type, id) {
  const resolved = resolveProviderFromMetaId(id);
  return Boolean(resolved?.type === type);
}

export function isProviderId(providerId) {
  return Boolean(getProviderByIdInternal(providerId));
}

function resolveGeneralMetaTarget(type, id) {
  const resolved = resolveProviderFromMetaId(id);
  if (!resolved || resolved.type !== type) {
    return null;
  }

  return resolved;
}

export async function resolveMeta(type, id) {
  const resolved = resolveGeneralMetaTarget(type, id);
  if (!resolved) {
    return { mode: "unhandled", meta: null };
  }

  const meta = await resolved.provider.getMeta({
    type: resolved.type,
    slug: resolved.slug
  });

  return {
    mode: "internal",
    providerId: resolved.provider.id,
    meta
  };
}

export async function resolveStreams(type, id) {
  const resolved = resolveGeneralMetaTarget(type, id);

  if (!resolved) {
    const streams = await resolveStreamsFromExternalId(type, id);
    return {
      mode: "external",
      streams
    };
  }

  const streams = await resolved.provider.getStreams({
    type: resolved.type,
    slug: resolved.slug
  });

  return {
    mode: "internal",
    providerId: resolved.provider.id,
    streams
  };
}

export async function resolveCatalog(type, catalogId, extra = {}) {
  const providerId = String(catalogId || "").split("|")[0] || "";
  if (!providerId) {
    return { mode: "unhandled", metas: [] };
  }

  const provider = getProviderByIdInternal(providerId);
  if (!provider) {
    return { mode: "disabled", providerId, metas: [] };
  }

  if (typeof provider.getCatalogItems !== "function") {
    return { mode: "unhandled", providerId, metas: [] };
  }

  const metas = await provider.getCatalogItems({
    type,
    catalogId,
    extra
  });

  return {
    mode: "internal",
    providerId: provider.id,
    metas: Array.isArray(metas) ? metas : []
  };
}

export async function resolveDebug(type, id) {
  const resolved = resolveGeneralMetaTarget(type, id);

  if (resolved) {
    const debug = await resolved.provider.debugInternalStreams({
      type: resolved.type,
      slug: resolved.slug
    });

    return {
      mode: "internal",
      providerId: resolved.provider.id,
      type: resolved.type,
      slug: resolved.slug,
      debug: debug || null
    };
  }

  const debug = await debugStreamsFromExternalId(type, id);
  return {
    mode: "external",
    debug
  };
}

export async function resolveProviderDebug(providerId, type, id) {
  const provider = getProviderById(providerId);
  if (!provider) {
    return {
      provider: providerId,
      type,
      externalId: id,
      status: "provider_not_found"
    };
  }

  const resolved = resolveGeneralMetaTarget(type, id);
  if (resolved?.provider?.id === providerId) {
    const providerDebug = await provider.debugInternalStreams({
      type: resolved.type,
      slug: resolved.slug
    });

    return {
      mode: "internal",
      provider: provider.id,
      type: resolved.type,
      slug: resolved.slug,
      ...(providerDebug || {})
    };
  }

  return debugProviderStreamsFromExternalId(providerId, type, id);
}

export function getProviderById(providerId) {
  return getProviderByIdInternal(providerId);
}

// Deprecated aliases kept for compatibility with older imports.
export { getGeneralEngineIdPrefixes };
export { isGeneralInternalId };
export { resolveGeneralMetaTarget };
export { resolveMeta as resolveGeneralMeta };
export { resolveStreams as resolveGeneralStreams };
export { resolveCatalog as resolveGeneralCatalog };
export { resolveDebug as resolveGeneralDebug };
export { resolveProviderDebug as resolveGeneralProviderDebug };

export function getGeneralProviderById(providerId) {
  return getProviderByIdInternal(providerId);
}
