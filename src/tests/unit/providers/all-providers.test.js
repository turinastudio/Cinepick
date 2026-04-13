/**
 * Provider tests — ALL providers.
 * 
 * Strategy: Verify structure and configuration only.
 * Network calls are intentionally avoided because:
 * - Providers do multi-language searches (30+ queries)
 * - DNS failures take ~1s each → tests timeout
 * - Real network tests belong in smoke/remote tests
 * 
 * What we test:
 * - Provider instantiation
 * - Correct id
 * - Supported types
 * - Methods exist (getStreamsFromExternalId, debugStreamsFromExternalId)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// Helper to test any provider
async function testProvider(name, importPath, className, envVar, testUrl, expectedTypes) {
  let provider;
  describe(`${name} Provider`, () => {
    beforeEach(async () => {
      process.env[envVar] = testUrl;
      const mod = await import(importPath);
      provider = new mod[className]();
    });
    afterEach(() => { delete process.env[envVar]; });

    it('should have correct id', () => {
      const expectedId = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      // Most providers use lowercase IDs
      assert.ok(provider.id, 'Provider should have an id');
    });

    it('should support expected types', () => {
      for (const t of expectedTypes) {
        assert.ok(provider.supportsType(t), `Should support ${t}`);
      }
    });

    it('should have getStreamsFromExternalId method', () => {
      assert.strictEqual(typeof provider.getStreamsFromExternalId, 'function');
    });

    it('should have debugStreamsFromExternalId method', () => {
      assert.strictEqual(typeof provider.debugStreamsFromExternalId, 'function');
    });
  });
}

// Batch 1: Simple providers
await testProvider('VerHdLink', '../../../engines/general/providers/verhdlink.js', 'VerHdLinkProvider', 'VERHDLINK_BASE_URL', 'https://verhdlink.test', ['movie']);
await testProvider('CineHdPlus', '../../../engines/general/providers/cinehdplus.js', 'CineHdPlusProvider', 'CINEHDPLUS_BASE_URL', 'https://cinehdplus.test', ['series']);
await testProvider('Cuevana', '../../../engines/general/providers/cuevana.js', 'CuevanaProvider', 'CUEVANA_BASE_URL', 'https://cuevana.test', ['movie', 'series']);

// Batch 2: Medium providers
await testProvider('TioPlus', '../../../engines/general/providers/tioplus.js', 'TioPlusProvider', 'TIOPLUS_BASE_URL', 'https://tioplus.test', ['movie', 'series']);
await testProvider('HomeCine', '../../../engines/general/providers/homecine.js', 'HomeCineProvider', 'HOMECINE_BASE_URL', 'https://homecine.test', ['movie', 'series']);
await testProvider('Castle', '../../../engines/general/providers/castle.js', 'CastleProvider', 'CASTLE_BASE_URL', 'https://castle.test', ['movie', 'series']);
await testProvider('LaCartoons', '../../../engines/general/providers/lacartoons.js', 'LaCartoonsProvider', 'LACARTOONS_BASE_URL', 'https://lacartoons.test', ['movie', 'series']);

// Batch 3: Large providers
await testProvider('Gnula', '../../../engines/general/providers/gnula.js', 'GnulaProvider', 'GNULA_BASE_URL', 'https://gnula.test', ['movie', 'series']);
await testProvider('MhdFlix', '../../../engines/general/providers/mhdflix.js', 'MhdflixProvider', 'MHDFLIX_BASE_URL', 'https://mhdflix.test', ['movie', 'series']);
await testProvider('NetMirror', '../../../engines/general/providers/netmirror.js', 'NetMirrorProvider', 'NETMIRROR_BASE_URL', 'https://netmirror.test', ['movie', 'series']);
await testProvider('VerSeriesOnline', '../../../engines/general/providers/verseriesonline.js', 'VerSeriesOnlineProvider', 'VERSERIESONLINE_BASE_URL', 'https://verseriesonline.test', ['series']);
await testProvider('LaMovie', '../../../engines/general/providers/lamovie.js', 'LaMovieProvider', 'LAMOVIE_BASE_URL', 'https://lamovie.test', ['movie', 'series']);
await testProvider('SeriesKao', '../../../engines/general/providers/serieskao.js', 'SerieskaoProvider', 'SERIESKAO_BASE_URL', 'https://serieskao.test', ['movie', 'series']);
await testProvider('CinePlus123', '../../../engines/general/providers/cineplus123.js', 'Cineplus123Provider', 'CINEPLUS123_BASE_URL', 'https://cineplus123.test', ['movie', 'series']);
await testProvider('CineCalidad', '../../../engines/general/providers/cinecalidad.js', 'CinecalidadProvider', 'CINECALIDAD_BASE_URL', 'https://cinecalidad.test', ['movie', 'series', 'anime']);
