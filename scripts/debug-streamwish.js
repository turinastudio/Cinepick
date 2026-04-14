/**
 * Debug streamwish extractor step by step.
 */

import { fetchText, fetchJson } from '../src/lib/extractors/shared/http.js';
import { extractM3u8UrlsFromText } from '../src/lib/extractors/shared/streams.js';
import { getAndUnpack } from '../src/lib/extractors/shared/packer.js';
import { decodeBase64Url } from '../src/lib/extractors/shared/crypto.js';
import { buildStream } from '../src/lib/extractors/public-builders.js';
import cheerio from 'cheerio-without-node-native';
import crypto from 'node:crypto';

const url = 'https://streamwish.to/e/j2hwb82ugot8';
const origin = 'https://streamwish.to';

// Step 1: Extract embed code
const parsed = new URL(url);
const parts = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
const markerIndex = parts.findIndex(p => p === 'e' || p === 'embed');
const embedCode = markerIndex >= 0 ? parts[markerIndex + 1] : parts.at(-1);
console.log('Embed code:', embedCode);

// Step 2: Try API approach
const apiUrl = `${origin}/api/videos/${encodeURIComponent(embedCode)}/embed/playback`;
console.log('\nStep 2: API call to', apiUrl);
try {
  const playback = await fetchJson(apiUrl, {
    Referer: url,
    Origin: origin,
    Accept: 'application/json, text/plain, */*'
  });
  console.log('API response keys:', Object.keys(playback || {}));
  
  const payload = playback?.playback || playback;
  if (payload?.iv && payload?.payload && Array.isArray(payload.key_parts)) {
    console.log('Has encrypted payload, attempting decrypt...');
    const key = Buffer.concat(payload.key_parts.map(p => decodeBase64Url(p)));
    const iv = decodeBase64Url(payload.iv);
    const encryptedPayload = decodeBase64Url(payload.payload);
    const tag = encryptedPayload.subarray(encryptedPayload.length - 16);
    const encrypted = encryptedPayload.subarray(0, encryptedPayload.length - 16);
    console.log('Key length:', key.length, 'IV length:', iv.length, 'Encrypted length:', encrypted.length);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const media = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
    console.log('Decrypted media keys:', Object.keys(media || {}));
    console.log('Sources:', JSON.stringify(media?.sources?.slice(0, 2), null, 2));
  } else {
    console.log('No encrypted payload. Raw:', JSON.stringify(payload).substring(0, 200));
  }
} catch (err) {
  console.log('API failed:', err.message);
}

// Step 3: Try HTML fallback
console.log('\nStep 3: HTML fallback...');
try {
  const html = await fetchText(url, { Origin: origin, Referer: origin });
  console.log('HTML length:', html.length);
  
  // Check for direct file: match
  const fileMatch = html.match(/file\s*:\s*["']([^"']+)["']/i);
  console.log('Direct file match:', fileMatch?.[1]?.substring(0, 80));
  
  // Check for packed scripts
  const scripts = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi), m => m[1]).filter(Boolean);
  console.log('Script count:', scripts.length);
  const packedScripts = scripts.filter(s => s.includes('eval(function(p,a,c'));
  console.log('Packed script count:', packedScripts.length);
  
  const unpacked = packedScripts.map(getAndUnpack).join('\n');
  console.log('Unpacked length:', unpacked.length);
  
  // Look for m3u8 in unpacked
  const m3u8InUnpacked = unpacked.match(/https?:\/\/[^"'\\\s]+\.m3u8(?:\?[^"'\\\s]*)?/gi);
  console.log('M3U8 URLs in unpacked:', m3u8InUnpacked?.slice(0, 3));
  
  // Look for file: in unpacked
  const fileInUnpacked = unpacked.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/gi);
  console.log('file: matches in unpacked:', fileInUnpacked?.slice(0, 3));
  
  // Combined search
  const combined = [html, unpacked].join('\n');
  const allM3u8 = extractM3u8UrlsFromText(combined, url);
  console.log('All M3U8 URLs found:', allM3u8.length, allM3u8.slice(0, 3));
} catch (err) {
  console.log('HTML fetch failed:', err.message);
}
