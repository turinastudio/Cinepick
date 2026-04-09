import assert from "node:assert/strict";
import { spawn } from "node:child_process";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForServer(baseUrl, attempts = 30, delayMs = 1000) {
  let lastError = null;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await fetchJson(`${baseUrl}/`);
    } catch (error) {
      lastError = error;
      await delay(delayMs);
    }
  }

  throw lastError || new Error(`No se pudo levantar el server en ${baseUrl}`);
}

function killTree(pid) {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore"
    });

    killer.on("exit", () => resolve());
    killer.on("error", () => resolve());
  });
}

async function runImportSmoke() {
  const engines = await import("../src/engines/index.js");
  const animeCompat = await import("../src/anime/index.js");
  const providersCompat = await import("../src/providers/index.js");

  assert.equal(typeof engines.generalEngine.resolveMeta, "function");
  assert.equal(typeof engines.generalEngine.resolveStreams, "function");
  assert.equal(typeof engines.generalEngine.resolveDebug, "function");
  assert.equal(typeof engines.animeEngine.resolveMeta, "function");
  assert.equal(typeof engines.animeEngine.resolveStreams, "function");
  assert.equal(typeof engines.animeEngine.resolveDebug, "function");
  assert.equal(typeof engines.animeEngine.resolveProviderSearchDebug, "function");
  assert.equal(typeof animeCompat.resolveMeta, "function");
  assert.equal(typeof providersCompat.resolveStreamsFromExternalId, "function");
}

async function runServerWrapperSmoke() {
  const port = "3015";
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["-e", "import('./src/server.js')"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: port,
      ADDON_URL: baseUrl
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const health = await waitForServer(baseUrl);
    assert.equal(health.ok, true);
    assert.equal(health.name, "Cinepick");
  } finally {
    await killTree(child.pid);
  }
}

async function runServerSmoke() {
  const port = "3014";
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/app/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: port,
      ADDON_URL: baseUrl,
      ENABLE_ANIME_ENGINE: "true",
      ANIME_ENGINE_DEBUG: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const health = await waitForServer(baseUrl);
    const movie = await fetchJson(`${baseUrl}/_debug/stream/movie/tt0133093.json`);
    const movieAlt = await fetchJson(`${baseUrl}/_debug/stream/movie/tt26443597.json`);
    const series = await fetchJson(`${baseUrl}/_debug/stream/series/tt0903747:1:1.json`);
    const seriesAlt = await fetchJson(`${baseUrl}/_debug/stream/series/tt0944947:1:1.json`);
    const animeOnePiece = await fetchJson(`${baseUrl}/_debug/stream/series/tt0388629:1:1.json`);
    const animeBunny = await fetchJson(`${baseUrl}/_debug/stream/series/tt8993398:1:1.json`);

    assert.equal(health.ok, true);
    assert.equal(health.name, "Cinepick");
    assert.equal(movie.mode, "external");
    assert.equal(movieAlt.mode, "external");
    assert.equal(series.mode, "external");
    assert.equal(seriesAlt.mode, "external");
    assert.equal(animeOnePiece.mode, "anime");
    assert.ok(Number(animeOnePiece.combinedStreamCount || 0) > 0);
    assert.equal(animeBunny.mode, "anime");
    assert.ok(Number(animeBunny.combinedStreamCount || 0) > 0);

    console.log("Smoke imports: OK");
    console.log("Smoke server: OK");
    console.log(`Server stdout: ${stdout.trim()}`);
    if (stderr.trim()) {
      console.log(`Server stderr: ${stderr.trim()}`);
    }
  } finally {
    await killTree(child.pid);
  }
}

async function main() {
  await runImportSmoke();
  await runServerWrapperSmoke();
  await runServerSmoke();
}

main().catch((error) => {
  console.error(`Smoke tests failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
