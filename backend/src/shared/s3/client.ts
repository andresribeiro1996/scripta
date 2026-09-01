// One S3 client, shared by the gallery and covers blob adapters.
//
// The only file outside those two adapters that knows the AWS SDK exists.
// Lives in shared/ rather than inside either module because both need the
// identical client and credentials — duplicating the construction would
// mean two connection pools and two places to get the R2 quirks wrong.
//
// Written against S3's API, not AWS specifically: Cloudflare R2, Backblaze
// B2, MinIO and AWS S3 all speak it. R2 is the recommended target (zero
// egress fees, which matters when every page view serves cover images).

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";

let cached: S3Client | null = null;

export function getS3Client(): S3Client {
  if (cached) return cached;

  cached = new S3Client({
    // R2 and MinIO require an explicit endpoint; real AWS S3 infers one
    // from the region, so this is left unset there.
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    // R2 ignores the region but the SDK insists on one being present;
    // "auto" is what Cloudflare's own docs use.
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY
    },
    // Path-style (bucket in the path, not the hostname). R2 and MinIO
    // need it; AWS S3 accepts it. Virtual-host style would require DNS
    // per bucket, which self-hosted endpoints don't have.
    forcePathStyle: env.S3_FORCE_PATH_STYLE
  });

  return cached;
}

/** Only for tests, which stand up a throwaway server per run and must not
 *  inherit a client pointed at the previous one. */
export function resetS3Client(): void {
  cached?.destroy();
  cached = null;
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType
    })
  );
}

/** `null` for a key that isn't there — a miss, not an error. Every other
 *  failure (credentials, network, a bucket that doesn't exist) propagates,
 *  because silently treating those as "no such image" would turn an
 *  outage into apparently-deleted user data. */
export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const response = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    if (!response.Body) return null;
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  } catch (err) {
    // Deleting something already gone must not block the caller — the
    // filesystem adapter uses rmSync({force:true}) for the same reason:
    // a row whose blob vanished still needs its row cleaned up.
    if (!isNotFound(err)) throw err;
  }
}

/** S3 signals a missing key several ways depending on implementation and
 *  on whether the caller has ListBucket permission (AWS returns 403
 *  rather than 404 without it). Checked broadly so a miss on one provider
 *  isn't an unhandled error on another. */
function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const status = candidate.$metadata?.httpStatusCode;
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.Code === "NoSuchKey" ||
    status === 404
  );
}
