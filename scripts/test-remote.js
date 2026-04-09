import assert from "node:assert/strict";

function getBaseUrl() {
  const raw = String(process.env.TEST_BASE_URL || process.env.ADDON_URL || "").trim();
  if (!raw) {
    throw new Error("Define TEST_BASE_URL o ADDON_URL para ejecutar el test remoto");
  }

  return raw.replace(/\/$/, "");
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();

  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status}: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }

  return payload;
}

async function main() {
  const baseUrl = getBaseUrl();

  const health = await fetchJson(`${baseUrl}/`);
  const manifest = await fetchJson(`${baseUrl}/manifest.json`);
  const movie = await fetchJson(`${baseUrl}/_debug/stream/movie/tt0133093.json`);
  const anime = await fetchJson(`${baseUrl}/_debug/stream/series/tt0388629:1:1.json`);

  assert.equal(health.ok, true);
  assert.equal(health.name, "Cinepick");
  assert.equal(manifest.name, "Cinepick");
  assert.deepEqual(manifest.resources, ["meta", "stream"]);
  assert.equal(movie.mode, "external");
  assert.equal(anime.mode, "anime");

  console.log(JSON.stringify({
    baseUrl,
    health: {
      ok: health.ok,
      name: health.name,
      version: health.version || null
    },
    manifest: {
      resources: manifest.resources,
      types: manifest.types
    },
    movie: {
      mode: movie.mode
    },
    anime: {
      mode: anime.mode,
      combinedStreamCount: anime.combinedStreamCount ?? null
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(`Remote test failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
