import { NextResponse } from "next/server";

const MIRROR_BASE: Record<string, string> = {
  testnet: process.env.HEDERA_MIRROR_TESTNET_URL ?? "https://testnet.mirrornode.hedera.com",
  mainnet: process.env.HEDERA_MIRROR_MAINNET_URL ?? "https://mainnet.mirrornode.hedera.com",
};

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEDERA_ACCOUNT_ID_RE = /^\d+\.\d+\.\d+$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const evm = searchParams.get("evm");
  const accountId = searchParams.get("accountId");
  const network = (searchParams.get("network") ?? "testnet").toLowerCase();
  const base = MIRROR_BASE[network] ?? MIRROR_BASE.testnet;

  if (accountId) {
    if (!HEDERA_ACCOUNT_ID_RE.test(accountId)) {
      return NextResponse.json({ error: "Missing or invalid Hedera account id" }, { status: 400 });
    }

    const url = `${base}/api/v1/accounts/${accountId}`;
    try {
      const res = await fetch(url, { next: { revalidate: 60 } });
      if (!res.ok) {
        if (res.status === 404) {
          return NextResponse.json({ evmAddress: null });
        }
        return NextResponse.json({ error: "Mirror node request failed", status: res.status }, { status: 502 });
      }

      const data = (await res.json()) as { evm_address?: string | null };
      const evmAddress =
        typeof data.evm_address === "string" && EVM_ADDRESS_RE.test(data.evm_address) ? data.evm_address : null;
      return NextResponse.json({ evmAddress });
    } catch (error) {
      console.error("[api/hedera/account]", error);
      return NextResponse.json({ error: "Resolution failed" }, { status: 502 });
    }
  }

  if (!evm || !EVM_ADDRESS_RE.test(evm)) {
    return NextResponse.json({ error: "Missing or invalid EVM address" }, { status: 400 });
  }

  const url = `${base}/api/v1/accounts/${evm}`;

  try {
    const res = await fetch(url, { next: { revalidate: 60 } });

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ accountId: null });
      }
      return NextResponse.json({ error: "Mirror node request failed", status: res.status }, { status: 502 });
    }

    const data = (await res.json()) as { account?: string };
    const accountId = typeof data.account === "string" ? data.account : null;
    return NextResponse.json({ accountId });
  } catch (e) {
    console.error("[api/hedera/account]", e);
    return NextResponse.json({ error: "Resolution failed" }, { status: 502 });
  }
}
