"use client";

import { useMemo, useState } from "react";
import { hederaNamespace } from "@hashgraph/hedera-wallet-connect";
import { useAppKit } from "@reown/appkit/react";
import { type Abi, type Address, type Chain, type Hex, createPublicClient, http } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";
import { POLICY_402_ABI } from "~~/contracts/policy402Abi";
import { useHederaEvmAddress, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { type PolicyAttestation, getCurrentPolicyForResource, getPolicy402Address } from "~~/services/policy/server";
import { type RegistryFile, getRegistryFile, isFileId } from "~~/services/registry/server";
import { waitForHederaTransaction, writeContractViaNativeProvider } from "~~/services/web3/hederaContractWrite";
import { useHederaWalletConnect } from "~~/services/web3/hederaWalletConnect";
import { getParsedError, notification } from "~~/utils/scaffold-hbar";

type PolicyDetails = PolicyAttestation & {
  validFrom: bigint;
  validUntil: bigint;
  paymentAsset: string;
  payTo: string;
  priceTinybar: bigint;
  policyHash: Hex;
};

function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toLowerCase();
}

function getPolicy402Metadata(chainId: number): { address?: Address; hederaContractId?: string; abi?: Abi } {
  const chainContracts = (
    deployedContracts as Record<number, Record<string, { address?: string; hederaContractId?: string; abi?: Abi }>>
  )[chainId];
  const contract = chainContracts?.Policy402;
  return {
    address: contract?.address as Address | undefined,
    hederaContractId: contract?.hederaContractId,
    abi: contract?.abi as Abi | undefined,
  };
}

async function loadPolicyDetails(
  resourceDescriptor: string,
  fileId: Hex,
  targetNetwork: Chain,
): Promise<PolicyDetails | null> {
  const currentPolicy = await getCurrentPolicyForResource(resourceDescriptor);
  if (!currentPolicy || currentPolicy.fileId !== fileId) {
    return null;
  }

  const policyAddress = getPolicy402Address();
  if (!policyAddress) {
    return null;
  }

  const rpcUrl = process.env.HEDERA_RPC_URL ?? targetNetwork.rpcUrls.default.http[0] ?? "https://testnet.hashio.io/api";
  const client = createPublicClient({
    chain: targetNetwork,
    transport: http(rpcUrl),
  });

  const [versionState, policyHash] = await Promise.all([
    client.readContract({
      address: policyAddress,
      abi: POLICY_402_ABI,
      functionName: "getPolicyVersion",
      args: [currentPolicy.policyId, currentPolicy.version],
    }) as Promise<{
      policyId: Hex;
      fileId: Hex;
      serviceId: Hex;
      owner: Address;
      version: bigint;
      validFrom: bigint;
      validUntil: bigint;
      paymentAsset: string;
      payTo: string;
      priceTinybar: bigint;
      status: number;
      createdAt: bigint;
      policyHash: Hex;
    }>,
    client.readContract({
      address: policyAddress,
      abi: POLICY_402_ABI,
      functionName: "getPolicyHash",
      args: [currentPolicy.policyId, currentPolicy.version],
    }) as Promise<Hex>,
  ]);

  return {
    ...currentPolicy,
    validFrom: versionState.validFrom,
    validUntil: versionState.validUntil,
    paymentAsset: versionState.paymentAsset,
    payTo: versionState.payTo,
    priceTinybar: versionState.priceTinybar,
    policyHash,
  };
}

