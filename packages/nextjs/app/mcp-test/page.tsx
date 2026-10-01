"use client";

import { useRef, useState } from "react";
import type { ClientHederaSigner } from "@x402/hedera";
import { useHederaWalletConnect } from "~~/services/web3/hederaWalletConnect";
import { createHederaProviderSigner } from "~~/services/x402/walletSigner";
import { formatTinybar } from "~~/utils/x402";

const MCP_NETWORK = "hedera:testnet";
const HBAR_ASSET = "0.0.0";
const DEMO_PRICE_TINYBAR = "1000000";
const EXPECTED_MCP_PAY_TO = process.env.NEXT_PUBLIC_X402_MCP_PAY_TO?.trim() ?? "";
const TOOL_NAME = "get_service_info";
const TOOL_TOPIC = "Hedera pay-per-use services";
const TOOL_URL = "/api/mcp";

type PageStatus =
  | "idle"
  | "connecting"
  | "calling"
  | "awaiting-approval"
  | "signing"
  | "settled"
  | "declined"
  | "verification-error"
  | "settlement-error"
  | "payment-unknown"
  | "signing-error"
  | "tool-error"
  | "connection-error";

type SettlementReceipt = {
  success: boolean;
  transaction: string;
  payer?: string;
  network: string;
  errorReason?: string;
  errorMessage?: string;
};

type PaymentRequirement = {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
};

function isDemoRequirement(requirement: PaymentRequirement): boolean {
  return (
    requirement.scheme === "exact" &&
    requirement.network === MCP_NETWORK &&
    requirement.asset === HBAR_ASSET &&
    requirement.amount === DEMO_PRICE_TINYBAR &&
    EXPECTED_MCP_PAY_TO.length > 0 &&
    requirement.payTo === EXPECTED_MCP_PAY_TO
  );
}

function readPaymentRequiredError(content: Array<{ type: string; text?: unknown }>): string | undefined {
  const text = content.find(item => item.type === "text" && typeof item.text === "string")?.text;
  if (typeof text !== "string") return undefined;

  try {
    const response = JSON.parse(text) as { error?: unknown };
    return typeof response.error === "string" ? response.error : undefined;
  } catch {
    return undefined;
  }
}

function readCurrent<T>(reference: { current: T }): T {
  return reference.current;
}

function safeErrorMessage(status: PageStatus): string {
  switch (status) {
    case "declined":
      return "Payment was declined. No HashPack transaction was signed.";
    case "verification-error":
      return "The facilitator or resource server rejected payment verification. No paid tool result was accepted.";
    case "settlement-error":
      return "Payment settlement did not succeed. Check the settlement receipt before retrying.";
    case "payment-unknown":
      return "A signed payment was created, but its outcome could not be confirmed. Check Hedera transaction history before retrying.";
    case "signing-error":
      return "HashPack payment signing or the paid MCP request failed before a confirmed result was returned.";
    case "tool-error":
      return "The MCP tool returned an error. No successful paid result is being reported.";
    case "connection-error":
      return "Could not connect to the MCP endpoint or complete the unpaid tool request.";
    default:
      return "The MCP payment test did not complete.";
  }
}

