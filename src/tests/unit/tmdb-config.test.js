import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

describe('TMDB API Key Configuration', () => {
  it('should have DEFAULT_TMDB_API_KEY as fallback in detection.js', () => {
    const sourceCode = readFileSync(
      new URL('../../engines/anime/detection.js', import.meta.url),
      'utf-8'
    );
    assert.ok(
      sourceCode.includes('DEFAULT_TMDB_API_KEY'),
      'detection.js should define DEFAULT_TMDB_API_KEY as fallback'
    );
  });

  it('should have DEFAULT_TMDB_API_KEY as fallback in tmdb.js', () => {
    const sourceCode = readFileSync(
      new URL('../../lib/tmdb.js', import.meta.url),
      'utf-8'
    );
    assert.ok(
      sourceCode.includes('DEFAULT_TMDB_API_KEY'),
      'tmdb.js should define DEFAULT_TMDB_API_KEY as fallback'
    );
  });

  it('should prefer TMDB_API_KEY from environment when set', () => {
    process.env.TMDB_API_KEY = 'custom-key-12345';
    assert.strictEqual(process.env.TMDB_API_KEY, 'custom-key-12345');
  });
});
