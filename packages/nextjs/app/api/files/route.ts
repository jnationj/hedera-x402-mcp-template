import { NextResponse } from "next/server";
import { RegistryNotDeployedError, listRegistryFiles, toPublicFile } from "~~/services/registry/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

/**
 * List registered files for the marketplace.
 *
 * Query params: `offset` (default 0), `limit` (default 24, max 100).
 * Response: `{ files: PublicFile[], total: number, offset, limit }`.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));

  try {
    const { files, total } = await listRegistryFiles(offset, limit);
    return NextResponse.json({ files: files.map(toPublicFile), total, offset, limit });
  } catch (error) {
    if (error instanceof RegistryNotDeployedError) {
      return NextResponse.json({ error: error.message, files: [], total: 0 }, { status: 503 });
    }
    console.error("[api/files] list failed", error);
    return NextResponse.json({ error: "Failed to list files" }, { status: 502 });
  }
}
