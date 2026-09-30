import type { HederaProvider } from "@hashgraph/hedera-wallet-connect";
import { transactionToBase64String } from "@hashgraph/hedera-wallet-connect";
import { ContractExecuteTransaction } from "@hiero-ledger/sdk";
import type { Abi, Address } from "viem";
import { encodeFunctionData } from "viem";
import { chainIdToHederaNetwork, parseHederaAccountId } from "~~/utils/scaffold-hbar/hederaAccountId";
import { resolveNativeContractId } from "~~/utils/scaffold-hbar/hederaContractId";

/** Matches Hardhat deploy gasLimit for FileRegistry. */
const CONTRACT_EXECUTE_GAS = 3_000_000;

export type NativeContractWriteResult = {
  transactionId: string;
  transactionHash?: string;
};

function hederaCaipNetwork(chainId: number): string {
  return chainIdToHederaNetwork(chainId) === "mainnet" ? "hedera:mainnet" : "hedera:testnet";
}

function toMirrorTransactionPath(transactionId: string): string {
  const [account, timestamp] = transactionId.split("@");
  if (!account || !timestamp) {
    throw new Error(`Invalid Hedera transaction id: ${transactionId}`);
  }
  const [seconds, nanos = "0"] = timestamp.split(".");
  return `${account}-${seconds}-${nanos}`;
}

/** Poll mirror node until the native transaction reaches consensus. */
export async function waitForHederaTransaction(
  transactionId: string,
  chainId: number,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const network = chainIdToHederaNetwork(chainId);
  const path = toMirrorTransactionPath(transactionId);
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const intervalMs = options?.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`/api/hedera/transaction?network=${network}&transactionId=${encodeURIComponent(path)}`);
    if (res.ok) {
      const body = (await res.json()) as { result?: string };
      if (body.result === "SUCCESS") return;
      if (body.result && body.result !== "UNKNOWN") {
        throw new Error(`Transaction failed on Hedera: ${body.result}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error("Timed out waiting for Hedera transaction confirmation");
}

/**
 * Call a Solidity contract via native HAPI (`ContractExecuteTransaction`).
 * Same bytecode as the EVM relay path; signed with `hedera_signAndExecuteTransaction`.
 */
export async function writeContractViaNativeProvider(args: {
  provider: HederaProvider;
  hederaAccountId: string;
  chainId: number;
  contractAddress: Address;
  /** Native Hedera contract id (`0.0.x`). Resolved from mirror node when omitted. */
  hederaContractId?: string;
  abi: Abi;
  functionName: string;
  fnArgs: readonly unknown[];
}): Promise<NativeContractWriteResult> {
  const payerAccountId = parseHederaAccountId(args.hederaAccountId);
  if (!payerAccountId) {
    throw new Error("Invalid Hedera account id for contract execution");
  }

  const calldata = encodeFunctionData({
    abi: args.abi,
    functionName: args.functionName,
    args: args.fnArgs as never,
  });

  const contractId = await resolveNativeContractId({
    hederaContractId: args.hederaContractId,
    evmAddress: args.contractAddress,
    chainId: args.chainId,
  });

  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(CONTRACT_EXECUTE_GAS)
    .setFunctionParameters(Buffer.from(calldata.slice(2), "hex"));

  const result = await args.provider.hedera_signAndExecuteTransaction({
    signerAccountId: `${hederaCaipNetwork(args.chainId)}:${payerAccountId}`,
    transactionList: transactionToBase64String(tx),
  });

  if (!result?.transactionId) {
    throw new Error("Contract execution failed — no transaction id returned from wallet");
  }

  return {
    transactionId: result.transactionId,
    transactionHash: result.transactionHash,
  };
}
