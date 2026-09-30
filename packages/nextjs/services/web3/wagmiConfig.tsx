import type { Chain } from "viem";
import { createConfig, http } from "wagmi";
import scaffoldConfig from "~~/scaffold.config";

/** Read-only wagmi client for JSON-RPC views (block explorer, contract reads). Wallet writes use native HAPI. */
export const enabledChains = scaffoldConfig.targetNetworks;

function resolveRpcUrl(chain: Chain): string {
  return scaffoldConfig.rpcOverrides?.[chain.id as 295 | 296] ?? chain.rpcUrls.default.http[0];
}

export const wagmiConfig = createConfig({
  chains: [...enabledChains],
  transports: Object.fromEntries(enabledChains.map(chain => [chain.id, http(resolveRpcUrl(chain))])) as Record<
    (typeof enabledChains)[number]["id"],
    ReturnType<typeof http>
  >,
});
