import { type Address, type Hex, createPublicClient, getAddress, http, keccak256, toBytes } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";
import { POLICY_402_ABI } from "~~/contracts/policy402Abi";
import scaffoldConfig from "~~/scaffold.config";
import type { RegistryFile } from "~~/services/registry/server";
import { HBAR_ASSET } from "~~/services/x402/server";

const targetChain = scaffoldConfig.targetNetworks[0];

function resolveRpcUrl(): string {
  return (
    process.env.HEDERA_RPC_URL || scaffoldConfig.rpcOverrides?.[targetChain.id] || targetChain.rpcUrls.default.http[0]
  );
}

export function getPolicy402Address(): Address | undefined {
  const raw = process.env.POLICY402_CONTRACT;
  if (raw) return getAddress(raw);

  const chainContracts = (deployedContracts as Record<number, Record<string, { address?: string }>>)[targetChain.id];
  const address = chainContracts?.Policy402?.address;
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

export function computeResourceServiceId(descriptor: string): Hex {
  return keccak256(toBytes(descriptor)) as Hex;
}

export type PolicyAttestation = {
  fileId: Hex;
  serviceId: Hex;
  policyId: Hex;
  version: bigint;
  valid: boolean;
  paymentAsset: string;
  payTo: string;
  priceTinybar: bigint;
};

export async function getCurrentPolicyForResource(resourceDescriptor: string): Promise<PolicyAttestation | null> {
  const address = getPolicy402Address();
  if (!address) return null;

  const serviceId = computeResourceServiceId(resourceDescriptor);

  try {
    const policy = (await getClient().readContract({
      address,
      abi: POLICY_402_ABI,
      functionName: "getCurrentPolicy",
      args: [serviceId],
    })) as {
      fileId: Hex;
      policyId: Hex;
      serviceId: Hex;
      owner: Address;
      currentVersion: bigint;
    };

    if (policy.serviceId !== serviceId) {
      throw new Error("Policy402 serviceId mismatch");
    }

    const [versionRecord, valid] = await Promise.all([
      getClient().readContract({
        address,
        abi: POLICY_402_ABI,
        functionName: "getPolicyVersion",
        args: [policy.policyId, policy.currentVersion],
      }) as Promise<{
        paymentAsset: string;
        payTo: string;
        priceTinybar: bigint;
        version: bigint;
      }>,
      getClient().readContract({
        address,
        abi: POLICY_402_ABI,
        functionName: "isPolicyValid",
        args: [policy.policyId, policy.currentVersion],
      }) as Promise<boolean>,
    ]);

    return {
      fileId: policy.fileId,
      serviceId,
      policyId: policy.policyId,
      version: policy.currentVersion,
      valid,
      paymentAsset: versionRecord.paymentAsset,
      payTo: versionRecord.payTo,
      priceTinybar: versionRecord.priceTinybar,
    };
  } catch (error) {
    return null;
  }
}

export async function validateResourcePolicy(
  resourceDescriptor: string,
  file: Pick<RegistryFile, "fileId" | "payToAccountId" | "priceTinybar">,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const address = getPolicy402Address();
  if (!address) {
    return { ok: false, reason: "Policy402 contract is not configured" };
  }

  const serviceId = computeResourceServiceId(resourceDescriptor);

  let policy;
  try {
    policy = (await getClient().readContract({
      address,
      abi: POLICY_402_ABI,
      functionName: "getCurrentPolicy",
      args: [serviceId],
    })) as {
      fileId: Hex;
      policyId: Hex;
      serviceId: Hex;
      owner: Address;
      currentVersion: bigint;
    };
  } catch {
    return { ok: false, reason: "Policy402 policy not found" };
  }

  if (policy.serviceId !== serviceId) {
    return { ok: false, reason: "Policy402 serviceId mismatch" };
  }

  let versionRecord;
  try {
    versionRecord = (await getClient().readContract({
      address,
      abi: POLICY_402_ABI,
      functionName: "getPolicyVersion",
      args: [policy.policyId, policy.currentVersion],
    })) as {
      fileId: Hex;
      paymentAsset: string;
      payTo: string;
      priceTinybar: bigint;
      version: bigint;
      status: number;
    };
  } catch {
    return { ok: false, reason: "Policy402 version read failed" };
  }

  if (policy.fileId !== file.fileId) {
    return { ok: false, reason: "Policy402 fileId mismatch" };
  }

  let valid;
  try {
    valid = await getClient().readContract({
      address,
      abi: POLICY_402_ABI,
      functionName: "isPolicyValid",
      args: [policy.policyId, policy.currentVersion],
    });
  } catch {
    return { ok: false, reason: "Policy402 validity check failed" };
  }

  if (!valid) {
    return { ok: false, reason: "Policy402 attestation is expired or revoked" };
  }

  if (versionRecord.paymentAsset !== HBAR_ASSET) {
    return { ok: false, reason: "Policy402 payment asset mismatch" };
  }

  if (versionRecord.payTo !== file.payToAccountId) {
    return { ok: false, reason: "Policy402 pay-to account mismatch" };
  }

  if (versionRecord.priceTinybar !== file.priceTinybar) {
    return { ok: false, reason: "Policy402 price mismatch" };
  }

  return { ok: true };
}
