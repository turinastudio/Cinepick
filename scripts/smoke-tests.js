import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { encodeAddonConfig } from "../src/config/addon-config.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, { signal: controller.signal });
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
  } finally {
    clearTimeout(timeout);
  }
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
  const addonConfig = await import("../src/config/addon-config.js");

  assert.equal(typeof engines.generalEngine.resolveMeta, "function");
  assert.equal(typeof engines.generalEngine.resolveStreams, "function");
  assert.equal(typeof engines.generalEngine.resolveDebug, "function");
  assert.equal(typeof engines.animeEngine.resolveMeta, "function");
  assert.equal(typeof engines.animeEngine.resolveStreams, "function");
  assert.equal(typeof engines.animeEngine.resolveDebug, "function");
  assert.equal(typeof engines.animeEngine.resolveProviderSearchDebug, "function");
  assert.equal(typeof animeCompat.resolveMeta, "function");
  assert.equal(typeof providersCompat.resolveStreamsFromExternalId, "function");
  assert.equal(typeof addonConfig.encodeAddonConfig, "function");
  assert.equal(typeof addonConfig.decodeAddonConfig, "function");
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
    console.log("STDOUT:", chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    console.error("STDERR:", chunk.toString());
  });

  try {
    console.log("Waiting for server...");
    const health = await waitForServer(baseUrl);
    console.log("Server healthy, testing /configure...");
    const configure = await fetch(`${baseUrl}/configure`);
    console.log("Testing /configure/state.json...");
    const configureState = await fetchJson(`${baseUrl}/configure/state.json`);
    console.log("Testing movie tt0133093...");
    const movie = await fetchJson(`${baseUrl}/_debug/stream/movie/tt0133093.json`);
    console.log("Testing movie tt26443597...");
    const movieAlt = await fetchJson(`${baseUrl}/_debug/stream/movie/tt26443597.json`);
    console.log("Testing series tt0903747...");
    const series = await fetchJson(`${baseUrl}/_debug/stream/series/tt0903747:1:1.json`);
    console.log("Testing series tt0944947...");
    const seriesAlt = await fetchJson(`${baseUrl}/_debug/stream/series/tt0944947:1:1.json`);
    console.log("Testing series tt0388629...");
    const animeOnePiece = await fetchJson(`${baseUrl}/_debug/stream/series/tt0388629:1:1.json`);
    console.log("Testing series tt8993398...");
    const animeBunny = await fetchJson(`${baseUrl}/_debug/stream/series/tt8993398:1:1.json`);
    console.log("Testing token encoded...");
    const configuredAnimeOffToken = encodeAddonConfig({
      ...configureState.defaultConfig,
      engines: {
        ...configureState.defaultConfig.engines,
        anime: false
      }
    });
    const configuredAnimeOffManifest = await fetchJson(`${baseUrl}/c/${configuredAnimeOffToken}/manifest.json`);
    const configuredAnimeOffDebug = await fetchJson(`${baseUrl}/c/${configuredAnimeOffToken}/_debug/stream/series/tt0388629:1:1.json`);

    assert.equal(health.ok, true);
    assert.equal(health.name, "Cinepick");
    assert.equal(configure.ok, true);
    assert.ok(configureState.manifestUrl.includes("/c/"));
    assert.equal(movie.mode, "external");
    assert.equal(movieAlt.mode, "external");
    assert.equal(series.mode, "external");
    assert.equal(seriesAlt.mode, "external");
    assert.equal(animeOnePiece.mode, "anime");
    assert.ok(Number(animeOnePiece.combinedStreamCount || 0) > 0);
    assert.equal(animeBunny.mode, "anime");
    assert.ok(Number(animeBunny.combinedStreamCount || 0) > 0);
    assert.ok(!configuredAnimeOffManifest.idPrefixes.includes("animeflv:"), "manifest configurado sin anime no debe incluir id prefixes anime");
    assert.notEqual(configuredAnimeOffManifest.id, "com.stremio.web.scraper", "manifest configurado debe distinguirse del base");
    assert.notEqual(configuredAnimeOffDebug.mode, "anime", "debug configurado con anime apagado no debe rutear por anime");

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
