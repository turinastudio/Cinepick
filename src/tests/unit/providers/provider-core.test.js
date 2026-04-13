/**
 * Provider core orchestrator tests.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('Provider Core — Registry', () => {
  let core;
  beforeEach(async () => { core = await import('../../../engines/general/providers/core.js'); });

  it('should have providers array', () => {
    assert.ok(Array.isArray(core.providers));
    assert.ok(core.providers.length >= 14, `Expected 14+ providers, got ${core.providers.length}`);
  });

  it('should return all providers via getAllProviders', () => {
    const all = core.getAllProviders();
    assert.ok(Array.isArray(all));
    assert.ok(all.length >= 14);
  });

  it('should have unique provider IDs', () => {
    const all = core.getAllProviders();
    const ids = all.map(p => p.id);
    assert.strictEqual(ids.length, new Set(ids).size, 'Provider IDs should be unique');
  });

  it('should have getProviderById function', () => { assert.strictEqual(typeof core.getProviderById, 'function'); });

  it('should return null for unknown provider ID', () => {
    assert.strictEqual(core.getProviderById('nonexistent-provider-xyz'), null);
  });
});

describe('Provider Core — Orchestrator Functions', () => {
  let core;
  beforeEach(async () => { core = await import('../../../engines/general/providers/core.js'); });

  it('should have resolveStreamsFromExternalId', () => { assert.strictEqual(typeof core.resolveStreamsFromExternalId, 'function'); });
  it('should have debugStreamsFromExternalId', () => { assert.strictEqual(typeof core.debugStreamsFromExternalId, 'function'); });
  it('should have debugProviderStreamsFromExternalId', () => { assert.strictEqual(typeof core.debugProviderStreamsFromExternalId, 'function'); });
  it('should have getAvailableProviders', () => { assert.strictEqual(typeof core.getAvailableProviders, 'function'); });
  it('should have resolveProviderFromMetaId', () => { assert.strictEqual(typeof core.resolveProviderFromMetaId, 'function'); });

  it('resolveStreamsFromExternalId should return array on failure', async () => {
    assert.ok(Array.isArray(await core.resolveStreamsFromExternalId('movie', 'tt0000000')));
  });

  it('debugStreamsFromExternalId should return object on failure', async () => {
    const result = await core.debugStreamsFromExternalId('movie', 'tt0000000');
    assert.ok(result !== null && typeof result === 'object');
  });
});
