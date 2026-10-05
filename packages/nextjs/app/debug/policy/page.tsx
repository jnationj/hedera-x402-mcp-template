"use client";

import { useEffect, useState } from "react";
import { hederaNamespace } from "@hashgraph/hedera-wallet-connect";
import { useAppKit } from "@reown/appkit/react";
import type { Abi, Address, Hex } from "viem";
import { encodeAbiParameters, keccak256, toBytes, toHex } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";
import { useHederaEvmAddress } from "~~/hooks/scaffold-hbar/useHederaEvmAddress";
import { waitForHederaTransaction, writeContractViaNativeProvider } from "~~/services/web3/hederaContractWrite";
import { useHederaWalletConnect } from "~~/services/web3/hederaWalletConnect";
import { getParsedError, notification } from "~~/utils/scaffold-hbar";

const CHAIN_ID = 296;
const POLICY_LABEL = "Policy402:v1";
const FILE_ID = "0xcd8b3ab668dcdab153262110304afa7356bce4396f5f12c9bff82bdc32bf10be" as const;
const RESOURCE_DESCRIPTOR = `api://files/${FILE_ID}`;
const SERVICE_ID = keccak256(toBytes(RESOURCE_DESCRIPTOR)) as Hex;
const PAY_TO = "0.0.10798563";
const PAYMENT_ASSET = "0.0.0";
const PRICE_TINYBAR = 180000000n;

type FileOwnerCheck = { status: "loading" } | { status: "ready"; owner: string } | { status: "error"; message: string };

function normalizeEvmAddress(value: string | null | undefined): string | null {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  return value.toLowerCase();
}

function getPolicy402Metadata(): { address?: Address; hederaContractId?: string; abi?: Abi } {
  const chainContracts = (
    deployedContracts as Record<number, Record<string, { address?: string; hederaContractId?: string; abi?: Abi }>>
  )[CHAIN_ID];
  const contract = chainContracts?.Policy402;
  return {
    address: contract?.address as Address | undefined,
    hederaContractId: contract?.hederaContractId,
    abi: contract?.abi as Abi | undefined,
  };
}

function getPolicyId(serviceId: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "bytes" }, { type: "bytes32" }], [toHex(toBytes(POLICY_LABEL)), serviceId]),
  ) as Hex;
}

