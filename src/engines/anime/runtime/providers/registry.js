const { AnimeFLVProvider } = require("./animeflv");
const { AnimeAV1Provider } = require("./animeav1");
const { HenaojaraProvider } = require("./henaojara");

const providers = [
  new AnimeFLVProvider(),
  new AnimeAV1Provider(),
  new HenaojaraProvider()
];

const providerOrder = ["animeflv", "animeav1", "henaojara"];

function getProviderById(providerId) {
  return providers.find((provider) => provider.id === providerId) || null;
}

function getOrderedProviders() {
  return providerOrder.map((providerId) => getProviderById(providerId)).filter(Boolean);
}

module.exports = {
  getOrderedProviders,
  getProviderById,
  providerOrder,
  providers
};
