"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { NextPage } from "next";
import { type Address, type Hex, toHex } from "viem";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import {
  FILE_REGISTRY_ABI,
  computeFileId,
  getFileRegistryAddress,
  getFileRegistryHederaContractId,
} from "~~/contracts/fileRegistryAbi";
import { useHederaEvmAddress, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { waitForHederaTransaction, writeContractViaNativeProvider } from "~~/services/web3/hederaContractWrite";
import { useHederaWalletConnect } from "~~/services/web3/hederaWalletConnect";
import { getParsedError, notification } from "~~/utils/scaffold-hbar";
import { hbarToTinybar } from "~~/utils/x402";

const HEDERA_ID_RE = /^\d+\.\d+\.\d+$/;

/** SHA-256 of a file's bytes, as a `bytes32` hex string for on-chain integrity. */
async function sha256Hex(file: File): Promise<Hex> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return toHex(new Uint8Array(digest));
}

const UploadFile: NextPage = () => {
  const router = useRouter();
  const { isConnected, hederaAccountId, hasHederaSession, provider } = useHederaWalletConnect();
  const { targetNetwork } = useTargetNetwork();
  const { evmAddress, isLoading: resolvingEvmAddress } = useHederaEvmAddress(hederaAccountId, targetNetwork.id);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [priceHbar, setPriceHbar] = useState("1");
  const [payTo, setPayTo] = useState("");
  const [busy, setBusy] = useState(false);

  const registryAddress = getFileRegistryAddress(targetNetwork.id);
  const registryHederaContractId = getFileRegistryHederaContractId(targetNetwork.id);
  const effectivePayTo = payTo || hederaAccountId || "";
  const ownerEvmAddress = evmAddress as Address | undefined;

  const priceError = useMemo(() => {
    if (isPublic) return null;
    try {
      const tinybar = hbarToTinybar(priceHbar);
      if (tinybar <= 0n) return "Private files need a price above 0";
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid price";
    }
  }, [isPublic, priceHbar]);

  const canSubmit =
    !!file &&
    !!name.trim() &&
    !!hederaAccountId &&
    !!ownerEvmAddress &&
    !!registryAddress &&
    !priceError &&
    !busy &&
    hasHederaSession;

  const handleFile = (next: File | null) => {
    setFile(next);
    if (next && !name.trim()) setName(next.name);
  };

  const handleSubmit = async () => {
    if (!file || !hederaAccountId || !ownerEvmAddress || !registryAddress || !provider) return;

    const payToTrimmed = effectivePayTo.trim();
    if (!HEDERA_ID_RE.test(payToTrimmed)) {
      notification.error("Enter a valid payout account id (e.g. 0.0.1234)");
      return;
    }

    let priceTinybar: bigint;
    try {
      priceTinybar = isPublic ? 0n : hbarToTinybar(priceHbar);
    } catch (e) {
      notification.error(e instanceof Error ? e.message : "Invalid price");
      return;
    }

    setBusy(true);
    const toastId = notification.loading("Requesting upload URL…");
    try {
      const uploadRes = await fetch("/api/files/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), mimeType: file.type || "application/octet-stream" }),
      });
      const uploadData = (await uploadRes.json()) as {
        objectKey?: string;
        uploadUrl?: string;
        contentType?: string;
        error?: string;
      };
      if (!uploadRes.ok || !uploadData.uploadUrl || !uploadData.objectKey) {
        throw new Error(uploadData.error ?? "Failed to get upload URL");
      }

      notification.remove(toastId);
      const hashToastId = notification.loading("Uploading file…");
      const contentHash = await sha256Hex(file);
      const putRes = await fetch(uploadData.uploadUrl, {
        method: "PUT",
        headers: { "content-type": uploadData.contentType ?? "application/octet-stream" },
        body: file,
      });
      notification.remove(hashToastId);
      if (!putRes.ok) throw new Error(`Upload failed (status ${putRes.status})`);

      const registerToastId = notification.loading("Confirm registration in your wallet…");
      const objectKey = uploadData.objectKey;
      const registerArgs = [
        objectKey,
        payToTrimmed,
        priceTinybar,
        isPublic,
        contentHash,
        name.trim(),
        file.type || "application/octet-stream",
      ] as const;

      const { transactionId } = await writeContractViaNativeProvider({
        provider,
        hederaAccountId,
        chainId: targetNetwork.id,
        contractAddress: registryAddress,
        hederaContractId: registryHederaContractId,
        abi: FILE_REGISTRY_ABI,
        functionName: "registerFile",
        fnArgs: registerArgs,
      });
      await waitForHederaTransaction(transactionId, targetNetwork.id);
      notification.remove(registerToastId);
      notification.success("File registered!");

      const fileId = computeFileId(ownerEvmAddress, objectKey);
      router.push(`/files/${fileId}`);
    } catch (e) {
      notification.remove(toastId);
      notification.error(getParsedError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col grow w-full max-w-2xl mx-auto px-5 py-10">
      <h1 className="text-3xl font-bold m-0 mb-1">Upload a file</h1>
      <p className="text-base-content/60 m-0 mb-8">
        Files go to private storage. You register pricing and visibility on-chain; private files are paid per download.
      </p>

      {!registryAddress && (
        <div className="alert alert-warning mb-6">
          <span>
            FileRegistry is not deployed on {targetNetwork.name}. Run <code>yarn deploy</code> (or set{" "}
            <code>NEXT_PUBLIC_FILE_REGISTRY_ADDRESS</code>) and reload.
          </span>
        </div>
      )}

      <div className="bg-base-100 border border-base-300 rounded-2xl p-6 flex flex-col gap-5">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">File</span>
          <input
            type="file"
            className="file-input file-input-bordered w-full"
            onChange={e => handleFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Display name</span>
          <input
            type="text"
            className="input input-bordered w-full"
            placeholder="my-dataset.csv"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </label>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium">Visibility</span>
            <p className="text-xs text-base-content/50 m-0">
              {isPublic ? "Anyone can download for free." : "Buyers pay per download."}
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm">{isPublic ? "Public" : "Private"}</span>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={!isPublic}
              onChange={e => setIsPublic(!e.target.checked)}
            />
          </label>
        </div>

        {!isPublic && (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Price per download (HBAR)</span>
            <input
              type="text"
              inputMode="decimal"
              className={`input input-bordered w-full ${priceError ? "input-error" : ""}`}
              value={priceHbar}
              onChange={e => setPriceHbar(e.target.value)}
            />
            {priceError && <span className="text-xs text-error">{priceError}</span>}
            <span className="text-xs text-base-content/50">
              Tip: there is no &quot;only me&quot; option — make a file effectively private by pricing it very high.
            </span>
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Payout account (receives payments)</span>
          <input
            type="text"
            className="input input-bordered w-full"
            placeholder={hederaAccountId ?? "0.0.1234"}
            value={payTo}
            onChange={e => setPayTo(e.target.value)}
          />
          <span className="text-xs text-base-content/50">
            {hederaAccountId ? `Defaults to your account ${hederaAccountId}` : "Your Hedera account id (0.0.x)"}
          </span>
        </label>

        <button className="btn btn-primary gap-2" disabled={!canSubmit} onClick={handleSubmit}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : <ArrowUpTrayIcon className="h-4 w-4" />}
          {busy ? "Working…" : "Upload & register"}
        </button>
        {!isConnected && (
          <span className="text-xs text-center text-base-content/50">
            Connect HashPack in the header to register files.
          </span>
        )}
        {isConnected && !hasHederaSession && (
          <span className="text-xs text-center text-warning">
            Reconnect HashPack to approve native Hedera signing for registration.
          </span>
        )}
        {isConnected && hasHederaSession && !ownerEvmAddress && !resolvingEvmAddress && (
          <span className="text-xs text-center text-warning">
            This account has no EVM alias on {targetNetwork.name}. Use an ECDSA testnet account.
          </span>
        )}
      </div>
    </div>
  );
};

export default UploadFile;
