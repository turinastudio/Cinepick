import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cacheFiles = {
  animeflv: "onair_titles.json",
  animeav1: "onairAV1_titles.json",
  henaojara: "onairHENAOJARA_titles.json"
};

export function getCachePath(providerId) {
  const filename = cacheFiles[providerId];
  if (!filename) {
    throw new Error(`Unknown provider cache file for ${providerId}`);
  }

  return path.resolve(__dirname, "..", "..", filename);
}

export function getBackupCachePath(providerId) {
  return `${getCachePath(providerId)}.bak`;
}

export function getTempCachePath(providerId) {
  return `${getCachePath(providerId)}.tmp`;
}

export async function parseAiringCacheFile(filePath, providerId) {
  const raw = await fsPromises.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Empty airing cache for ${providerId}`);
  }

  return parsed;
}

export async function readAiringCache(providerId) {
  const primaryPath = getCachePath(providerId);
  try {
    return await parseAiringCacheFile(primaryPath, providerId);
  } catch (primaryError) {
    const backupPath = getBackupCachePath(providerId);
    try {
      return await parseAiringCacheFile(backupPath, providerId);
    } catch {
      throw primaryError;
    }
  }
}

export async function writeAiringCache(providerId, titles) {
  const filePath = getCachePath(providerId);
  const tempPath = getTempCachePath(providerId);
  const backupPath = getBackupCachePath(providerId);
  const payload = JSON.stringify(titles);

  await fsPromises.writeFile(tempPath, payload, "utf8");
  await fsPromises.rm(filePath, { force: true });
  await fsPromises.rename(tempPath, filePath);
  await fsPromises.writeFile(backupPath, payload, "utf8");
}
