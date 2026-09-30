import { NextResponse } from "next/server";

const MIRROR_BASE: Record<string, string> = {
  testnet: process.env.HEDERA_MIRROR_TESTNET_URL ?? "https://testnet.mirrornode.hedera.com",
  mainnet: process.env.HEDERA_MIRROR_MAINNET_URL ?? "https://mainnet.mirrornode.hedera.com",
};

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEDERA_CONTRACT_ID_RE = /^\d+\.\d+\.\d+$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const evm = searchParams.get("evm");
  const network = (searchParams.get("network") ?? "testnet").toLowerCase();
  const base = MIRROR_BASE[network] ?? MIRROR_BASE.testnet;

  if (!evm || !EVM_ADDRESS_RE.test(evm)) {
    return NextResponse.json({ error: "Missing or invalid EVM address" }, { status: 400 });
  }

  const url = `${base}/api/v1/contracts/${evm.toLowerCase()}`;

  try {
    const res = await fetch(url, { next: { revalidate: 300 } });

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ contractId: null });
      }
      return NextResponse.json({ error: "Mirror node request failed", status: res.status }, { status: 502 });
    }

    const data = (await res.json()) as { contract_id?: string };
    const contractId =
      typeof data.contract_id === "string" && HEDERA_CONTRACT_ID_RE.test(data.contract_id) ? data.contract_id : null;
    return NextResponse.json({ contractId });
  } catch (error) {
    console.error("[api/hedera/contract]", error);
    return NextResponse.json({ error: "Resolution failed" }, { status: 502 });
  }
}
