import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Scoring Configuration Alignment', () => {
  it('should have consistent HOST_SCORES between general and anime engines', async () => {
    const { HOST_SCORES: GENERAL_HOST_SCORES } = await import('../../config/scoring-config.js');
    const animeModule = await import('../../engines/anime/runtime/lib/stream-selection.js');
    const ANIME_HOST_SCORES = animeModule.HOST_SCORES;

    const generalKeys = new Set(Object.keys(GENERAL_HOST_SCORES));
    const animeKeys = new Set(Object.keys(ANIME_HOST_SCORES));

    // Check for hosts in general but not in anime
    const missingInAnime = [...generalKeys].filter(k => !animeKeys.has(k));

    // Check for hosts in anime but not in general
    const missingInGeneral = [...animeKeys].filter(k => !generalKeys.has(k));

    // These are warnings, not failures - scoring can legitimately differ
    if (missingInAnime.length > 0) {
      console.warn(`[scoring-alignment] Hosts in general but not in anime: ${missingInAnime.join(', ')}`);
    }
    if (missingInGeneral.length > 0) {
      console.warn(`[scoring-alignment] Hosts in anime but not in general: ${missingInGeneral.join(', ')}`);
    }

    // For hosts in both, check score values match
    const commonKeys = [...generalKeys].filter(k => animeKeys.has(k));
    for (const key of commonKeys) {
      assert.strictEqual(
        GENERAL_HOST_SCORES[key],
        ANIME_HOST_SCORES[key],
        `HOST_SCORES[${key}] differs: general=${GENERAL_HOST_SCORES[key]}, anime=${ANIME_HOST_SCORES[key]}`
      );
    }
  });
});
