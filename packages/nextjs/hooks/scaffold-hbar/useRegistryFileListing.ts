import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { usePublicClient } from "wagmi";
import { FILE_REGISTRY_ABI, getFileRegistryAddress } from "~~/contracts/fileRegistryAbi";
import scaffoldConfig from "~~/scaffold.config";

/** Matches {@link FileRegistry.MAX_PAGE_SIZE}. */
const MAX_PAGE_SIZE = 50;

export type RegistryListedFile = {
  fileId: Hex;
  name: string;
  mimeType: string;
  isPublic: boolean;
  priceTinybar: string;
  owner: Address;
  payToAccountId: string;
};

type FileItem = {
  owner: Address;
  payToAccountId: string;
  priceTinybar: bigint;
  isPublic: boolean;
  objectKey: string;
  contentHash: Hex;
  name: string;
  mimeType: string;
  exists: boolean;
};

/**
 * List marketplace files via on-chain pagination (`getFileCount` + `getFiles`).
 * Avoids `eth_getLogs`, which Hedera JSON-RPC limits to a 7-day window.
 */
export function useRegistryFileListing(chainId: number, options?: { enabled?: boolean; watch?: boolean }) {
  const publicClient = usePublicClient({ chainId });
  const address = getFileRegistryAddress(chainId);
  const enabled = (options?.enabled ?? true) && Boolean(publicClient && address);

  return useQuery({
    queryKey: ["registryFileListing", chainId, address],
    enabled,
    refetchInterval: options?.watch ? scaffoldConfig.pollingInterval : false,
    queryFn: async (): Promise<RegistryListedFile[]> => {
      if (!publicClient || !address) return [];

      const count = await publicClient.readContract({
        address,
        abi: FILE_REGISTRY_ABI,
        functionName: "getFileCount",
      });

      const total = Number(count);
      if (total === 0) return [];

      const files: RegistryListedFile[] = [];
      for (let offset = 0; offset < total; offset += MAX_PAGE_SIZE) {
        const [ids, items] = await publicClient.readContract({
          address,
          abi: FILE_REGISTRY_ABI,
          functionName: "getFiles",
          args: [BigInt(offset), BigInt(MAX_PAGE_SIZE)],
        });

        for (let i = 0; i < ids.length; i++) {
          const item = items[i] as FileItem;
          if (!item.exists) continue;
          files.push({
            fileId: ids[i] as Hex,
            name: item.name,
            mimeType: item.mimeType,
            isPublic: item.isPublic,
            priceTinybar: item.priceTinybar.toString(),
            owner: item.owner,
            payToAccountId: item.payToAccountId,
          });
        }
      }

      return files;
    },
  });
}
