import { NextResponse } from "next/server";
import { RegistryNotDeployedError, getRegistryFile, isFileId, toPublicFile } from "~~/services/registry/server";
import { verifyStoredObjectHash } from "~~/services/storage/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verify that the actual bytes stored in MinIO/AIStor still hash to the same
 * SHA-256 value that was recorded on-chain when the file was registered.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    console.error("[api/files/verify] registry read failed", error);
    return NextResponse.json({ error: "Failed to read file registry" }, { status: 502 });
  }

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const verification = await verifyStoredObjectHash(file.objectKey, file.contentHash);

  const payload = {
    verified: verification.verified,
    status: verification.status,
    fileId: file.fileId,
    objectKey: file.objectKey,
    expectedHash: verification.expectedHash,
    actualHash: verification.actualHash,
    reason: verification.reason,
    file: toPublicFile(file),
  };

  if (verification.verified) {
    return NextResponse.json(payload, { status: 200 });
  }

  if (verification.status === "mismatch") {
    return NextResponse.json(payload, { status: 409 });
  }

  if (verification.status === "missing") {
    return NextResponse.json(payload, { status: 404 });
  }

  return NextResponse.json(payload, { status: 502 });
}