export default function RevokePolicyPage() {
  const { open } = useAppKit();
  const { isConnected, hederaAccountId, provider } = useHederaWalletConnect();
  const { targetNetwork } = useTargetNetwork();
  const { evmAddress, isLoading: resolvingEvmAddress } = useHederaEvmAddress(hederaAccountId, targetNetwork.id);

  const [fileIdInput, setFileIdInput] = useState("");
  const [loadedFile, setLoadedFile] = useState<RegistryFile | null>(null);
  const [currentPolicy, setCurrentPolicy] = useState<PolicyDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Idle");
  const [transactionId, setTransactionId] = useState<string | null>(null);

  const contract = useMemo(() => getPolicy402Metadata(targetNetwork.id), [targetNetwork.id]);
  const contractAbi = contract.abi ?? POLICY_402_ABI;
  const connectedEvmAddress = normalizeAddress(evmAddress);
  const isOwner = Boolean(
    loadedFile && connectedEvmAddress && normalizeAddress(loadedFile.owner) === connectedEvmAddress,
  );
  const resourceDescriptor = loadedFile ? `api://files/${loadedFile.fileId}` : "";

  const canRevoke = Boolean(
    loadedFile &&
    currentPolicy &&
    currentPolicy.fileId === loadedFile.fileId &&
    isOwner &&
    !resolvingEvmAddress &&
    !!provider &&
    !!hederaAccountId &&
    !!contract.address &&
    !!contract.hederaContractId &&
    !!contractAbi &&
    !busy,
  );

  const handleLoadFile = async () => {
    const trimmed = fileIdInput.trim();
    if (!trimmed) {
      setError("Enter a FileRegistry file ID.");
      setStatus("File ID required");
      return;
    }
    if (!isFileId(trimmed)) {
      setError("File ID must be a 32-byte hex value beginning with 0x.");
      setStatus("Invalid File ID");
      return;
    }

    setLoading(true);
    setError(null);
    setStatus("Loading file...");
    setTransactionId(null);
    setCurrentPolicy(null);

    try {
      const file = await getRegistryFile(trimmed as Hex);
      if (!file) {
        setLoadedFile(null);
        setCurrentPolicy(null);
        setError("No FileRegistry record was found for this file ID.");
        setStatus("File not found");
        return;
      }

      setLoadedFile(file);
      const policy = await loadPolicyDetails(`api://files/${file.fileId}`, file.fileId, targetNetwork);
      if (!policy) {
        setCurrentPolicy(null);
        setStatus("No active/current policy to revoke");
        return;
      }

      setCurrentPolicy(policy);
      setStatus("Policy loaded");
    } catch (cause) {
      setLoadedFile(null);
      setCurrentPolicy(null);
      const parsed = cause instanceof Error ? cause.message : getParsedError(cause);
      setError(parsed);
      setStatus("Load failed");
      notification.error(parsed);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!loadedFile) {
      setError("Load a FileRegistry file before attempting revocation.");
      return;
    }
    if (!currentPolicy || currentPolicy.fileId !== loadedFile.fileId) {
      setError("The loaded file does not have an active/current Policy402 policy to revoke.");
      return;
    }
    if (!isOwner) {
      setError("The connected wallet must be the FileRegistry owner to revoke the policy.");
      return;
    }
    if (!provider || !hederaAccountId) {
      setError("Connect HashPack before revoking the policy.");
      return;
    }
    if (!contract.address || !contract.hederaContractId) {
      setError("Policy402 contract metadata is not available for this network.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus("Preparing Hedera revoke transaction...");
    setTransactionId(null);

    try {
      const result = await writeContractViaNativeProvider({
        provider,
        hederaAccountId,
        chainId: targetNetwork.id,
        contractAddress: contract.address,
        hederaContractId: contract.hederaContractId,
        abi: contractAbi,
        functionName: "revokePolicy",
        fnArgs: [currentPolicy.policyId, currentPolicy.version] as const,
      });

      setTransactionId(result.transactionId);
      setStatus("Waiting for Hedera confirmation...");
      await waitForHederaTransaction(result.transactionId, targetNetwork.id);

      const readBack = await loadPolicyDetails(resourceDescriptor, loadedFile.fileId, targetNetwork);
      if (!readBack) {
        setCurrentPolicy(null);
        setStatus("Confirmed: no active/current policy remains for this file");
        notification.success("Policy402 policy revoked");
        return;
      }

      setCurrentPolicy(readBack);
      setStatus("Transaction confirmed, but the policy is still active; review the on-chain state.");
      notification.warning("Policy remains active after revoke submission");
    } catch (cause) {
      const parsed = getParsedError(cause);
      setError(parsed);
      setStatus("Transaction failed");
      notification.error(parsed);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    setFileIdInput("");
    setLoadedFile(null);
    setCurrentPolicy(null);
    setError(null);
    setStatus("Idle");
    setLoading(false);
    setBusy(false);
    setTransactionId(null);
  };

  if (!isConnected) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-5 py-10">
        <div className="alert alert-warning">
          <span>Connect the wallet to revoke the current Policy402 version for an existing FileRegistry record.</span>
        </div>
        <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
          <h1 className="mb-2 text-3xl font-bold">Revoke Policy</h1>
          <p className="mb-5 text-base-content/70">
            Connect HashPack, load a file, and revoke its current Policy402 version using the frozen V1 contract flow.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void open({ view: "Connect", namespace: hederaNamespace }).catch(err => {
                notification.error(getParsedError(err));
              });
            }}
          >
            Connect HashPack
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-10">
      <div className="alert alert-info">
        <span>Policy402 V1 revoke flow for a FileRegistry file. No automatic transaction is sent.</span>
      </div>

      <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Revoke Current Policy</h1>
            <p className="text-base-content/70">Connected wallet: {hederaAccountId}</p>
            <p className="text-base-content/70">
              Connected EVM address: {resolvingEvmAddress ? "Resolving…" : (connectedEvmAddress ?? "Unavailable")}
            </p>
          </div>
          <span className="badge badge-success">{targetNetwork.name}</span>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
          <input
            value={fileIdInput}
            onChange={event => setFileIdInput(event.target.value)}
            placeholder="0x..."
            className="input input-bordered w-full"
            aria-label="File ID"
          />
          <button type="button" className="btn btn-primary" onClick={() => void handleLoadFile()} disabled={loading}>
            {loading ? "Loading..." : "Load File"}
          </button>
        </div>

        <div className="mt-4 flex gap-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleReset}>
            Reset
          </button>
        </div>

        {error && (
          <div className="alert alert-error mt-4">
            <span>{error}</span>
          </div>
        )}

        {status && status !== "Idle" && (
          <div className="mt-4 rounded-xl border border-base-300 bg-base-200 p-4">
            <div className="text-xs uppercase tracking-wide text-base-content/60">Status</div>
            <div className="mt-2 text-sm">{status}</div>
          </div>
        )}

        {loadedFile && (
          <div className="mt-6 space-y-5 rounded-xl border border-base-300 bg-base-200 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-base-content/60">File ID</div>
                <div className="mt-2 break-all text-sm">{loadedFile.fileId}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-base-content/60">File owner</div>
                <div className="mt-2 break-all text-sm">{loadedFile.owner}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-base-content/60">File name</div>
                <div className="mt-2 break-all text-sm">{loadedFile.name || "Unavailable"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-base-content/60">Connected EVM address</div>
                <div className="mt-2 break-all text-sm">{connectedEvmAddress ?? "Unavailable"}</div>
              </div>
            </div>

            <div className="alert alert-info mt-2">
              <span>
                {isOwner
                  ? "Connected wallet matches the registered file owner. This file can revoke its current Policy402 version."
                  : "Connected wallet is not the file owner. Connect the registered owner to continue."}
              </span>
            </div>

            {currentPolicy ? (
              <div className="space-y-4 rounded-xl border border-base-300 bg-base-100 p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-base-content/60">Policy ID</div>
                    <div className="mt-2 break-all text-sm">{currentPolicy.policyId}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-base-content/60">Current version</div>
                    <div className="mt-2 text-sm">{currentPolicy.version.toString()}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-base-content/60">Valid from</div>
                    <div className="mt-2 text-sm">{currentPolicy.validFrom.toString()}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-base-content/60">Valid until</div>
                    <div className="mt-2 text-sm">{currentPolicy.validUntil.toString()}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-base-content/60">Payment asset</div>
                    <div className="mt-2 text-sm">{currentPolicy.paymentAsset}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-base-content/60">Pay-to</div>
                    <div className="mt-2 break-all text-sm">{currentPolicy.payTo}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-base-content/60">Price tinybar</div>
                    <div className="mt-2 text-sm">{currentPolicy.priceTinybar.toString()}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-base-content/60">Policy hash</div>
                    <div className="mt-2 break-all text-sm">{currentPolicy.policyHash}</div>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-error"
                  onClick={() => void handleRevoke()}
                  disabled={!canRevoke}
                >
                  {busy ? "Revoking policy..." : "Revoke Current Policy"}
                </button>
              </div>
            ) : (
              <div className="alert alert-warning mt-2">
                <span>No active/current Policy402 policy exists for this file. There is nothing to revoke.</span>
              </div>
            )}
          </div>
        )}

        {(transactionId || status !== "Idle") && (
          <div className="mt-6 space-y-3 rounded-xl border border-base-300 bg-base-200 p-4">
            <div className="text-xs uppercase tracking-wide text-base-content/60">Status</div>
            <div className="text-sm">{status}</div>

            {transactionId && (
              <div>
                <div className="text-xs uppercase tracking-wide text-base-content/60">Transaction ID</div>
                <div className="break-all text-sm">{transactionId}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
