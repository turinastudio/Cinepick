/**
 * Test individual extractors against real player URLs.
 * Tests the most common hosts: streamwish, filemoon, voe, dood, streamtape
 */

import { resolveExtractorStream } from '../src/lib/extractors/registry.js';

const TESTS = [
  { label: 'streamwish', url: 'https://streamwish.to/e/j2hwb82ugot8' },
  { label: 'filemoon', url: 'https://filemoon.sx/e/a3mc3ylgmg4t' },
  { label: 'voe', url: 'https://voe.sx/e/4bq1qtyv0ajz' },
  { label: 'doodstream', url: 'https://doodstream.com/e/q4sbfje32178' },
  { label: 'streamtape', url: 'https://streamtape.com/e/pjg8qklQ88tr6Jq' },
  { label: 'netu', url: 'https://waaw.to/f/adIMQLaQIWZ3' },
  { label: 'vidhide', url: 'https://filelions.to/v/ar8939xiae8f' },
];

console.log('Testing extractors against real player URLs...\n');
console.log(`${'Extractor'.padEnd(18)} | ${'Streams'.padEnd(8)} | ${'Time'.padEnd(10)} | Status`);
console.log('─'.repeat(60));

for (const t of TESTS) {
  const start = Date.now();
  try {
    const streams = await resolveExtractorStream(t.url, t.label, true);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const count = streams?.length || 0;
    const status = count > 0 ? `OK` : '0 streams';
    console.log(`${t.label.padEnd(18)} | ${String(count).padEnd(8)} | ${elapsed.padEnd(10)} | ${status}`);
    if (count > 0) {
      console.log(`  → ${streams[0].url.substring(0, 80)}`);
    }
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const errStr = err.message?.substring(0, 30) || String(err);
    console.log(`${t.label.padEnd(18)} | ${'0'.padEnd(8)} | ${elapsed.padEnd(10)} | ERR: ${errStr}`);
  }
}

console.log('─'.repeat(60));
