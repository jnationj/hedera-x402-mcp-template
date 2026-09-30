import { NextResponse } from "next/server";

const MIRROR_BASE: Record<string, string> = {
  testnet: process.env.HEDERA_MIRROR_TESTNET_URL ?? "https://testnet.mirrornode.hedera.com",
  mainnet: process.env.HEDERA_MIRROR_MAINNET_URL ?? "https://mainnet.mirrornode.hedera.com",
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const transactionId = searchParams.get("transactionId");
  const network = (searchParams.get("network") ?? "testnet").toLowerCase();

  if (!transactionId) {
    return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
  }

  const base = MIRROR_BASE[network] ?? MIRROR_BASE.testnet;
  const url = `${base}/api/v1/transactions/${encodeURIComponent(transactionId)}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ result: "UNKNOWN" });
      }
      return NextResponse.json({ error: "Mirror node request failed", status: res.status }, { status: 502 });
    }

    const data = (await res.json()) as { transactions?: Array<{ result?: string | null }> };
    const result = data.transactions?.[0]?.result ?? "UNKNOWN";
    return NextResponse.json({ result });
  } catch (error) {
    console.error("[api/hedera/transaction]", error);
    return NextResponse.json({ error: "Lookup failed" }, { status: 502 });
  }
}
