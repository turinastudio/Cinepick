import assert from "node:assert/strict";
import { animeEngine, generalEngine } from "../src/engines/index.js";

const REGRESSION_TIMEOUT_MS = 120000;

const CASES = [
  {
    id: "general-cinecalidad-fight-club",
    providerId: "cinecalidad",
    type: "movie",
    externalId: "tt0137523",
    minStreamCount: 1
  },
  {
    id: "general-gnula-matrix",
    providerId: "gnula",
    type: "movie",
    externalId: "tt0133093",
    minStreamCount: 1
  },
  {
    id: "anime-animeflv-one-piece",
    providerId: "animeflv",
    type: "series",
    externalId: "tt0388629:1:1",
    minStreamCount: 1
  },
  {
    id: "anime-animeav1-one-piece",
    providerId: "animeav1",
    type: "series",
    externalId: "tt0388629:1:1",
    minStreamCount: 1
  }
];

function getEngine(providerId) {
  if (animeEngine.isProviderId(providerId)) {
    return animeEngine;
  }

  return generalEngine;
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutHandle = null;

  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`${label} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    })
  ]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}

function extractSummary(result) {
  return {
    status: result?.status || result?.mode || "unknown",
    streamCount: Number(result?.streamCount || result?.streams?.length || 0),
    candidate: result?.candidate?.slug || result?.candidate?.id || null,
    error: result?.error || null
  };
}

async function runCase(testCase) {
  const engine = getEngine(testCase.providerId);
  let result;

  if (engine === generalEngine) {
    const provider = generalEngine.getProviderById(testCase.providerId);
    const streams = await withTimeout(
      provider.getStreamsFromExternalId({
        type: testCase.type,
        externalId: testCase.externalId
      }),
      REGRESSION_TIMEOUT_MS,
      testCase.id
    );

    result = {
      status: "ok",
      streamCount: Array.isArray(streams) ? streams.length : 0,
      streams: Array.isArray(streams) ? streams : []
    };
  } else {
    result = await withTimeout(
      engine.resolveProviderDebug(
        testCase.providerId,
        testCase.type,
        testCase.externalId
      ),
      REGRESSION_TIMEOUT_MS,
      testCase.id
    );
  }

  const summary = extractSummary(result);
  assert.equal(
    summary.status,
    "ok",
    `${testCase.id}: status inesperado (${summary.status}${summary.error ? ` - ${summary.error}` : ""})`
  );
  assert.ok(
    summary.streamCount >= testCase.minStreamCount,
    `${testCase.id}: streamCount ${summary.streamCount} < ${testCase.minStreamCount}`
  );

  return {
    id: testCase.id,
    providerId: testCase.providerId,
    type: testCase.type,
    externalId: testCase.externalId,
    ...summary
  };
}

async function main() {
  const results = [];

  for (const testCase of CASES) {
    const result = await runCase(testCase);
    results.push(result);
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(`Regression test failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
