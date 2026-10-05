"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { hederaNamespace } from "@hashgraph/hedera-wallet-connect";
import { useAppKit } from "@reown/appkit/react";
import type { Abi, Address, Hex } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";
import { POLICY_402_ABI } from "~~/contracts/policy402Abi";
import { useHederaEvmAddress, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { computeResourceServiceId, getCurrentPolicyForResource } from "~~/services/policy/server";
import { type RegistryFile, getRegistryFile } from "~~/services/registry/server";
import { waitForHederaTransaction, writeContractViaNativeProvider } from "~~/services/web3/hederaContractWrite";
import { useHederaWalletConnect } from "~~/services/web3/hederaWalletConnect";
import { getParsedError, notification } from "~~/utils/scaffold-hbar";

const FILE_ID_RE = /^0x[0-9a-fA-F]{64}$/;
const PAYMENT_ASSET = "0.0.0";
const ONE_DAY_SECONDS = 86_400;

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

export default function CreatePolicyPage() {
  const { open } = useAppKit();
  const { isConnected, hederaAccountId, provider } = useHederaWalletConnect();
  const { targetNetwork } = useTargetNetwork();
  const { evmAddress, isLoading: resolvingEvmAddress } = useHederaEvmAddress(hederaAccountId, targetNetwork.id);

  const [fileIdInput, setFileIdInput] = useState("");
  const [loadedFile, setLoadedFile] = useState<RegistryFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Idle");
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState<Hex | null>(null);
  const [validFromInput, setValidFromInput] = useState(String(Math.floor(Date.now() / 1000)));
  const [validUntilInput, setValidUntilInput] = useState(String(Math.floor(Date.now() / 1000) + ONE_DAY_SECONDS));

  const contract = useMemo(() => getPolicy402Metadata(targetNetwork.id), [targetNetwork.id]);
  const contractAbi = contract.abi ?? POLICY_402_ABI;
  const connectedEvmAddress = normalizeAddress(evmAddress);
  const isOwner = Boolean(
    loadedFile && connectedEvmAddress && normalizeAddress(loadedFile.owner) === connectedEvmAddress,
  );
  const resourceDescriptor = loadedFile ? `api://files/${loadedFile.fileId}` : "";
  const serviceId = useMemo(
    () => (resourceDescriptor ? computeResourceServiceId(resourceDescriptor) : null),
    [resourceDescriptor],
  );

  const canCreatePolicy = Boolean(
    loadedFile &&
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
    if (!FILE_ID_RE.test(trimmed)) {
      setError("File ID must be a 32-byte hex value beginning with 0x.");
      setStatus("Invalid File ID");
      return;
    }

    setLoading(true);
    setError(null);
    setStatus("Loading file...");
    setTransactionId(null);
    setPolicyId(null);

    try {
      const file = await getRegistryFile(trimmed as Hex);
      if (!file) {
        setLoadedFile(null);
        setError("No FileRegistry record was found for this file ID.");
        setStatus("File not found");
        return;
      }

      const existingPolicy = await getCurrentPolicyForResource(`api://files/${file.fileId}`);
      if (existingPolicy && existingPolicy.fileId === file.fileId) {
        setLoadedFile(file);
        setError(
          "A payment policy already exists for this file. Revoke or choose a different file before creating a new policy.",
        );
        setStatus("Policy already exists");
        return;
      }

      setLoadedFile(file);
      setStatus("File loaded");
    } catch (cause) {
      setLoadedFile(null);
      const parsed = cause instanceof Error ? cause.message : getParsedError(cause);
      setError(parsed);
      setStatus("Load failed");
      notification.error(parsed);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePolicy = async () => {
    if (!loadedFile) {
      setError("Load a FileRegistry file before creating a payment policy.");
      return;
    }
    if (!isOwner) {
      setError("The connected wallet must be the FileRegistry owner to create the payment policy.");
      return;
    }
    if (!provider || !hederaAccountId) {
      setError("Connect HashPack before creating the policy.");
      return;
    }
    if (!contract.address || !contract.hederaContractId) {
      setError("Policy402 contract metadata is not available for this network.");
      return;
    }

    const validFrom = Number(validFromInput);
    const validUntil = Number(validUntilInput);
    if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil)) {
      setError("Valid From and Valid Until must be valid Unix timestamps.");
      return;
    }
    if (validUntil <= validFrom) {
      setError("Valid Until must be later than Valid From.");
      return;
    }

    const existingPolicy = await getCurrentPolicyForResource(resourceDescriptor);
    if (existingPolicy && existingPolicy.fileId === loadedFile.fileId) {
      setError(
        "A payment policy already exists for this file. Revoke or choose a different file before creating a new policy.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    setTransactionId(null);
    setPolicyId(null);
    setStatus("Preparing Hedera transaction...");

    try {
      const result = await writeContractViaNativeProvider({
        provider,
        hederaAccountId,
        chainId: targetNetwork.id,
        contractAddress: contract.address,
        hederaContractId: contract.hederaContractId,
        abi: contractAbi,
        functionName: "createPolicy",
        fnArgs: [
          loadedFile.fileId,
          serviceId as Hex,
          BigInt(validFrom),
          BigInt(validUntil),
          PAYMENT_ASSET,
          loadedFile.payToAccountId,
          loadedFile.priceTinybar,
        ] as const,
      });

      setTransactionId(result.transactionId);
      setStatus("Waiting for Hedera confirmation...");
      await waitForHederaTransaction(result.transactionId, targetNetwork.id);

      const policyReadBack = await getCurrentPolicyForResource(resourceDescriptor);
      setPolicyId(policyReadBack?.policyId ?? null);
      setStatus(policyReadBack ? "Confirmed on Hedera Testnet" : "Confirmed; policy read-back unavailable");
      notification.success("Policy402 payment policy created");
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
    setError(null);
    setStatus("Idle");
    setLoading(false);
    setBusy(false);
    setTransactionId(null);
    setPolicyId(null);
    setValidFromInput(String(Math.floor(Date.now() / 1000)));
    setValidUntilInput(String(Math.floor(Date.now() / 1000) + ONE_DAY_SECONDS));
  };

  if (!isConnected) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-5 py-10">
        <div className="alert alert-warning">
          <span>Connect the wallet to create a Payment Policy for an existing FileRegistry record.</span>
        </div>
        <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
          <h1 className="mb-2 text-3xl font-bold">Create Payment Policy</h1>
          <p className="mb-5 text-base-content/70">
            Connect HashPack, load a file, and create a dynamic Policy402 policy for the resource descriptor.
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
        <span>Dynamic Policy402 creation for a FileRegistry file. No automatic transaction is sent.</span>
      </div>

      <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Create Payment Policy</h1>
            <p className="text-base-content/70">Connected wallet: {hederaAccountId}</p>
            <p className="text-base-content/70">
              Connected EVM address: {resolvingEvmAddress ? "Resolving…" : (connectedEvmAddress ?? "Unavailable")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/revokepolicy" className="btn btn-secondary btn-sm">
              Revoke Policy
            </Link>
            <span className="badge badge-success">{targetNetwork.name}</span>
          </div>
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
                <div className="text-xs uppercase tracking-wide text-base-content/60">Owner EVM address</div>
                <div className="mt-2 break-all text-sm">{loadedFile.owner}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-base-content/60">Pay-to account</div>
                <div className="mt-2 break-all text-sm">{loadedFile.payToAccountId}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-base-content/60">Price tinybar</div>
                <div className="mt-2 text-sm">{loadedFile.priceTinybar.toString()}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-base-content/60">Payment asset</div>
                <div className="mt-2 text-sm">{PAYMENT_ASSET}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-base-content/60">File name</div>
                <div className="mt-2 break-all text-sm">{loadedFile.name || "Unavailable"}</div>
              </div>
            </div>

            <div className="alert mt-2">
              <span>
                {isOwner
                  ? "Connected wallet matches the registered file owner. This file is eligible for a new policy."
                  : "Connected wallet is not the file owner. Connect the registered owner to continue."}
              </span>
            </div>

            {resourceDescriptor && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-base-300 bg-base-100 p-4">
                  <div className="text-xs uppercase tracking-wide text-base-content/60">Resource descriptor</div>
                  <div className="mt-2 break-all text-sm">{resourceDescriptor}</div>
                </div>
                <div className="rounded-xl border border-base-300 bg-base-100 p-4">
                  <div className="text-xs uppercase tracking-wide text-base-content/60">Service ID</div>
                  <div className="mt-2 break-all text-sm">{serviceId ?? "Unavailable"}</div>
                </div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <label className="form-control">
                <span className="label-text mb-2 text-xs uppercase tracking-wide text-base-content/60">Valid From</span>
                <input
                  type="number"
                  value={validFromInput}
                  onChange={event => setValidFromInput(event.target.value)}
                  className="input input-bordered w-full"
                />
              </label>
              <label className="form-control">
                <span className="label-text mb-2 text-xs uppercase tracking-wide text-base-content/60">
                  Valid Until
                </span>
                <input
                  type="number"
                  value={validUntilInput}
                  onChange={event => setValidUntilInput(event.target.value)}
                  className="input input-bordered w-full"
                />
              </label>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleCreatePolicy()}
              disabled={!canCreatePolicy}
            >
              {busy ? "Creating policy..." : "Create Payment Policy"}
            </button>
          </div>
        )}

        {(transactionId || policyId || status !== "Idle") && (
          <div className="mt-6 space-y-3 rounded-xl border border-base-300 bg-base-200 p-4">
            <div className="text-xs uppercase tracking-wide text-base-content/60">Status</div>
            <div className="text-sm">{status}</div>

            {transactionId && (
              <div>
                <div className="text-xs uppercase tracking-wide text-base-content/60">Transaction ID</div>
                <div className="break-all text-sm">{transactionId}</div>
              </div>
            )}

            {policyId && (
              <div>
                <div className="text-xs uppercase tracking-wide text-base-content/60">Policy ID</div>
                <div className="break-all text-sm">{policyId}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
