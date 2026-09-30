import { NextResponse } from "next/server";
import { UPLOAD_URL_TTL_SECONDS, buildObjectKey, createUploadUrl } from "~~/services/storage/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issue a presigned URL for uploading one file to private storage.
 *
 * The browser calls this first, PUTs the bytes straight to MinIO using the
 * returned URL, and then registers the resulting `objectKey` on-chain via the
 * `FileRegistry` contract. The file bytes never pass through this server.
 *
 * Request body: `{ name: string; mimeType?: string }`.
 * Response: `{ objectKey, uploadUrl, contentType, expiresIn }`.
 */
export async function POST(req: Request) {
  let body: { name?: unknown; mimeType?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
  }

  const contentType = typeof body.mimeType === "string" && body.mimeType ? body.mimeType : "application/octet-stream";
  const objectKey = buildObjectKey(name);

  try {
    const uploadUrl = await createUploadUrl({ objectKey, contentType });
    return NextResponse.json({
      objectKey,
      uploadUrl,
      contentType,
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    });
  } catch (error) {
    console.error("[api/files/upload]", error);
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 502 });
  }
}
