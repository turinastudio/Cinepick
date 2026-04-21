import fs from "node:fs";
import path from "node:path";

const RUNTIME_DATA_DIR = path.resolve(process.cwd(), "runtime", "data");
const LEGACY_DATA_DIR = path.resolve(process.cwd(), "data");
const PENALTY_FILE = path.join(RUNTIME_DATA_DIR, "source-penalties.json");
const LEGACY_PENALTY_FILE = path.join(LEGACY_DATA_DIR, "source-penalties.json");

const PENALTY_PER_FAILURE = 15;
const RECOVERY_PER_SUCCESS = 10;
const MAX_PENALTY = 120;
const PERSIST_DEBOUNCE_MS = 1000;

const sourcePenalties = new Map();
let loaded = false;
let persistTimer = null;

function ensureLoaded() {
  if (loaded) {
    return;
  }

  loaded = true;

  try {
    if (!fs.existsSync(RUNTIME_DATA_DIR)) {
      fs.mkdirSync(RUNTIME_DATA_DIR, { recursive: true });
    }

    const sourceFile = fs.existsSync(PENALTY_FILE)
      ? PENALTY_FILE
      : (fs.existsSync(LEGACY_PENALTY_FILE) ? LEGACY_PENALTY_FILE : "");
    if (!sourceFile) {
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
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
  // Debounce: cancel previous timer, schedule new write
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(RUNTIME_DATA_DIR)) {
        fs.mkdirSync(RUNTIME_DATA_DIR, { recursive: true });
      }

      fs.writeFileSync(
        PENALTY_FILE,
        JSON.stringify(Object.fromEntries(sourcePenalties.entries()), null, 2),
        "utf8"
      );
    } catch {
      // Persistence failures should not break stream resolution.
    }
    persistTimer = null;
  }, PERSIST_DEBOUNCE_MS);

  // Don't keep process alive just for persistence
  if (persistTimer.unref) persistTimer.unref();
}

function normalizeKey(key) {
  return String(key ?? "").trim().toLowerCase();
}

export function markSourceFailure(key) {
  ensureLoaded();
  const normalized = normalizeKey(key);

  if (!normalized) {
    return;
  }

  const nextPenalty = Math.min(
    MAX_PENALTY,
    (sourcePenalties.get(normalized) ?? 0) + PENALTY_PER_FAILURE
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

  const current = sourcePenalties.get(normalized) ?? 0;
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
  return sourcePenalties.get(normalizeKey(key)) ?? 0;
}

export function getPenaltySnapshot() {
  ensureLoaded();
  return Object.fromEntries(sourcePenalties.entries());
}
