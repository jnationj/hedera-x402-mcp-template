import { ContractId } from "@hiero-ledger/sdk";
import type { Address } from "viem";
import { type HederaNetwork, chainIdToHederaNetwork } from "~~/utils/scaffold-hbar/hederaAccountId";

const HEDERA_CONTRACT_ID_RE = /^\d+\.\d+\.\d+$/;

/** Returns the native Hedera contract id for an EVM address via mirror node. */
export async function getHederaContractIdFromEvmAddress(
  evmAddress: string,
  network: HederaNetwork = "testnet",
): Promise<string | null> {
  const params = new URLSearchParams({ evm: evmAddress, network });
  const res = await fetch(`/api/hedera/contract?${params}`);

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to resolve Hedera contract id");
  }

  const data = (await res.json()) as { contractId?: string | null };
  return data.contractId ?? null;
}

/**
 * Resolve a `ContractId` for native `ContractExecuteTransaction`.
 * Prefers an explicit `0.0.x` id; falls back to mirror lookup by EVM address.
 */
export async function resolveNativeContractId(args: {
  hederaContractId?: string | null;
  evmAddress: Address;
  chainId: number;
}): Promise<ContractId> {
  const fromConfig = args.hederaContractId?.trim();
  if (fromConfig && HEDERA_CONTRACT_ID_RE.test(fromConfig)) {
    return ContractId.fromString(fromConfig);
  }

  const network = chainIdToHederaNetwork(args.chainId);
  const contractId = await getHederaContractIdFromEvmAddress(args.evmAddress, network);
  if (!contractId) {
    throw new Error(
      `Could not resolve Hedera contract id for ${args.evmAddress} on ${network}. ` +
        "Redeploy with `yarn hardhat:deploy` or set FILE_REGISTRY_HEDERA_CONTRACT_ID.",
    );
  }

  return ContractId.fromString(contractId);
}
