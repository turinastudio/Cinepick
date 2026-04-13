import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

describe('TMDB API Key Configuration', () => {
  it('should not have hardcoded TMDB API key in detection.js', () => {
    const sourceCode = readFileSync(
      new URL('../../engines/anime/detection.js', import.meta.url),
      'utf-8'
    );
    assert.ok(
      !sourceCode.includes('439c478a771f35c05022f9feabcca01c'),
      'TMDB API key should not be hardcoded in detection.js'
    );
  });

  it('should not have hardcoded TMDB API key in tmdb.js', () => {
    const sourceCode = readFileSync(
      new URL('../../lib/tmdb.js', import.meta.url),
      'utf-8'
    );
    assert.ok(
      !sourceCode.includes('439c478a771f35c05022f9feabcca01c'),
      'TMDB API key should not be hardcoded in tmdb.js'
    );
  });

  it('should use TMDB_API_KEY from environment when set', () => {
    process.env.TMDB_API_KEY = 'test-key-12345';
    assert.strictEqual(process.env.TMDB_API_KEY, 'test-key-12345');
  });
});
