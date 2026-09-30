import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

/**
 * S3-compatible storage client for the x402 pay-per-use template.
 *
 * In this template the backing store is a local MinIO instance (see the root
 * `docker-compose.yml`). The bucket is private: nothing is ever served directly
 * from MinIO. Every read and write happens through short-lived presigned URLs
 * minted by the resource server, so possession of an `objectKey` never grants
 * access on its own.
 *
 * These helpers are server-only. They read MinIO credentials from the
 * environment and must never be imported into client components.
 */

const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://localhost:9000";
const S3_REGION = process.env.S3_REGION ?? "us-east-1";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? process.env.MINIO_ROOT_USER ?? "minioadmin";
const S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? process.env.MINIO_ROOT_PASSWORD ?? "minioadmin";

/** Bucket that holds every uploaded object. Created by the `minio-init` compose service. */
export const S3_BUCKET = process.env.S3_BUCKET ?? "x402-files";

/** MinIO requires path-style URLs; leave true unless using AWS virtual-hosted buckets. */
const S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE !== "false";

/** Presigned upload URLs are short lived: just long enough to PUT one object. */
export const UPLOAD_URL_TTL_SECONDS = 300;

/** Presigned download URLs expire quickly so a paid link cannot be re-shared indefinitely. */
export const DOWNLOAD_URL_TTL_SECONDS = 60;

/**
 * Single shared S3 client.
 *
 * `forcePathStyle` is required for MinIO, which serves buckets as
 * `<endpoint>/<bucket>/<key>` rather than the virtual-hosted style AWS uses.
 */
export const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  forcePathStyle: S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
});

/**
 * Build a collision-resistant object key for a freshly uploaded file.
 *
 * The key is date-prefixed for easy browsing and carries a random UUID so two
 * uploads of the same file name never clash. The original name is slugified and
 * truncated to keep keys readable and within S3 limits.
 *
 * @param fileName - Original client-supplied file name.
 * @returns A unique object key safe to store on-chain and in MinIO.
 */
export function buildObjectKey(fileName: string): string {
  const slug =
    fileName
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "file";
  const datePrefix = new Date().toISOString().slice(0, 10);
  return `${datePrefix}/${randomUUID()}-${slug}`;
}

/**
 * Mint a presigned URL the browser can use to PUT one object into the bucket.
 *
 * @param params.objectKey - Destination key (use {@link buildObjectKey}).
 * @param params.contentType - MIME type the client will upload with; the
 *   presigned URL is bound to this value, so the upload must send a matching
 *   `Content-Type` header.
 * @returns A URL valid for {@link UPLOAD_URL_TTL_SECONDS} seconds.
 */
export async function createUploadUrl(params: { objectKey: string; contentType: string }): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: params.objectKey,
    ContentType: params.contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
}

/**
 * Mint a presigned URL that downloads a single object.
 *
 * The response is forced to download (`Content-Disposition: attachment`) with
 * the original file name and MIME type, so the link behaves like a real file
 * download regardless of the object key.
 *
 * @param params.objectKey - Key of the object to read.
 * @param params.fileName - Human-readable name presented to the downloader.
 * @param params.contentType - MIME type returned to the downloader.
 * @returns A URL valid for {@link DOWNLOAD_URL_TTL_SECONDS} seconds.
 */
export async function createDownloadUrl(params: {
  objectKey: string;
  fileName: string;
  contentType: string;
}): Promise<string> {
  const safeName = params.fileName.replace(/"/g, "");
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: params.objectKey,
    ResponseContentDisposition: `attachment; filename="${safeName}"`,
    ResponseContentType: params.contentType || "application/octet-stream",
  });
  return getSignedUrl(s3, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}
