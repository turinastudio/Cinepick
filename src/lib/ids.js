export function buildStremioId(providerId, type, slug) {
  return `${providerId}:${type}:${slug}`;
}

export function parseStremioId(id) {
  const [providerId, type, ...rest] = id.split(":");

  if (!providerId || !type || rest.length === 0) {
    return null;
  }

  return {
    providerId,
    type,
    slug: rest.join(":")
  };
}
