import {
  debugProviderStreamsFromExternalId,
  debugStreamsFromExternalId,
  getProviderById,
  resolveProviderFromMetaId,
  resolveStreamsFromExternalId
} from "./providers/core.js";

export function getGeneralEngineIdPrefixes() {
  return [];
}

export function isGeneralInternalId(type, id) {
  const resolved = resolveProviderFromMetaId(id);
  return Boolean(resolved && resolved.type === type);
}

export function resolveGeneralMetaTarget(type, id) {
  const resolved = resolveProviderFromMetaId(id);
  if (!resolved || resolved.type !== type) {
    return null;
  }

  return resolved;
}

export async function resolveGeneralMeta(type, id) {
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

export async function resolveGeneralStreams(type, id) {
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

export async function resolveGeneralDebug(type, id) {
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

export async function resolveGeneralProviderDebug(providerId, type, id) {
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
  if (resolved && resolved.provider.id === providerId) {
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

export function getGeneralProviderById(providerId) {
  return getProviderById(providerId);
}
