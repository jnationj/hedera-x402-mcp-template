import { NextResponse } from "next/server";
import { RegistryNotDeployedError, getRegistryFile, isFileId, toPublicFile } from "~~/services/registry/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Return a single file's public metadata (no payment, no download URL).
 *
 * Used by the file detail page to render price / visibility / owner before the
 * user decides to download. The actual bytes are served by the sibling
 * `[id]/download` route.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isFileId(id)) {
    return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
  }

  try {
    const file = await getRegistryFile(id);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return NextResponse.json({ file: toPublicFile(file) });
  } catch (error) {
    if (error instanceof RegistryNotDeployedError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[api/files/:id]", error);
    return NextResponse.json({ error: "Failed to read file" }, { status: 502 });
  }
}