export default function Policy402CreateDevPage() {
  const { open } = useAppKit();
  const { isConnected, hederaAccountId, provider } = useHederaWalletConnect();
  const { evmAddress, isLoading: isResolvingEvmAddress } = useHederaEvmAddress(hederaAccountId, CHAIN_ID);
  const [busy, setBusy] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Awaiting wallet confirmation");
  const [policyId, setPolicyId] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileOwnerCheck, setFileOwnerCheck] = useState<FileOwnerCheck>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    const loadFileOwner = async () => {
      try {
        const response = await fetch(`/api/files/${FILE_ID}`, { cache: "no-store" });
        const body = (await response.json()) as { file?: { owner?: string }; error?: string };
        const owner = normalizeEvmAddress(body.file?.owner);
        if (!response.ok || !owner) {
          throw new Error(body.error ?? "Could not read the registered FileRegistry owner.");
        }
        if (!cancelled) setFileOwnerCheck({ status: "ready", owner });
      } catch (cause) {
        if (!cancelled) {
          setFileOwnerCheck({
            status: "error",
            message: cause instanceof Error ? cause.message : "Could not verify the registered file owner.",
          });
        }
      }
    };

    void loadFileOwner();
    return () => {
      cancelled = true;
    };
  }, []);

  const contract = getPolicy402Metadata();
  const validFrom = Math.floor(Date.now() / 1000);
  const validUntil = validFrom + 86400;
  const connectedEvmAddress = normalizeEvmAddress(evmAddress);
  const isFileOwner =
    isConnected &&
    fileOwnerCheck.status === "ready" &&
    connectedEvmAddress !== null &&
    connectedEvmAddress === fileOwnerCheck.owner;

  const handleCreate = async () => {
    if (!isConnected || !provider || !hederaAccountId) {
      setError("Connect HashPack on Hedera Testnet before creating this policy.");
      return;
    }

    if (fileOwnerCheck.status !== "ready" || isResolvingEvmAddress || !connectedEvmAddress) {
      setError("The connected wallet EVM address and FileRegistry owner must be verified before creating this policy.");
      return;
    }

    if (connectedEvmAddress !== fileOwnerCheck.owner) {
      setError("The connected wallet is not the owner of this FileRegistry file. Connect the registered owner wallet.");
      return;
    }

    if (!contract.address || !contract.hederaContractId || !contract.abi) {
      setError("Policy402 contract metadata is not available for Hedera Testnet.");
      return;
    }

    setBusy(true);
    setError(null);
    setTransactionId(null);
    setPolicyId(null);
    setStatus("Preparing Hedera transaction...");

    try {
      const fnArgs = [
        FILE_ID,
        SERVICE_ID,
        BigInt(validFrom),
        BigInt(validUntil),
        PAYMENT_ASSET,
        PAY_TO,
        PRICE_TINYBAR,
      ] as const;

      const result = await writeContractViaNativeProvider({
        provider,
        hederaAccountId,
        chainId: CHAIN_ID,
        contractAddress: contract.address,
        hederaContractId: contract.hederaContractId,
        abi: contract.abi,
        functionName: "createPolicy",
        fnArgs,
      });

      setTransactionId(result.transactionId);
      setStatus("Waiting for Hedera confirmation...");
      await waitForHederaTransaction(result.transactionId, CHAIN_ID);
      const nextPolicyId = getPolicyId(SERVICE_ID as Hex);
      setPolicyId(nextPolicyId);
      setStatus("Confirmed on Hedera Testnet");
      notification.success("Policy402 policy created");
    } catch (e) {
      const parsed = getParsedError(e);
      setError(parsed);
      setStatus("Transaction failed");
      notification.error(parsed);
    } finally {
      setBusy(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-5 py-10">
        <div className="alert alert-warning">
          <span>DEV/DEBUG: Policy402 policy creation is temporary and browser-native.</span>
        </div>
        <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
          <h1 className="mb-2 text-3xl font-bold">DEV Policy402 Create</h1>
          <p className="mb-5 text-base-content/70">
            Wallet connection required. Connect the HashPack account that owns the registered FileRegistry file to
            continue.
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-10">
      <div className="alert alert-info">
        <span>DEV/DEBUG: temporary Policy402 creation flow for the private test file.</span>
      </div>

      <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">DEV Policy402 Create</h1>
            <p className="text-base-content/70">Connected wallet: {hederaAccountId}</p>
            <p className="text-base-content/70">
              Connected EVM address: {isResolvingEvmAddress ? "Resolving…" : (evmAddress ?? "Unavailable")}
            </p>
          </div>
          <span className="badge badge-success">Hedera Testnet</span>
        </div>

        {fileOwnerCheck.status === "loading" && <div className="alert alert-info">Reading the FileRegistry owner…</div>}
        {fileOwnerCheck.status === "error" && <div className="alert alert-error">{fileOwnerCheck.message}</div>}
        {fileOwnerCheck.status === "ready" && (
          <p className="text-sm text-base-content/70">Registered FileRegistry owner: {fileOwnerCheck.owner}</p>
        )}
        {isConnected && isResolvingEvmAddress && (
          <div className="alert alert-info">Resolving the connected Hedera account&apos;s EVM address…</div>
        )}
        {isConnected && fileOwnerCheck.status === "ready" && !isResolvingEvmAddress && !connectedEvmAddress && (
          <div className="alert alert-error">
            Could not resolve the connected Hedera account&apos;s EVM address. Policy creation stays disabled until the
            owner can be verified.
          </div>
        )}
        {isConnected &&
          fileOwnerCheck.status === "ready" &&
          !isResolvingEvmAddress &&
          connectedEvmAddress &&
          !isFileOwner && (
            <div className="alert alert-error">
              Connected wallet is not the file owner. Connect the registered FileRegistry owner account to enable policy
              creation.
            </div>
          )}
        {isFileOwner && <div className="alert alert-success">Connected wallet matches the registered file owner.</div>}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-base-300 bg-base-200 p-4">
            <div className="text-xs uppercase tracking-wide text-base-content/60">Resource descriptor</div>
            <div className="mt-2 break-all text-sm">{RESOURCE_DESCRIPTOR}</div>
          </div>
          <div className="rounded-xl border border-base-300 bg-base-200 p-4">
            <div className="text-xs uppercase tracking-wide text-base-content/60">Service ID</div>
            <div className="mt-2 break-all text-sm">{SERVICE_ID}</div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-base-300 bg-base-200 p-4">
            <div className="text-xs uppercase tracking-wide text-base-content/60">Valid from</div>
            <div className="mt-2 text-sm">{validFrom}</div>
          </div>
          <div className="rounded-xl border border-base-300 bg-base-200 p-4">
            <div className="text-xs uppercase tracking-wide text-base-content/60">Valid until</div>
            <div className="mt-2 text-sm">{validUntil}</div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-base-300 bg-base-200 p-4">
            <div className="text-xs uppercase tracking-wide text-base-content/60">payTo</div>
            <div className="mt-2 text-sm">{PAY_TO}</div>
          </div>
          <div className="rounded-xl border border-base-300 bg-base-200 p-4">
            <div className="text-xs uppercase tracking-wide text-base-content/60">priceTinybar</div>
            <div className="mt-2 text-sm">{PRICE_TINYBAR.toString()}</div>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary mt-6"
          onClick={() => {
            void handleCreate();
          }}
          disabled={
            busy ||
            !isFileOwner ||
            isResolvingEvmAddress ||
            fileOwnerCheck.status !== "ready" ||
            !contract.address ||
            !contract.hederaContractId ||
            !contract.abi
          }
        >
          {busy ? "Creating policy..." : "Create Policy"}
        </button>

        {error && (
          <div className="alert alert-error mt-6">
            <span>{error}</span>
          </div>
        )}

        {(transactionId || policyId || status) && (
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
