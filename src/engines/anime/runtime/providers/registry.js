import { AnimeFLVProvider } from "./animeflv.js";
import { AnimeAV1Provider } from "./animeav1.js";
import { HenaojaraProvider } from "./henaojara.js";
import { TioAnimeProvider } from "./tioanime.js";
import { isProviderEnabled } from "../../../../config/request-context.cjs";

const providers = [
  new AnimeFLVProvider(),
  new AnimeAV1Provider(),
  new HenaojaraProvider(),
  new TioAnimeProvider()
];

const providerOrder = ["animeflv", "animeav1", "henaojara", "tioanime"];

export function getConfiguredProviders() {
  return providers.filter((provider) => isProviderEnabled("anime", provider.id));
}

export function getProviderById(providerId) {
  return getConfiguredProviders().find((provider) => provider.id === providerId) || null;
}

export function getOrderedProviders() {
  return providerOrder.map((providerId) => getProviderById(providerId)).filter(Boolean);
}

export { providerOrder, providers };
