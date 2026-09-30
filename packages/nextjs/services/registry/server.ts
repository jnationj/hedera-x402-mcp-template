import { type Address, type Hex, createPublicClient, getAddress, http } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";
import { FILE_REGISTRY_ABI } from "~~/contracts/fileRegistryAbi";
import scaffoldConfig from "~~/scaffold.config";

/**
 * Server-side reader for the on-chain `FileRegistry`.
 *
 * The registry is the source of truth for who owns a file, what it costs, and
 * whether it is public. The resource server reads it on every download to
 * decide between "serve for free" and "gate behind an x402 payment". Writes
 * (register / set price / set visibility) happen from the browser via native
 * Hedera contract executes (HashPack), never here.
 */

/** A registered file as returned by the registry, normalised for server use. */
export type RegistryFile = {
  fileId: Hex;
  owner: Address;
  payToAccountId: string;
  priceTinybar: bigint;
  isPublic: boolean;
  objectKey: string;
  contentHash: Hex;
  name: string;
  mimeType: string;
};

/** The chain the resource server reads from (first configured target network). */
const targetChain = scaffoldConfig.targetNetworks[0];

function resolveRpcUrl(): string {
  return (
    process.env.HEDERA_RPC_URL || scaffoldConfig.rpcOverrides?.[targetChain.id] || targetChain.rpcUrls.default.http[0]
  );
}

/**
 * Resolve the deployed `FileRegistry` address.
 *
 * Prefers an explicit env override (handy before the generated
 * `deployedContracts.ts` is populated) and otherwise falls back to the address
 * recorded for the target chain at deploy time.
 *
 * @returns The checksummed registry address, or `undefined` when not deployed.
 */
export function getFileRegistryAddress(): Address | undefined {
  const fromEnv = process.env.FILE_REGISTRY_ADDRESS ?? process.env.NEXT_PUBLIC_FILE_REGISTRY_ADDRESS;
  if (fromEnv) return getAddress(fromEnv);

  const chainContracts = (deployedContracts as Record<number, Record<string, { address?: string }>>)[targetChain.id];
  const address = chainContracts?.FileRegistry?.address;
  return address ? getAddress(address) : undefined;
}

let cachedClient: ReturnType<typeof createPublicClient> | null = null;

function getClient() {
  if (!cachedClient) {
    cachedClient = createPublicClient({
      chain: targetChain,
      transport: http(resolveRpcUrl()),
    });
  }
  return cachedClient;
}

/**
 * Raised when a download is requested before the registry contract is deployed.
 * Surfaced as a 503 so the cause is obvious in local development.
 */
export class RegistryNotDeployedError extends Error {
  constructor() {
    super("FileRegistry is not deployed. Run `yarn deploy` and restart the app.");
    this.name = "RegistryNotDeployedError";
  }
}

const HEX_32 = /^0x[0-9a-fA-F]{64}$/;

/** Whether `value` is a well-formed `bytes32` file id. */
export function isFileId(value: string): value is Hex {
  return HEX_32.test(value);
}

/** JSON-safe, public-facing view of a file (bigint price serialized to string). */
export type PublicFile = {
  fileId: Hex;
  name: string;
  mimeType: string;
  isPublic: boolean;
  priceTinybar: string;
  owner: Address;
  payToAccountId: string;
  contentHash: Hex;
};

/**
 * Project a {@link RegistryFile} to its public, JSON-serialisable form.
 *
 * Deliberately omits `objectKey`: the storage key is an internal detail and the
 * bucket is private, so it never needs to reach the client.
 */
export function toPublicFile(file: RegistryFile): PublicFile {
  return {
    fileId: file.fileId,
    name: file.name,
    mimeType: file.mimeType,
    isPublic: file.isPublic,
    priceTinybar: file.priceTinybar.toString(),
    owner: file.owner,
    payToAccountId: file.payToAccountId,
    contentHash: file.contentHash,
  };
}

type RawFileItem = {
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

function toRegistryFile(fileId: Hex, file: RawFileItem): RegistryFile {
  return {
    fileId,
    owner: file.owner,
    payToAccountId: file.payToAccountId,
    priceTinybar: file.priceTinybar,
    isPublic: file.isPublic,
    objectKey: file.objectKey,
    contentHash: file.contentHash,
    name: file.name,
    mimeType: file.mimeType,
  };
}

/**
 * Read a single file's metadata from the registry.
 *
 * @param fileId - The `bytes32` file id.
 * @returns The file, or `null` when the id is unknown (the contract reverts with
 *   `FileNotFound`, which we treat as "not found" rather than an error).
 * @throws {RegistryNotDeployedError} When no registry address is configured.
 */
export async function getRegistryFile(fileId: Hex): Promise<RegistryFile | null> {
  const address = getFileRegistryAddress();
  if (!address) throw new RegistryNotDeployedError();

  try {
    const file = (await getClient().readContract({
      address,
      abi: FILE_REGISTRY_ABI,
      functionName: "getFile",
      args: [fileId],
    })) as RawFileItem;

    if (!file.exists) return null;
    return toRegistryFile(fileId, file);
  } catch (error) {
    // `getFile` reverts with `FileNotFound` for unknown ids; treat as not found.
    if (error instanceof Error && /FileNotFound|reverted/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

/**
 * Read a page of registered files for the marketplace listing.
 *
 * @param offset - Index to start from.
 * @param limit - Maximum number of files to return.
 * @returns The page of files (may be empty) and the total registered count.
 * @throws {RegistryNotDeployedError} When no registry address is configured.
 */
export async function listRegistryFiles(
  offset: number,
  limit: number,
): Promise<{ files: RegistryFile[]; total: number }> {
  const address = getFileRegistryAddress();
  if (!address) throw new RegistryNotDeployedError();

  const client = getClient();
  const [total, page] = await Promise.all([
    client.readContract({ address, abi: FILE_REGISTRY_ABI, functionName: "getFileCount" }) as Promise<bigint>,
    client.readContract({
      address,
      abi: FILE_REGISTRY_ABI,
      functionName: "getFiles",
      args: [BigInt(offset), BigInt(limit)],
    }) as Promise<readonly [readonly Hex[], readonly RawFileItem[]]>,
  ]);

  const [ids, items] = page;
  const files = items.map((item, i) => toRegistryFile(ids[i], item));
  return { files, total: Number(total) };
}
