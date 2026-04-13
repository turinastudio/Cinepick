import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

describe('Anime Detection', () => {
  const originalApiKey = process.env.TMDB_API_KEY;
  const originalReadToken = process.env.TMDB_API_READ_TOKEN;

  afterEach(() => {
    process.env.TMDB_API_KEY = originalApiKey;
    process.env.TMDB_API_READ_TOKEN = originalReadToken;
  });

  it('should gracefully handle missing TMDB API key', async () => {
    process.env.TMDB_API_KEY = '';
    const { detectAnimeForExternalId } = await import('../../engines/anime/detection.js');
    const result = await detectAnimeForExternalId('tv', 'tt0388629');
    assert.strictEqual(result.isAnime, false);
    assert.strictEqual(result.source, 'unresolved');
  });

  it('should return false for non-TMDB ID format', async () => {
    process.env.TMDB_API_KEY = 'test-key';
    const { detectAnimeForExternalId } = await import('../../engines/anime/detection.js');
    // Non-TMDB ID that doesn't start with 'tt' — should return unresolved
    const result = await detectAnimeForExternalId('tv', 'custom:123');
    assert.strictEqual(result.isAnime, false);
    assert.strictEqual(result.source, 'unresolved');
  });

  it('should handle TMDB API errors gracefully', async () => {
    process.env.TMDB_API_KEY = 'test-key';
    const { detectAnimeForExternalId } = await import('../../engines/anime/detection.js');
    // Real TMDB call will fail with invalid key, should not crash
    const result = await detectAnimeForExternalId('movie', 'tt0137523');
    assert.ok(typeof result.isAnime === 'boolean');
    // Result will be 'unresolved' or 'details_unavailable' but should not throw
  });

  it('should handle invalid external IDs gracefully', async () => {
    process.env.TMDB_API_KEY = 'test-key';
    const { detectAnimeForExternalId } = await import('../../engines/anime/detection.js');
    const result = await detectAnimeForExternalId('tv', '');
    assert.strictEqual(result.isAnime, false);
    assert.strictEqual(result.source, 'unresolved');
  });
});
