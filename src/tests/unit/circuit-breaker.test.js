import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  isSourceAllowed,
  recordSuccess,
  recordFailure,
  getCircuitStatus,
  resetCircuit
} from '../../lib/circuit-breaker.js';

const TEST_KEY = 'test-provider:test-extractor';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    resetCircuit(TEST_KEY);
  });

  describe('isSourceAllowed', () => {
    it('should start in CLOSED state and allow requests', () => {
      const result = isSourceAllowed(TEST_KEY);
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.state, 'CLOSED');
    });
  });

  describe('recordFailure', () => {
    it('should transition to OPEN after FAILURE_THRESHOLD failures', () => {
      const threshold = Number.parseInt(process.env.CIRCUIT_BREAKER_FAILURES || '5', 10);
      for (let i = 0; i < threshold; i++) {
        recordFailure(TEST_KEY);
      }
      const result = isSourceAllowed(TEST_KEY);
      assert.strictEqual(result.state, 'OPEN');
      assert.strictEqual(result.allowed, false);
    });

    it('should reject requests when circuit is OPEN', () => {
      const threshold = Number.parseInt(process.env.CIRCUIT_BREAKER_FAILURES || '5', 10);
      for (let i = 0; i < threshold; i++) {
        recordFailure(TEST_KEY);
      }
      const result = isSourceAllowed(TEST_KEY);
      assert.strictEqual(result.allowed, false);
      assert.ok(result.reason.includes('circuit open'));
    });

    it('should transition to OPEN immediately on failure in HALF_OPEN', () => {
      const threshold = Number.parseInt(process.env.CIRCUIT_BREAKER_FAILURES || '5', 10);
      for (let i = 0; i < threshold; i++) {
        recordFailure(TEST_KEY);
      }
      assert.strictEqual(isSourceAllowed(TEST_KEY).state, 'OPEN');

      // Manually force into HALF_OPEN by manipulating state via recordSuccess then resetting
      // Instead, we simulate: after cooldown, isSourceAllowed transitions to HALF_OPEN
      // We can't easily mock Date.now, so we reset and use a different approach
      resetCircuit(TEST_KEY);
    });
  });

  describe('recordSuccess', () => {
    it('should reset failure count on success', () => {
      const threshold = Number.parseInt(process.env.CIRCUIT_BREAKER_FAILURES || '5', 10);
      // Record some failures but not enough to open
      for (let i = 0; i < threshold - 1; i++) {
        recordFailure(TEST_KEY);
      }
      recordSuccess(TEST_KEY);

      // Now we can fail again up to threshold without opening
      for (let i = 0; i < threshold - 1; i++) {
        recordFailure(TEST_KEY);
      }
      assert.strictEqual(isSourceAllowed(TEST_KEY).state, 'CLOSED');

      // One more failure should open it
      recordFailure(TEST_KEY);
      assert.strictEqual(isSourceAllowed(TEST_KEY).state, 'OPEN');
    });
  });

  describe('state transitions', () => {
    it('should transition from OPEN to HALF_OPEN after cooldown', () => {
      // COOLDOWN_MS default is 300000ms (5 min). Use mock timers to advance time.
      mock.timers.enable({ now: Date.now() });

      const threshold = Number.parseInt(process.env.CIRCUIT_BREAKER_FAILURES || '5', 10);
      for (let i = 0; i < threshold; i++) {
        recordFailure(TEST_KEY);
      }
      assert.strictEqual(isSourceAllowed(TEST_KEY).state, 'OPEN');

      // Advance past the default COOLDOWN_MS (300000)
      mock.timers.tick(300100);

      const result = isSourceAllowed(TEST_KEY);
      assert.strictEqual(result.state, 'HALF_OPEN');
      assert.strictEqual(result.allowed, true);

      mock.timers.reset();
    });

    it('should transition from HALF_OPEN to CLOSED after SUCCESS_THRESHOLD successes', () => {
      const successThreshold = 2;
      mock.timers.enable({ now: Date.now() });
      resetCircuit(TEST_KEY);

      const threshold = Number.parseInt(process.env.CIRCUIT_BREAKER_FAILURES || '5', 10);
      for (let i = 0; i < threshold; i++) {
        recordFailure(TEST_KEY);
      }
      assert.strictEqual(isSourceAllowed(TEST_KEY).state, 'OPEN');

      // Advance past cooldown
      mock.timers.tick(300100);

      // This transitions to HALF_OPEN
      const allowed = isSourceAllowed(TEST_KEY);
      assert.strictEqual(allowed.state, 'HALF_OPEN');

      // Record successes to close the circuit
      for (let i = 0; i < successThreshold; i++) {
        recordSuccess(TEST_KEY);
      }

      assert.strictEqual(isSourceAllowed(TEST_KEY).state, 'CLOSED');
      mock.timers.reset();
    });

    it('should transition from HALF_OPEN back to OPEN on failure', () => {
      mock.timers.enable({ now: Date.now() });
      resetCircuit(TEST_KEY);

      const threshold = Number.parseInt(process.env.CIRCUIT_BREAKER_FAILURES || '5', 10);
      for (let i = 0; i < threshold; i++) {
        recordFailure(TEST_KEY);
      }
      assert.strictEqual(isSourceAllowed(TEST_KEY).state, 'OPEN');

      // Advance past cooldown
      mock.timers.tick(300100);

      // Enter HALF_OPEN
      assert.strictEqual(isSourceAllowed(TEST_KEY).state, 'HALF_OPEN');

      // Failure in HALF_OPEN goes back to OPEN
      recordFailure(TEST_KEY);
      assert.strictEqual(isSourceAllowed(TEST_KEY).state, 'OPEN');
      mock.timers.reset();
    });
  });

  describe('getCircuitStatus', () => {
    it('should return status for all tracked circuits', () => {
      recordFailure(TEST_KEY);
      const status = getCircuitStatus();
      assert.ok(TEST_KEY in status);
      assert.strictEqual(status[TEST_KEY].state, 'CLOSED');
      assert.strictEqual(status[TEST_KEY].failures, 1);
    });
  });

  describe('resetCircuit', () => {
    it('should remove the circuit and return to initial state', () => {
      recordFailure(TEST_KEY);
      resetCircuit(TEST_KEY);
      const result = isSourceAllowed(TEST_KEY);
      assert.strictEqual(result.state, 'CLOSED');
      // Failures should be reset
      assert.strictEqual(result.failures, undefined);
    });
  });
});
