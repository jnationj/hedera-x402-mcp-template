"use client";

import { blo } from "blo";
import type { Address } from "viem";

type BlockieAvatarProps = {
  address: Address;
  ensImage?: string | null;
  size?: number;
};

export const BlockieAvatar = ({ address, ensImage, size = 24 }: BlockieAvatarProps) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    className="rounded-full"
    src={ensImage || blo(address as `0x${string}`)}
    width={size}
    height={size}
    alt={`${address} avatar`}
  />
);
