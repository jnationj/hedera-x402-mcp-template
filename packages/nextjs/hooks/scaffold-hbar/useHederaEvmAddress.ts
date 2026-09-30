import { useEffect, useState } from "react";
import { chainIdToHederaNetwork, getEvmAddressFromHederaAccountId } from "~~/utils/scaffold-hbar/hederaAccountId";

/** Resolve the EVM alias for a connected native Hedera account (needed for FileRegistry owner checks). */
export function useHederaEvmAddress(hederaAccountId: string | null | undefined, chainId?: number) {
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!hederaAccountId) {
      setEvmAddress(null);
      return;
    }

    let cancelled = false;
    const network = chainIdToHederaNetwork(chainId ?? 296);
    setIsLoading(true);

    void getEvmAddressFromHederaAccountId(hederaAccountId, network)
      .then(address => {
        if (!cancelled) setEvmAddress(address);
      })
      .catch(() => {
        if (!cancelled) setEvmAddress(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hederaAccountId, chainId]);

  return { evmAddress, isLoading };
}