export default function McpTestPage() {
  const { provider, hederaAccountId, hasHederaSession, isConnected, isInitializing } = useHederaWalletConnect();
  const [status, setStatus] = useState<PageStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [toolOutput, setToolOutput] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SettlementReceipt | null>(null);
  const approvalDecision = useRef<"pending" | "approved" | "declined" | "invalid-requirement">("pending");
  const signerState = useRef<"not-started" | "signing" | "signed" | "failed">("not-started");

  const walletReady = Boolean(isConnected && hasHederaSession && hederaAccountId && provider);

  const callPaidTool = async () => {
    if (!walletReady || !hederaAccountId || !provider) {
      setStatus("connection-error");
      setError("Connect HashPack with the wallet button above before calling the paid tool.");
      return;
    }

    setError(null);
    setToolOutput(null);
    setReceipt(null);
    approvalDecision.current = "pending";
    signerState.current = "not-started";
    setStatus("connecting");

    let closeClient: (() => Promise<void>) | undefined;
    try {
      const [mcp, hederaClient, mcpSdk] = await Promise.all([
        import("@x402/mcp"),
        import("@x402/hedera/exact/client"),
        import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
      ]);
      const walletSigner = createHederaProviderSigner(hederaAccountId, provider, { network: MCP_NETWORK });
      const signer: ClientHederaSigner = {
        accountId: walletSigner.accountId,
        createPartiallySignedTransferTransaction: async requirements => {
          signerState.current = "signing";
          try {
            const transaction = await walletSigner.createPartiallySignedTransferTransaction(requirements);
            signerState.current = "signed";
            return transaction;
          } catch (error) {
            signerState.current = "failed";
            throw error;
          }
        },
      };
      const scheme = new hederaClient.ExactHederaScheme(signer);

      const client = mcp.createx402MCPClient({
        name: "scaffold-hbar-paid-mcp-test",
        version: "0.1.0",
        schemes: [{ network: MCP_NETWORK, client: scheme, x402Version: 2 }],
        policies: [
          (_version, requirements) => {
            const matchingRequirements = requirements.filter(isDemoRequirement);
            if (matchingRequirements.length === 0) {
              approvalDecision.current = "invalid-requirement";
            }
            return matchingRequirements;
          },
        ],
        paymentRequirementsSelector: (_version, requirements) => {
          const requirement = requirements.find(isDemoRequirement);
          if (!requirement) {
            throw new Error("Server did not offer the expected exact HBAR testnet requirement");
          }
          return requirement;
        },
        spendControls: {
          allowedAssets: [{ network: MCP_NETWORK, asset: HBAR_ASSET, maxAmountPerPayment: DEMO_PRICE_TINYBAR }],
        },
        autoPayment: true,
        onPaymentRequested: ({ toolName, paymentRequired }) => {
          const requirement = paymentRequired.accepts.find(isDemoRequirement);
          if (toolName !== TOOL_NAME || !requirement) {
            approvalDecision.current = "invalid-requirement";
            return false;
          }

          setStatus("awaiting-approval");
          const approved = window.confirm(
            `Pay ${formatTinybar(requirement.amount)} HBAR to ${requirement.payTo} on ${requirement.network} for ${toolName}?`,
          );
          approvalDecision.current = approved ? "approved" : "declined";
          if (approved) setStatus("signing");
          return approved;
        },
      });
      closeClient = () => client.close();

      const transport = new mcpSdk.StreamableHTTPClientTransport(new URL(TOOL_URL, window.location.origin));
      await client.connect(transport);
      setStatus("calling");

      const result = await client.callTool(TOOL_NAME, { topic: TOOL_TOPIC });
      setToolOutput(JSON.stringify(result.content, null, 2));

      if (result.paymentResponse) {
        const settlement: SettlementReceipt = {
          success: result.paymentResponse.success,
          transaction: result.paymentResponse.transaction,
          payer: result.paymentResponse.payer,
          network: result.paymentResponse.network,
          errorReason: result.paymentResponse.errorReason,
          errorMessage: result.paymentResponse.errorMessage,
        };
        setReceipt(settlement);
      }

      if (result.paymentResponse && !result.paymentResponse.success) {
        setStatus("settlement-error");
        setError(
          result.paymentResponse.errorMessage ??
            result.paymentResponse.errorReason ??
            safeErrorMessage("settlement-error"),
        );
        return;
      }

      if (result.isError) {
        const paymentError = readPaymentRequiredError(result.content);
        if (paymentError?.toLowerCase().includes("settlement failed")) {
          setStatus("settlement-error");
          setError(paymentError);
        } else if (result.paymentMade && paymentError) {
          setStatus("verification-error");
          setError(paymentError);
        } else {
          setStatus("tool-error");
          setError(paymentError ?? safeErrorMessage("tool-error"));
        }
        return;
      }

      if (!result.paymentMade || !result.paymentResponse?.success) {
        setStatus("settlement-error");
        setError("The tool returned without a successful payment settlement receipt; payment success is unconfirmed.");
        return;
      }

      setStatus("settled");
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[x402-mcp-test] callPaidTool error", error);
        if (error instanceof Error) {
          console.error("[x402-mcp-test] callPaidTool error details", {
            name: error.name,
            message: error.message,
            stack: error.stack,
          });
        }
      }
      const decision = readCurrent(approvalDecision);
      const signatureState = readCurrent(signerState);
      if (decision === "declined") {
        setStatus("declined");
        setError(safeErrorMessage("declined"));
      } else if (decision === "invalid-requirement") {
        setStatus("verification-error");
        setError("The server did not offer the expected exact HBAR testnet payment requirement.");
      } else if (signatureState === "signed") {
        setStatus("payment-unknown");
        setError(safeErrorMessage("payment-unknown"));
      } else if (decision === "approved") {
        setStatus("signing-error");
        setError(safeErrorMessage("signing-error"));
      } else {
        setStatus("connection-error");
        setError(safeErrorMessage("connection-error"));
      }
    } finally {
      if (closeClient) {
        try {
          await closeClient();
        } catch {
          // Closing the optional stateless SSE stream is best-effort after the call result is handled.
        }
      }
    }
  };

  const statusLabel: Record<PageStatus, string> = {
    idle: "Ready",
    connecting: "Connecting to the local MCP endpoint…",
    calling: "Requesting the unpaid MCP tool response…",
    "awaiting-approval": "Waiting for payment approval…",
    signing: "Approve the HBAR transfer in HashPack…",
    settled: "Payment settled and tool response received.",
    declined: "Payment declined.",
    "verification-error": "Payment verification failed.",
    "settlement-error": "Payment settlement failed or is unconfirmed.",
    "payment-unknown": "Payment outcome unknown—check the transaction before retrying.",
    "signing-error": "Payment signing or submission failed.",
    "tool-error": "MCP tool returned an error.",
    "connection-error": "MCP connection failed.",
  };

  const working = ["connecting", "calling", "awaiting-approval", "signing"].includes(status);

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="rounded-2xl border border-base-300 bg-base-100 p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Development test</p>
        <h1 className="mt-2 text-3xl font-bold">Paid MCP tool</h1>
        <p className="mt-3 text-sm text-base-content/70">
          Calls <span className="font-mono">{TOOL_NAME}</span> through the local Streamable HTTP endpoint and requests
          an explicit HashPack approval for its Hedera HBAR payment.
        </p>

        <div className="mt-6 rounded-xl bg-base-200 p-4">
          <h2 className="font-semibold">Wallet</h2>
          {isInitializing ? (
            <p className="mt-2 text-sm text-base-content/70">Initializing the existing Hedera wallet connection…</p>
          ) : walletReady ? (
            <p className="mt-2 break-all font-mono text-sm">Connected · {hederaAccountId}</p>
          ) : (
            <p className="mt-2 text-sm text-base-content/70">
              Not connected. Use the existing <span className="font-semibold">Connect HashPack</span> button in the page
              header, then return here.
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" type="button" onClick={callPaidTool} disabled={!walletReady || working}>
            {working ? <span className="loading loading-spinner loading-sm" /> : null}
            {working ? "Working…" : "Call Paid MCP Tool"}
          </button>
          <span className="text-sm text-base-content/70" role="status" aria-live="polite">
            {statusLabel[status]}
          </span>
        </div>

        {error ? <p className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error">{error}</p> : null}

        {toolOutput ? (
          <div className="mt-6">
            <h2 className="font-semibold">Tool response</h2>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-neutral p-4 text-xs text-neutral-content">
              {toolOutput}
            </pre>
          </div>
        ) : null}

        {receipt ? (
          <div className="mt-6 rounded-xl border border-base-300 p-4">
            <h2 className="font-semibold">Settlement receipt</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-base-content/60">Status</dt>
              <dd>{receipt.success ? "Success" : "Failed"}</dd>
              <dt className="text-base-content/60">Transaction</dt>
              <dd className="break-all font-mono">{receipt.transaction || "Unavailable"}</dd>
              <dt className="text-base-content/60">Payer</dt>
              <dd className="break-all font-mono">{receipt.payer ?? "Unavailable"}</dd>
              <dt className="text-base-content/60">Network</dt>
              <dd>{receipt.network}</dd>
              {receipt.errorReason || receipt.errorMessage ? (
                <>
                  <dt className="text-base-content/60">Failure</dt>
                  <dd>{receipt.errorMessage ?? receipt.errorReason}</dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : null}
      </div>
    </section>
  );
}
