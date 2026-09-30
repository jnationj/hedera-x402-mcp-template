import { useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import scaffoldConfig from "~~/scaffold.config";
import { useGlobalState } from "~~/services/store/store";
import { ChainWithAttributes, NETWORKS_EXTRA_DATA } from "~~/utils/scaffold-hbar";

const DEFAULT_TARGET_NETWORK: ChainWithAttributes = {
  ...scaffoldConfig.targetNetworks[0],
  ...NETWORKS_EXTRA_DATA[scaffoldConfig.targetNetworks[0].id],
};

/**
 * Retrieves the connected wallet's network from scaffold.config or defaults to the 0th network in the list if the wallet is not connected.
 */
export function useTargetNetwork(): { targetNetwork: ChainWithAttributes } {
  const { chain } = useAccount();
  const targetNetwork = useGlobalState(({ targetNetwork }) => targetNetwork) ?? DEFAULT_TARGET_NETWORK;
  const setTargetNetwork = useGlobalState(({ setTargetNetwork }) => setTargetNetwork);

  useEffect(() => {
    if (!chain?.id) return;
    const newSelectedNetwork = scaffoldConfig.targetNetworks.find(network => network.id === chain.id);
    if (!newSelectedNetwork || newSelectedNetwork.id === targetNetwork.id) return;
    setTargetNetwork({ ...newSelectedNetwork, ...NETWORKS_EXTRA_DATA[newSelectedNetwork.id] });
  }, [chain?.id, setTargetNetwork, targetNetwork.id]);

  return useMemo(() => ({ targetNetwork: targetNetwork ?? DEFAULT_TARGET_NETWORK }), [targetNetwork]);
}
