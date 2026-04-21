/**
 * Circuit breaker pattern for scraping sources.
 *
 * When a source (provider:extractor) fails repeatedly, it "opens" the circuit
 * to stop wasting time on broken sources. Automatically closes after a cool-down
 * period to retry.
 *
 * States:
 *   CLOSED   -> Normal operation, requests pass through
 *   OPEN     -> Source is failing, requests are rejected immediately
 *   HALF_OPEN -> Cool-down expired, one test request allowed
 */

const FAILURE_THRESHOLD = Number.parseInt(process.env.CIRCUIT_BREAKER_FAILURES || "5", 10);
const SUCCESS_THRESHOLD = 2;
const COOLDOWN_MS = Number.parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS || "300000", 10); // 5 min

/**
 * State map: sourceKey -> { failures, successes, state, lastFailure, openedAt }
 */
const circuits = new Map();

function getCircuit(sourceKey) {
  if (!circuits.has(sourceKey)) {
    circuits.set(sourceKey, {
      failures: 0,
      successes: 0,
      state: "CLOSED",
      lastFailure: 0,
      openedAt: 0
    });
  }
  return circuits.get(sourceKey);
}

/**
 * Check if a source is currently allowed to make requests.
 * @param {string} sourceKey - e.g. "gnula:doodstream"
 * @returns {{ allowed: boolean, state: string, reason?: string }}
 */
export function isSourceAllowed(sourceKey) {
  const circuit = getCircuit(sourceKey);

  if (circuit.state === "CLOSED") {
    return { allowed: true, state: "CLOSED" };
  }

  if (circuit.state === "OPEN") {
    const elapsed = Date.now() - circuit.openedAt;
    if (elapsed >= COOLDOWN_MS) {
      // Transition to HALF_OPEN — allow one test request
      circuit.state = "HALF_OPEN";
      return { allowed: true, state: "HALF_OPEN", reason: "cool-down expired" };
    }
    const remainingMs = COOLDOWN_MS - elapsed;
    return { allowed: false, state: "OPEN", reason: `circuit open, ${Math.round(remainingMs / 1000)}s remaining` };
  }

  // HALF_OPEN — allow one request
  return { allowed: true, state: "HALF_OPEN", reason: "test request" };
}

/**
 * Record a successful request for a source.
 * @param {string} sourceKey
 */
export function recordSuccess(sourceKey) {
  const circuit = getCircuit(sourceKey);
  circuit.successes++;
  circuit.failures = 0;

  if (circuit.state === "HALF_OPEN") {
    if (circuit.successes >= SUCCESS_THRESHOLD) {
      circuit.state = "CLOSED";
      circuit.successes = 0;
    }
  } else if (circuit.state === "CLOSED") {
    if (circuit.successes >= SUCCESS_THRESHOLD) {
      circuit.successes = 0;
    }
  }
}

/**
 * Record a failed request for a source.
 * @param {string} sourceKey
 */
export function recordFailure(sourceKey) {
  const circuit = getCircuit(sourceKey);
  circuit.failures++;
  circuit.lastFailure = Date.now();

  if (circuit.state === "HALF_OPEN") {
    // Back to OPEN immediately
    circuit.state = "OPEN";
    circuit.openedAt = Date.now();
    circuit.successes = 0;
  } else if (circuit.state === "CLOSED" && circuit.failures >= FAILURE_THRESHOLD) {
    circuit.state = "OPEN";
    circuit.openedAt = Date.now();
    circuit.successes = 0;
  }
}

/**
 * Get current status of all circuits (for debugging/health endpoint).
 * @returns {object}
 */
export function getCircuitStatus() {
  const result = {};
  for (const [key, circuit] of circuits) {
    const allowed = isSourceAllowed(key);
    result[key] = {
      state: circuit.state,
      failures: circuit.failures,
      successes: circuit.successes,
      ...allowed
    };
  }
  return result;
}

/**
 * Reset a specific circuit (for manual recovery).
 * @param {string} sourceKey
 */
export function resetCircuit(sourceKey) {
  circuits.delete(sourceKey);
}
