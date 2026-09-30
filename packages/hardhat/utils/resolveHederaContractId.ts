const MIRROR_BASE: Record<number, string> = {
  295: process.env.HEDERA_MIRROR_MAINNET_URL ?? "https://mainnet.mirrornode.hedera.com",
  296: process.env.HEDERA_MIRROR_TESTNET_URL ?? "https://testnet.mirrornode.hedera.com",
};

/**
 * Resolve the native Hedera contract id (e.g. `0.0.9214560`) for an EVM-deployed contract.
 * JSON-RPC deploys get CREATE-style `0x…` addresses; native `ContractExecuteTransaction`
 * must target the mirror-reported contract id, not `ContractId.fromSolidityAddress`.
 */
export async function resolveHederaContractId(
  evmAddress: string,
  chainId: number,
  options?: { attempts?: number; delayMs?: number },
): Promise<string> {
  const base = MIRROR_BASE[chainId];
  if (!base) {
    throw new Error(`No Hedera mirror URL configured for chain id ${chainId}`);
  }

  const attempts = options?.attempts ?? 12;
  const delayMs = options?.delayMs ?? 2_000;
  const normalized = evmAddress.toLowerCase();

  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetch(`${base}/api/v1/contracts/${normalized}`);
    if (res.ok) {
      const data = (await res.json()) as { contract_id?: string };
      if (typeof data.contract_id === "string" && /^\d+\.\d+\.\d+$/.test(data.contract_id)) {
        return data.contract_id;
      }
    }
    if (attempt < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`Could not resolve Hedera contract id for EVM address ${evmAddress} on chain ${chainId}`);
}
