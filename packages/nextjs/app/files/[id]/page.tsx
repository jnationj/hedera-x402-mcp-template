"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { NextPage } from "next";
import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  CommandLineIcon,
  LockClosedIcon,
  LockOpenIcon,
} from "@heroicons/react/24/outline";
import { HederaAddress } from "~~/components/scaffold-hbar";
import {
  FILE_REGISTRY_ABI,
  getFileRegistryAddress,
  getFileRegistryHederaContractId,
} from "~~/contracts/fileRegistryAbi";
import { useHederaEvmAddress, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { waitForHederaTransaction, writeContractViaNativeProvider } from "~~/services/web3/hederaContractWrite";
import { useHederaWalletConnect } from "~~/services/web3/hederaWalletConnect";
import { payAndGetDownloadUrl } from "~~/services/x402/client";
import { getParsedError, notification } from "~~/utils/scaffold-hbar";
import { formatTinybar, hbarToTinybar } from "~~/utils/x402";

type PublicFile = {
  fileId: string;
  name: string;
  mimeType: string;
  isPublic: boolean;
  priceTinybar: string;
  owner: string;
  payToAccountId: string;
  contentHash: string;
};

const FileDetail: NextPage = () => {
  const { id } = useParams<{ id: string }>();
  const { hederaAccountId, hasHederaSession, isConnected, provider } = useHederaWalletConnect();
  const { targetNetwork } = useTargetNetwork();
  const { evmAddress: ownerEvmAddress } = useHederaEvmAddress(hederaAccountId, targetNetwork.id);

  const canPay = isConnected && hasHederaSession && !!hederaAccountId;

  const [file, setFile] = useState<PublicFile | null>(null);
  const [statusLoad, setStatusLoad] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const registryAddress = getFileRegistryAddress(targetNetwork.id);
  const registryHederaContractId = getFileRegistryHederaContractId(targetNetwork.id);
  const isOwner = !!ownerEvmAddress && !!file && ownerEvmAddress.toLowerCase() === file.owner.toLowerCase();

  const resourceUrl = useMemo(
    () => (typeof window !== "undefined" && id ? `${window.location.origin}/api/files/${id}/download` : ""),
    [id],
  );

  const load = useCallback(async () => {
    if (!id) return;
    setStatusLoad("loading");
    try {
      const res = await fetch(`/api/files/${id}`);
      const data = (await res.json()) as { file?: PublicFile; error?: string };
      if (!res.ok || !data.file) {
        setMessage(data.error ?? "File not found");
        setStatusLoad("error");
        return;
      }
      setFile(data.file);
      setStatusLoad("ready");
    } catch {
      setMessage("Could not reach the server");
      setStatusLoad("error");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const openUrl = (url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    a.click();
  };

  const handleFreeDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(resourceUrl);
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Download failed");
      openUrl(data.url);
      notification.success("Download ready");
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setDownloading(false);
    }
  };

  const handlePaidDownload = async () => {
    if (!canPay || !hederaAccountId) {
      notification.error("Connect HashPack with an ECDSA account to pay in-browser.");
      return;
    }
    setDownloading(true);
    setReceipt(null);
    const toastId = notification.loading("Signing x402 payment…");
    try {
      const result = await payAndGetDownloadUrl({
        resourceUrl,
        hederaAccountId,
      });
      notification.remove(toastId);
      notification.success("Payment settled — download ready");
      if (result.transaction) setReceipt(result.transaction);
      openUrl(result.url);
    } catch (e) {
      notification.remove(toastId);
      notification.error(getParsedError(e));
    } finally {
      setDownloading(false);
    }
  };

  if (statusLoad === "loading") {
    return (
      <div className="w-full max-w-3xl mx-auto px-5 py-10">
        <div className="h-48 rounded-2xl bg-base-200 animate-pulse" />
      </div>
    );
  }

  if (statusLoad === "error" || !file) {
    return (
      <div className="w-full max-w-3xl mx-auto px-5 py-10">
        <Link href="/files" className="btn btn-ghost btn-sm gap-1 mb-6">
          <ArrowLeftIcon className="h-4 w-4" /> Marketplace
        </Link>
        <div className="alert alert-warning">
          <span>{message}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-5 py-10">
      <Link href="/files" className="btn btn-ghost btn-sm gap-1 mb-6">
        <ArrowLeftIcon className="h-4 w-4" /> Marketplace
      </Link>

      <div className="bg-base-100 border border-base-300 rounded-2xl p-6 sm:p-8 flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold m-0 min-w-0 break-words leading-snug">{file.name}</h1>
          {file.isPublic ? (
            <span className="badge badge-success gap-1 shrink-0 self-start">
              <LockOpenIcon className="h-3 w-3" /> Public
            </span>
          ) : (
            <span className="badge badge-secondary gap-1 shrink-0 self-start">
              <LockClosedIcon className="h-3 w-3" /> Private
            </span>
          )}
        </div>

        <div className="flex flex-col gap-5 text-sm">
          <FileDetailField label="Type" value={file.mimeType} />
          <FileDetailField
            label="Price"
            value={file.isPublic ? "Free" : `${formatTinybar(file.priceTinybar)} HBAR / download`}
            emphasize
          />
          <FileDetailField label="Owner">
            <HederaAddress address={file.owner as `0x${string}`} chain={targetNetwork} align="start" />
          </FileDetailField>
          {!file.isPublic && <FileDetailField label="Pays to" value={file.payToAccountId} mono />}
          <FileDetailField label="SHA-256" value={file.contentHash} mono boxed />
        </div>

        <div className="border-t border-base-200 pt-5">
          {file.isPublic ? (
            <button className="btn btn-primary w-full gap-2" disabled={downloading} onClick={handleFreeDownload}>
              {downloading ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <ArrowDownTrayIcon className="h-4 w-4" />
              )}
              Download (free)
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                className="btn btn-primary w-full gap-2"
                disabled={downloading || !canPay}
                onClick={handlePaidDownload}
              >
                {downloading ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <ArrowDownTrayIcon className="h-4 w-4" />
                )}
                Pay {formatTinybar(file.priceTinybar)} HBAR & download
              </button>
              {!isConnected && (
                <span className="text-xs text-center text-base-content/50">
                  Connect HashPack in the header to pay for this download.
                </span>
              )}
              {isConnected && !hasHederaSession && (
                <span className="text-xs text-center text-warning">
                  Reconnect HashPack to approve native Hedera signing for payments.
                </span>
              )}
              {isConnected && hasHederaSession && !hederaAccountId && (
                <span className="text-xs text-center text-warning">
                  HashPack did not provide a Hedera account ID. Make sure your wallet supports the Hedera namespace.
                </span>
              )}
            </div>
          )}

          {receipt && <p className="text-xs text-center text-success mt-3 m-0 break-all">Settled · tx {receipt}</p>}
        </div>
      </div>

      {!file.isPublic && <AgentSnippet fileId={file.fileId} resourceUrl={resourceUrl} />}

      {isOwner && registryAddress && (
        <OwnerControls
          file={file}
          onUpdated={load}
          write={async (functionName, args) => {
            if (!provider || !hederaAccountId || !registryAddress) {
              throw new Error("Connect HashPack to manage this file on-chain.");
            }
            const { transactionId } = await writeContractViaNativeProvider({
              provider,
              hederaAccountId,
              chainId: targetNetwork.id,
              contractAddress: registryAddress,
              hederaContractId: registryHederaContractId,
              abi: FILE_REGISTRY_ABI,
              functionName,
              fnArgs: args,
            });
            await waitForHederaTransaction(transactionId, targetNetwork.id);
          }}
        />
      )}
    </div>
  );
};

const FileDetailField = ({
  label,
  value,
  children,
  emphasize,
  mono,
  boxed,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
  emphasize?: boolean;
  mono?: boolean;
  boxed?: boolean;
}) => (
  <div className="flex flex-col gap-2">
    <span className="text-xs font-medium uppercase tracking-wide text-base-content/50">{label}</span>
    {children ?? (
      <span
        className={[
          emphasize ? "font-medium text-base" : "",
          mono ? "font-mono text-xs break-all" : "break-words",
          boxed ? "bg-base-200 rounded-lg px-3 py-2 block" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </span>
    )}
  </div>
);

/** Copy-paste command for paying via the Node agent script (machine-to-machine flow). */
const AgentSnippet = ({ fileId, resourceUrl }: { fileId: string; resourceUrl: string }) => {
  const command = `RESOURCE_URL="${resourceUrl}" \\\n  BUYER_ACCOUNT_ID=0.0.xxxx BUYER_PRIVATE_KEY=0x... \\\n  yarn x402:buy`;
  return (
    <div className="bg-base-100 border border-base-300 rounded-2xl p-6 sm:p-8 mt-5">
      <div className="flex items-center gap-2 mb-2">
        <CommandLineIcon className="h-4 w-4" />
        <span className="font-semibold text-sm">Pay from an agent / script</span>
      </div>
      <p className="text-xs text-base-content/60 m-0 mb-3">
        Any x402 client can pay for file <span className="font-mono break-all">{fileId}</span>. Example with the bundled
        Node buyer:
      </p>
      <pre className="bg-base-200 rounded-lg p-3 text-xs overflow-x-auto m-0">
        <code>{command}</code>
      </pre>
    </div>
  );
};

/** Owner-only price / visibility controls. */
const OwnerControls = ({
  file,
  write,
  onUpdated,
}: {
  file: PublicFile;
  write: (functionName: "setPrice" | "setVisibility", args: readonly unknown[]) => Promise<void>;
  onUpdated: () => void;
}) => {
  const [priceHbar, setPriceHbar] = useState(formatTinybar(file.priceTinybar));
  const [busy, setBusy] = useState<"price" | "visibility" | null>(null);

  const updatePrice = async () => {
    setBusy("price");
    const toastId = notification.loading("Updating price…");
    try {
      await write("setPrice", [file.fileId as `0x${string}`, hbarToTinybar(priceHbar)]);
      notification.remove(toastId);
      notification.success("Price updated");
      onUpdated();
    } catch (e) {
      notification.remove(toastId);
      notification.error(getParsedError(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleVisibility = async () => {
    setBusy("visibility");
    const toastId = notification.loading("Updating visibility…");
    try {
      await write("setVisibility", [file.fileId as `0x${string}`, !file.isPublic]);
      notification.remove(toastId);
      notification.success("Visibility updated");
      onUpdated();
    } catch (e) {
      notification.remove(toastId);
      notification.error(getParsedError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-base-100 border border-base-300 rounded-2xl p-6 sm:p-8 mt-5">
      <span className="font-semibold text-sm">Owner controls</span>
      <div className="flex flex-col sm:flex-row gap-3 mt-4">
        <div className="join flex-1">
          <input
            type="text"
            inputMode="decimal"
            className="input input-bordered join-item w-full"
            value={priceHbar}
            onChange={e => setPriceHbar(e.target.value)}
            aria-label="New price in HBAR"
          />
          <button className="btn btn-outline join-item" disabled={busy !== null} onClick={updatePrice}>
            {busy === "price" ? <span className="loading loading-spinner loading-sm" /> : "Set price"}
          </button>
        </div>
        <button className="btn btn-outline" disabled={busy !== null} onClick={toggleVisibility}>
          {busy === "visibility" ? (
            <span className="loading loading-spinner loading-sm" />
          ) : file.isPublic ? (
            "Make private"
          ) : (
            "Make public"
          )}
        </button>
      </div>
    </div>
  );
};

export default FileDetail;
