import "server-only";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { assertUsableAwsCredentials, getEnv } from "@/lib/env";

/**
 * The S3 client for Lecture_Material bytes — AWS target only.
 *
 * S3 holds only the uploaded file. Extracted text, source units and Topics live
 * in the table, so nothing here is ever queried — objects are written once on
 * upload and read once, server-side, at extraction time.
 *
 * Loaded lazily by `lib/ingest/material-store.ts`, so the default local mode
 * never imports the S3 SDK.
 */

let client: S3Client | undefined;

export function s3(): S3Client {
  if (client) return client;
  // S3 only exists on the AWS target, so the credentials must be real ones.
  assertUsableAwsCredentials();
  client = new S3Client({ region: getEnv().AWS_REGION });
  return client;
}

/** The single bucket holding Lecture_Material objects. */
export function bucketName(): string {
  return getEnv().CLASSMIND_BUCKET;
}

/** Test seam: drops the memoised client. */
export function resetS3Client(): void {
  client = undefined;
}

// The key layout lives in an SDK-free module so local mode can share it.
export {
  materialObjectKey,
  materialVersionPrefix,
  sessionObjectPrefix,
} from "@/lib/ingest/material-keys";

// ---------------------------------------------------------------------------
// Object operations
//
// Thin wrappers over the SDK so callers deal in bytes rather than in streams
// and command objects. Nothing here decides *whether* S3 should be used — that
// is `lib/ingest/material-store.ts`, which routes by deployment target.
// ---------------------------------------------------------------------------

/** Writes an object. `contentType` is advisory metadata, not a gate. */
export async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType?: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );
}

/**
 * Reads an object in full.
 *
 * Lecture material is capped at 20 MB and read once, at extraction time, so
 * buffering the whole object is the right trade rather than streaming it.
 */
export async function getObject(key: string): Promise<Uint8Array> {
  const result = await s3().send(
    new GetObjectCommand({ Bucket: bucketName(), Key: key }),
  );

  if (!result.Body) {
    throw new Error(`S3 object ${key} returned no body`);
  }

  return new Uint8Array(await result.Body.transformToByteArray());
}

/** Whether an object exists, without transferring it. */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucketName(), Key: key }));
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") return false;
    throw error;
  }
}

/** Every object key under a prefix, following pagination to completion. */
export async function listObjectKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const result = await s3().send(
      new ListObjectsV2Command({
        Bucket: bucketName(),
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );

    for (const object of result.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }

    token = result.NextContinuationToken;
  } while (token);

  return keys;
}

/**
 * Deletes every object under a prefix, in batches of 1,000.
 *
 * Used when a Lecture_Material version is replaced: the new version is written
 * to its own prefix and the old prefix is removed afterwards, so a failed
 * replacement never leaves a half-overwritten object.
 */
export async function deletePrefix(prefix: string): Promise<number> {
  const keys = await listObjectKeys(prefix);
  if (keys.length === 0) return 0;

  for (let start = 0; start < keys.length; start += 1000) {
    const batch = keys.slice(start, start + 1000);

    await s3().send(
      new DeleteObjectsCommand({
        Bucket: bucketName(),
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      }),
    );
  }

  return keys.length;
}
