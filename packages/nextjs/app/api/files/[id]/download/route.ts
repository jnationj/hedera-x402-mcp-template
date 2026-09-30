import { NextResponse } from "next/server";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentRequirements, ResourceInfo } from "@x402/core/types";
import { RegistryNotDeployedError, getRegistryFile, isFileId, toPublicFile } from "~~/services/registry/server";
import { createDownloadUrl } from "~~/services/storage/client";
import {
  HBAR_ASSET,
  MAX_TIMEOUT_SECONDS,
  X402_NETWORK,
  getResourceServer,
  makeHttpContext,
} from "~~/services/x402/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pay-per-download endpoint and x402 resource server for a single file.
 *
 * Flow:
 *  1. Look the file up in the on-chain `FileRegistry`.
 *  2. Public file -> mint a presigned download URL and return it for free.
 *  3. Private file -> require an x402 payment of `priceTinybar` HBAR to the
 *     owner's account, settled fresh on every download:
 *       - No payment header -> 402 with `PAYMENT-REQUIRED`.
 *       - Payment present -> verify, then settle, then (only on success) mint
 *         the download URL and attach the `PAYMENT-RESPONSE` receipt.
 *
 * The bucket is private, so the presigned URL is the only thing that grants
 * access, and it is handed out strictly after settlement succeeds.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isFileId(id)) {
    return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
  }

  let file;
  try {
    file = await getRegistryFile(id);
  } catch (error) {
    if (error instanceof RegistryNotDeployedError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[api/files/download] registry read failed", error);
    return NextResponse.json({ error: "Failed to read file registry" }, { status: 502 });
  }

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // Public files are free for everyone.
  if (file.isPublic) {
    const url = await createDownloadUrl({
      objectKey: file.objectKey,
      fileName: file.name,
      contentType: file.mimeType,
    });
    return NextResponse.json({ url, file: toPublicFile(file) });
  }

  // Private files are gated behind a fresh x402 payment.
  const { context, resourceUrl } = makeHttpContext(req);

  let server;
  try {
    server = await getResourceServer();
  } catch (error) {
    console.error("[api/files/download] facilitator unavailable", error);
    return NextResponse.json({ error: "Payment facilitator unavailable" }, { status: 502 });
  }

  const requirements = await server.buildPaymentRequirementsFromOptions(
    [
      {
        scheme: "exact",
        network: X402_NETWORK,
        payTo: file.payToAccountId,
        price: { asset: HBAR_ASSET, amount: file.priceTinybar.toString() },
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      },
    ],
    context,
  );

  const resourceInfo: ResourceInfo = {
    url: resourceUrl,
    description: file.name,
    mimeType: file.mimeType,
  };

  // No payment yet: challenge the client with the price.
  if (!context.paymentHeader) {
    return paymentRequired(server, requirements, resourceInfo);
  }

  // Decode the client's signed payment payload.
  let payload;
  try {
    payload = decodePaymentSignatureHeader(context.paymentHeader);
  } catch {
    return paymentRequired(server, requirements, resourceInfo, "Malformed payment header");
  }

  const matched = server.findMatchingRequirements(requirements, payload);
  if (!matched) {
    return paymentRequired(server, requirements, resourceInfo, "Payment does not match requirements");
  }

  // Verify the payment is valid before doing any work.
  const verification = await server.verifyPayment(payload, matched);
  if (!verification.isValid) {
    const reason =
      ("invalidMessage" in verification && typeof verification.invalidMessage === "string"
        ? verification.invalidMessage
        : undefined) ??
      verification.invalidReason ??
      "Payment is not valid";
    console.error("[api/files/download] payment verify failed", verification);
    return paymentRequired(server, requirements, resourceInfo, reason);
  }

  // Settle (broadcast) the payment. Only deliver the file once funds are captured.
  const settlement = await server.settlePayment(payload, matched);
  if (!settlement.success) {
    return NextResponse.json({ error: "Payment settlement failed", reason: settlement.errorReason }, { status: 402 });
  }

  const url = await createDownloadUrl({
    objectKey: file.objectKey,
    fileName: file.name,
    contentType: file.mimeType,
  });

  const response = NextResponse.json({
    url,
    file: toPublicFile(file),
    payment: {
      transaction: settlement.transaction,
      payer: settlement.payer,
      network: settlement.network,
    },
  });
  response.headers.set("PAYMENT-RESPONSE", encodePaymentResponseHeader(settlement));
  return response;
}

/**
 * Build a 402 Payment Required response carrying the x402 challenge in both the
 * `PAYMENT-REQUIRED` header and the JSON body.
 */
async function paymentRequired(
  server: Awaited<ReturnType<typeof getResourceServer>>,
  requirements: PaymentRequirements[],
  resourceInfo: ResourceInfo,
  error = "Payment required",
) {
  const paymentRequiredBody = await server.createPaymentRequiredResponse(requirements, resourceInfo, error);
  const response = NextResponse.json(paymentRequiredBody, { status: 402 });
  response.headers.set("PAYMENT-REQUIRED", encodePaymentRequiredHeader(paymentRequiredBody));
  return response;
}
