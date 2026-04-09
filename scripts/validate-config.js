import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { manifest } from "../src/app/manifest.js";

const ROOT = process.cwd();

const REQUIRED_RENDER_ENV_KEYS = [
  "NODE_ENV",
  "ADDON_URL",
  "STREAM_SELECTION_MODE",
  "STREAM_MAX_RESULTS",
  "SHOW_SUPPORT_STREAM",
  "SUPPORT_URL",
  "PROVIDER_TIMEOUT_MS",
  "PROVIDER_DEBUG_TIMEOUT_MS",
  "EXTRACTOR_TIMEOUT_MS",
  "EXTRACTOR_CANDIDATE_TIMEOUT_MS",
  "WEBSTREAM_HTTP_RETRIES",
  "TMDB_API_KEY",
  "ENABLE_ANIME_ENGINE",
  "ANIME_ENGINE_DEBUG",
  "GNULA_BASE_URL",
  "CINECALIDAD_BASE_URL",
  "NETMIRROR_BASE_URL",
  "NETMIRROR_PLAY_URL",
  "CASTLE_BASE_URL",
  "CUEVANA_BASE_URL",
  "HOMECINE_BASE_URL",
  "TIOPLUS_BASE_URL",
  "MHDFLIX_BASE_URL",
  "MHDFLIX_API_URL",
  "LAMOVIE_BASE_URL",
  "SERIESMETRO_BASE_URL",
  "VERSERIESONLINE_BASE_URL",
  "CINEPLUS123_BASE_URL",
  "SERIESKAO_BASE_URL",
  "ANIMEAV1_BASE_URL",
  "ANIMEFLV_BASE_URL",
  "HENAOJARA_BASE_URL",
  "LACARTOONS_BASE_URL"
];

const FORBIDDEN_RENDER_ENV_KEYS = [
  "VERHDLINK_BASE_URL",
  "CINEHDPLUS_BASE_URL"
];

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function extractRenderEnvKeys(renderYaml) {
  return [...renderYaml.matchAll(/^\s*-\s+key:\s+([A-Z0-9_]+)\s*$/gm)].map((match) => match[1]);
}

function validateRender() {
  const renderYaml = readFile("render.yaml");
  const keys = extractRenderEnvKeys(renderYaml);

  assert.ok(renderYaml.includes("startCommand: npm start"), "render.yaml debe usar npm start");
  assert.ok(renderYaml.includes("healthCheckPath: /"), "render.yaml debe definir healthCheckPath /");

  for (const key of REQUIRED_RENDER_ENV_KEYS) {
    assert.ok(keys.includes(key), `render.yaml debe incluir ${key}`);
  }

  for (const key of FORBIDDEN_RENDER_ENV_KEYS) {
    assert.ok(!keys.includes(key), `render.yaml no debe incluir ${key}`);
  }

  return {
    envKeyCount: keys.length
  };
}

function validateRailway() {
  const railway = JSON.parse(readFile("railway.json"));

  assert.equal(railway?.build?.builder, "NIXPACKS", "railway.json debe usar NIXPACKS");
  assert.equal(railway?.deploy?.startCommand, "npm start", "railway.json debe usar npm start");
  assert.equal(railway?.deploy?.healthcheckPath, "/", "railway.json debe usar / como healthcheck");

  return {
    startCommand: railway.deploy.startCommand,
    healthcheckPath: railway.deploy.healthcheckPath
  };
}

function validateManifest() {
  assert.equal(manifest.name, "Cinepick", "manifest.name debe ser Cinepick");
  assert.deepEqual(manifest.resources, ["meta", "stream"], "manifest.resources debe exponer solo meta y stream");
  assert.deepEqual(manifest.types, ["movie", "series"], "manifest.types debe ser movie/series");
  assert.ok(Array.isArray(manifest.catalogs) && manifest.catalogs.length === 0, "manifest.catalogs debe estar vacio");
  assert.ok(manifest.idPrefixes.includes("tt"), "manifest.idPrefixes debe incluir tt");
  assert.ok(!manifest.idPrefixes.includes("animeflv:"), "manifest base no debe publicar animeflv sin flag");
  assert.ok(!manifest.idPrefixes.includes("animeav1:"), "manifest base no debe publicar animeav1 sin flag");
  assert.ok(!manifest.idPrefixes.includes("henaojara:"), "manifest base no debe publicar henaojara sin flag");

  return {
    resourceCount: manifest.resources.length,
    typeCount: manifest.types.length,
    idPrefixCount: manifest.idPrefixes.length
  };
}

function main() {
  const render = validateRender();
  const railway = validateRailway();
  const manifestState = validateManifest();

  console.log(JSON.stringify({
    render,
    railway,
    manifest: manifestState
  }, null, 2));
}

main();
