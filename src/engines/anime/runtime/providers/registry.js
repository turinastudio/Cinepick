const { AnimeFLVProvider } = require("./animeflv");
const { AnimeAV1Provider } = require("./animeav1");
const { HenaojaraProvider } = require("./henaojara");
const { isProviderEnabled } = require("../../../../config/request-context.cjs");

const providers = [
  new AnimeFLVProvider(),
  new AnimeAV1Provider(),
  new HenaojaraProvider()
];

const providerOrder = ["animeflv", "animeav1", "henaojara"];

function getConfiguredProviders() {
  return providers.filter((provider) => isProviderEnabled("anime", provider.id));
}

function getProviderById(providerId) {
  return getConfiguredProviders().find((provider) => provider.id === providerId) || null;
}

function getOrderedProviders() {
  return providerOrder.map((providerId) => getProviderById(providerId)).filter(Boolean);
}

module.exports = {
  getOrderedProviders,
  getProviderById,
  getConfiguredProviders,
  providerOrder,
  providers
};
