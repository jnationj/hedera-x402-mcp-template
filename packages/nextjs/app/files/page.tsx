"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { ArrowPathIcon, ArrowUpTrayIcon, LockClosedIcon, LockOpenIcon } from "@heroicons/react/24/outline";
import { HederaAddress } from "~~/components/scaffold-hbar";
import { getFileRegistryAddress } from "~~/contracts/fileRegistryAbi";
import { useRegistryFileListing, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { formatTinybar } from "~~/utils/x402";

const Marketplace: NextPage = () => {
  const { targetNetwork } = useTargetNetwork();
  const registryAddress = getFileRegistryAddress(targetNetwork.id);

  const {
    data: files = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useRegistryFileListing(targetNetwork.id, { watch: true });

  const registryMissing = !registryAddress;
  const loadFailed = isError;

  return (
    <div className="flex flex-col grow w-full max-w-5xl mx-auto px-5 py-10">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold m-0">File Marketplace</h1>
          <p className="text-base-content/60 m-0 mt-1">
            Public files are free. Private files are pay-per-download in HBAR.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void refetch()}
            aria-label="Refresh"
            disabled={isLoading}
          >
            <ArrowPathIcon className="h-4 w-4" />
          </button>
          <Link href="/files/upload" className="btn btn-primary btn-sm gap-2">
            <ArrowUpTrayIcon className="h-4 w-4" /> Upload a file
          </Link>
        </div>
      </div>

      {registryMissing && (
        <div className="alert alert-warning">
          <span>
            FileRegistry is not deployed on {targetNetwork.name}. Deploy with{" "}
            <code className="text-xs">yarn hardhat:deploy --network hederaTestnet</code> first.
          </span>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-2xl bg-base-200 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && loadFailed && (
        <div className="alert alert-warning">
          <span>{error?.message ?? "Failed to load files from the registry"}</span>
        </div>
      )}

      {!isLoading && !loadFailed && !registryMissing && files.length === 0 && (
        <div className="bg-base-100 border border-base-300 rounded-2xl p-12 text-center">
          <p className="text-base-content/70 m-0 mb-4">No files registered yet.</p>
          <Link href="/files/upload" className="btn btn-primary btn-sm">
            Upload the first file
          </Link>
        </div>
      )}

      {!isLoading && !loadFailed && files.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {files.map(file => (
            <article
              key={file.fileId}
              className="bg-base-100 border border-base-300 rounded-2xl p-5 flex flex-col gap-3"
            >
              <Link
                href={`/files/${file.fileId}`}
                className="flex flex-col gap-3 flex-1 hover:opacity-90 transition-opacity"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold break-all line-clamp-2">{file.name}</span>
                  {file.isPublic ? (
                    <span className="badge badge-success badge-sm gap-1 shrink-0">
                      <LockOpenIcon className="h-3 w-3" /> Public
                    </span>
                  ) : (
                    <span className="badge badge-secondary badge-sm gap-1 shrink-0">
                      <LockClosedIcon className="h-3 w-3" /> Private
                    </span>
                  )}
                </div>
                <span className="text-xs text-base-content/50 break-all">{file.mimeType}</span>
                <div className="mt-auto pt-2 border-t border-base-200">
                  {file.isPublic ? (
                    <span className="text-sm font-medium text-success">Free download</span>
                  ) : (
                    <span className="text-sm font-medium">{formatTinybar(file.priceTinybar)} HBAR / download</span>
                  )}
                </div>
              </Link>
              <div className="text-xs text-base-content/60 border-t border-base-200 pt-2">
                <span className="text-base-content/50">Owner </span>
                <HederaAddress address={file.owner} chain={targetNetwork} disableAddressLink />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default Marketplace;
