import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const PENALTY_FILE = path.join(DATA_DIR, "source-penalties.json");

const PENALTY_PER_FAILURE = 15;
const RECOVERY_PER_SUCCESS = 10;
const MAX_PENALTY = 120;

const sourcePenalties = new Map();
let loaded = false;

function ensureLoaded() {
  if (loaded) {
    return;
  }

  loaded = true;

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(PENALTY_FILE)) {
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(PENALTY_FILE, "utf8"));
    for (const [key, value] of Object.entries(parsed || {})) {
      if (typeof value === "number" && value > 0) {
        sourcePenalties.set(key, Math.min(MAX_PENALTY, value));
      }
    }
  } catch {
    // Keep an empty in-memory state if the file is malformed.
  }
}

function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    fs.writeFileSync(
      PENALTY_FILE,
      JSON.stringify(Object.fromEntries(sourcePenalties.entries()), null, 2),
      "utf8"
    );
  } catch {
    // Persistence failures should not break stream resolution.
  }
}

function normalizeKey(key) {
  return String(key || "").trim().toLowerCase();
}

export function markSourceFailure(key) {
  ensureLoaded();
  const normalized = normalizeKey(key);

  if (!normalized) {
    return;
  }

  const nextPenalty = Math.min(
    MAX_PENALTY,
    (sourcePenalties.get(normalized) || 0) + PENALTY_PER_FAILURE
  );
  sourcePenalties.set(normalized, nextPenalty);
  persist();
}

export function markSourceSuccess(key) {
  ensureLoaded();
  const normalized = normalizeKey(key);

  if (!normalized) {
    return;
  }

  const current = sourcePenalties.get(normalized) || 0;
  if (current <= 0) {
    return;
  }

  const nextPenalty = Math.max(0, current - RECOVERY_PER_SUCCESS);
  if (nextPenalty === 0) {
    sourcePenalties.delete(normalized);
  } else {
    sourcePenalties.set(normalized, nextPenalty);
  }
  persist();
}

export function getPenaltyForSource(key) {
  ensureLoaded();
  return sourcePenalties.get(normalizeKey(key)) || 0;
}

export function getPenaltySnapshot() {
  ensureLoaded();
  return Object.fromEntries(sourcePenalties.entries());
}
