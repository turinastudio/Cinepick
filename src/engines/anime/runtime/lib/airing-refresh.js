const { writeAiringCache } = require("./airing-cache");
const { getProviderById } = require("../providers/registry");

function scheduleDailyRefresh(task) {
  return task().then(() => {
    setInterval(task, 86400000);
  });
}

async function refreshProviderAiring(providerId) {
  const provider = getProviderById(providerId);
  if (!provider) {
    throw new Error(`Unknown provider ${providerId}`);
  }

  const titles = await provider.getAiringFromWeb();
  if (!Array.isArray(titles) || titles.length === 0) {
    throw new Error(`Refusing to write empty airing cache for ${providerId}`);
  }
  console.log(`\x1b[36mGot ${titles.length} titles\x1b[39m, saving to cache`);
  await writeAiringCache(providerId, titles);
}

function startAiringRefreshJobs() {
  scheduleDailyRefresh(() => refreshProviderAiring("animeflv"))
    .then(() => console.log('\x1b[32mOn Air titles "cached" successfully!\x1b[39m'))
    .catch((error) => console.error('\x1b[31mFailed "caching" titles:\x1b[39m ' + error));
  scheduleDailyRefresh(() => refreshProviderAiring("animeav1"))
    .then(() => console.log('\x1b[32mOn Air AV1 titles "cached" successfully!\x1b[39m'))
    .catch((error) => console.error('\x1b[31mFailed "caching" titles:\x1b[39m ' + error));
  scheduleDailyRefresh(() => refreshProviderAiring("henaojara"))
    .then(() => console.log('\x1b[32mOn Air Henaojara titles "cached" successfully!\x1b[39m'))
    .catch((error) => console.error('\x1b[31mFailed "caching" titles:\x1b[39m ' + error));
}

module.exports = {
  refreshProviderAiring,
  startAiringRefreshJobs
};
