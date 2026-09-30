"use client";

import { useState } from "react";
import type { Address as AddressType, Chain } from "viem";
import { getAddress } from "viem";
import { CheckCircleIcon, DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import { BlockieAvatar } from "~~/components/scaffold-hbar";
import { useHederaAccountId } from "~~/hooks/scaffold-hbar";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-hbar";

type HederaAddressProps = {
  address?: AddressType;
  chain: Chain;
  format?: "short" | "long";
  disableAddressLink?: boolean;
  /** Horizontal alignment of the address block (default: centered). */
  align?: "start" | "center";
};

export const HederaAddress = ({ address, chain, format, disableAddressLink, align = "center" }: HederaAddressProps) => {
  const [copied, setCopied] = useState(false);
  const { accountId, isLoading } = useHederaAccountId(address, chain.id);

  if (!address) {
    return (
      <div className="flex items-center gap-2 animate-pulse">
        <div className="w-6 h-6 rounded-full bg-base-300" />
        <div className="w-32 h-4 rounded bg-base-300" />
      </div>
    );
  }

  const checkSumAddress = getAddress(address);
  const shortAddress = `${checkSumAddress.slice(0, 6)}...${checkSumAddress.slice(-4)}`;
  const displayAddress = format === "long" ? checkSumAddress : shortAddress;
  const explorerLink = getBlockExplorerAddressLink(chain, checkSumAddress);

  const handleCopy = () => {
    navigator.clipboard.writeText(checkSumAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 800);
  };

  const addressContent = <span className="text-sm font-normal">{displayAddress}</span>;

  const alignClass = align === "start" ? "items-start" : "items-center";

  return (
    <div className={`flex flex-col gap-1.5 ${alignClass}`}>
      <div className="flex items-center gap-1.5">
        <BlockieAvatar address={checkSumAddress} size={24} ensImage={null} />
        {disableAddressLink ? (
          addressContent
        ) : (
          <a href={explorerLink} target="_blank" rel="noreferrer" className="link no-underline hover:underline">
            {addressContent}
          </a>
        )}
        <button type="button" className="btn btn-ghost btn-xs p-0 min-h-0 h-auto" onClick={handleCopy}>
          {copied ? (
            <CheckCircleIcon className="w-4 h-4 text-success" />
          ) : (
            <DocumentDuplicateIcon className="w-4 h-4 opacity-70 hover:opacity-100" />
          )}
        </button>
      </div>
      {isLoading ? (
        <span className="text-xs text-base-content/60 animate-pulse">Resolving Hedera Account ID…</span>
      ) : accountId ? (
        <span className="text-xs text-base-content/80">Hedera Account ID: {accountId}</span>
      ) : null}
    </div>
  );
};
