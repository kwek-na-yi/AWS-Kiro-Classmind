import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

import { getEnv } from "@/lib/env";

/**
 * The S3 client and the object key layout for Lecture_Material bytes.
 *
 * S3 holds only the uploaded file. Extracted text, source units and Topics live
 * in DynamoDB, so nothing here is ever queried — objects are written by a
 * presigned browser PUT and read once, server-side, at extraction time.
 */

let client: S3Client | undefined;

export function s3(): S3Client {
  if (client) return client;
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

/**
 * `sessions/<sessionId>/material/v<version>/<uuid>.<ext>`
 *
 * The material version sits in the key, so replacing a Lecture_Material is a
 * write to a new prefix followed by a delete of the old one — never an in-place
 * overwrite, so a failed replacement cannot corrupt a working demo.
 */
export function materialObjectKey(
  sessionId: string,
  version: number,
  objectId: string,
  ext: string,
): string {
  return `${materialVersionPrefix(sessionId, version)}${objectId}.${ext}`;
}

/** The prefix a material-version purge deletes. */
export function materialVersionPrefix(sessionId: string, version: number): string {
  return `sessions/${sessionId}/material/v${version}/`;
}

/** The prefix owning every object of one Class_Session. */
export function sessionObjectPrefix(sessionId: string): string {
  return `sessions/${sessionId}/`;
}
