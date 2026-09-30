import { type Address, type Hex, encodePacked, getAddress, keccak256 } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";

/**
 * Shared `FileRegistry` ABI and address resolution.
 *
 * The template ships before the contract is deployed, so the generated
 * `deployedContracts.ts` may not contain `FileRegistry` yet. To keep the UI and
 * API typed and functional in that window, this module is the single source of
 * truth for the ABI and resolves the address from (in priority order) an env
 * override or the generated `deployedContracts.ts`. After `yarn deploy` the
 * generated file is populated and everything keeps working unchanged.
 */
export const FILE_REGISTRY_ABI = [
  {
    type: "function",
    name: "PAYMENT_ASSET",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "registerFile",
    stateMutability: "nonpayable",
    inputs: [
      { name: "objectKey", type: "string" },
      { name: "payToAccountId", type: "string" },
      { name: "priceTinybar", type: "uint256" },
      { name: "isPublic", type: "bool" },
      { name: "contentHash", type: "bytes32" },
      { name: "name", type: "string" },
      { name: "mimeType", type: "string" },
    ],
    outputs: [{ name: "fileId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "setPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "fileId", type: "bytes32" },
      { name: "newPriceTinybar", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setVisibility",
    stateMutability: "nonpayable",
    inputs: [
      { name: "fileId", type: "bytes32" },
      { name: "isPublic", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setPayToAccountId",
    stateMutability: "nonpayable",
    inputs: [
      { name: "fileId", type: "bytes32" },
      { name: "newPayToAccountId", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "computeFileId",
    stateMutability: "pure",
    inputs: [
      { name: "owner", type: "address" },
      { name: "objectKey", type: "string" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getFile",
    stateMutability: "view",
    inputs: [{ name: "fileId", type: "bytes32" }],
    outputs: [{ name: "", type: "tuple", components: FILE_ITEM_COMPONENTS() }],
  },
  {
    type: "function",
    name: "getFileCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getFiles",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      { name: "ids", type: "bytes32[]" },
      { name: "files", type: "tuple[]", components: FILE_ITEM_COMPONENTS() },
    ],
  },
  {
    type: "event",
    name: "FileRegistered",
    inputs: [
      { name: "fileId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "objectKey", type: "string", indexed: false },
      { name: "payToAccountId", type: "string", indexed: false },
      { name: "priceTinybar", type: "uint256", indexed: false },
      { name: "isPublic", type: "bool", indexed: false },
      { name: "contentHash", type: "bytes32", indexed: false },
      { name: "name", type: "string", indexed: false },
      { name: "mimeType", type: "string", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PriceChanged",
    inputs: [
      { name: "fileId", type: "bytes32", indexed: true },
      { name: "oldPriceTinybar", type: "uint256", indexed: false },
      { name: "newPriceTinybar", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "VisibilityChanged",
    inputs: [
      { name: "fileId", type: "bytes32", indexed: true },
      { name: "isPublic", type: "bool", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PayToChanged",
    inputs: [
      { name: "fileId", type: "bytes32", indexed: true },
      { name: "oldPayToAccountId", type: "string", indexed: false },
      { name: "newPayToAccountId", type: "string", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "FileAlreadyRegistered", inputs: [{ name: "fileId", type: "bytes32" }] },
  { type: "error", name: "FileNotFound", inputs: [{ name: "fileId", type: "bytes32" }] },
  {
    type: "error",
    name: "NotFileOwner",
    inputs: [
      { name: "fileId", type: "bytes32" },
      { name: "caller", type: "address" },
    ],
  },
  { type: "error", name: "EmptyValue", inputs: [{ name: "field", type: "string" }] },
] as const;

/**
 * Components of the on-chain `FileItem` struct, shared by `getFile` and
 * `getFiles`. Declared as a function so the literal is inlined into the `as
 * const` ABI above while staying defined in one place.
 */
function FILE_ITEM_COMPONENTS() {
  return [
    { name: "owner", type: "address" },
    { name: "payToAccountId", type: "string" },
    { name: "priceTinybar", type: "uint256" },
    { name: "isPublic", type: "bool" },
    { name: "objectKey", type: "string" },
    { name: "contentHash", type: "bytes32" },
    { name: "name", type: "string" },
    { name: "mimeType", type: "string" },
    { name: "exists", type: "bool" },
  ] as const;
}

/**
 * Resolve the deployed `FileRegistry` address for a chain.
 *
 * @param chainId - Target chain id.
 * @returns The checksummed address, or `undefined` when not deployed.
 */
export function getFileRegistryAddress(chainId: number): Address | undefined {
  const fromEnv = process.env.NEXT_PUBLIC_FILE_REGISTRY_ADDRESS;
  if (fromEnv) return getAddress(fromEnv);

  const chainContracts = (deployedContracts as Record<number, Record<string, { address?: string }>>)[chainId];
  const address = chainContracts?.FileRegistry?.address;
  return address ? getAddress(address) : undefined;
}

/**
 * Resolve the native Hedera contract id for `FileRegistry` on a chain.
 * Required for HashPack native `ContractExecuteTransaction` calls.
 */
export function getFileRegistryHederaContractId(chainId: number): string | undefined {
  const fromEnv =
    process.env.NEXT_PUBLIC_FILE_REGISTRY_HEDERA_CONTRACT_ID ?? process.env.FILE_REGISTRY_HEDERA_CONTRACT_ID;
  if (fromEnv?.trim()) return fromEnv.trim();

  const chainContracts = (deployedContracts as Record<number, Record<string, { hederaContractId?: string }>>)[chainId];
  return chainContracts?.FileRegistry?.hederaContractId;
}

/**
 * Compute the deterministic file id for an `(owner, objectKey)` pair, mirroring
 * the contract's `computeFileId`. Lets the client predict the id of a file it is
 * about to register without an extra RPC round-trip.
 *
 * @param owner - Address registering the file.
 * @param objectKey - Storage object key.
 * @returns The `bytes32` file id.
 */
export function computeFileId(owner: Address, objectKey: string): Hex {
  return keccak256(encodePacked(["address", "string"], [owner, objectKey]));
}
