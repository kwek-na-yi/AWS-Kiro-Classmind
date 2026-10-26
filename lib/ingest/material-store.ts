import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  materialObjectKey,
  materialVersionPrefix,
  sessionObjectPrefix,
} from "@/lib/ingest/material-keys";
import { hasObjectStorage, localDataRoot, usesPostgres } from "@/lib/target";
import type { MaterialExtension } from "@/lib/types";

/** The S3 module, loaded only on the AWS target so local mode never imports the SDK. */
const s3 = () => import("@/lib/aws/s3");

/** The PostgreSQL store, which holds lecture files on the `postgres` target. */
const database = async () => (await import("@/lib/store")).postgresStore();

/**
 * Where Lecture_Material bytes live.
 *
 * This is the only module that decides between S3 and the local filesystem.
 * Everything upstream deals in a storage key and never learns which it got —
 * the key itself says where the bytes are, so a caller reading a material back
 * needs no environment knowledge at all.
 *
 * On the AWS target, bytes go to S3 under
 * `sessions/<sid>/material/v<n>/<uuid>.<ext>`. On the local target there is no
 * bucket, so the key records a file on disk: the lecture the seed script read,
 * or — for a browser upload, which arrives as bytes and has no home of its own —
 * a file written under the local material root using that same
 * `sessions/<sid>/material/v<n>/` layout. Both are read back through
 * `loadMaterialBytes`.
 */

/** Marks a key as a path on the local filesystem rather than an S3 object. */
const LOCAL_SCHEME = "file://";

/**
 * Where uploaded bytes live when there is no bucket.
 *
 * Read on each call rather than at module load, so a test can point it at a
 * temporary directory. The default sits inside the working tree under a
 * git-ignored directory: an upload on the local target is developer data, and
 * putting it beside the project keeps it findable rather than scattering it
 * through the system temp directory.
 */
function localMaterialRoot(): string {
  const configured = process.env.CLASSMIND_LOCAL_MATERIAL_DIR?.trim();
  return configured ? configured : path.join(localDataRoot(), "materials");
}

export type MaterialStorage = "s3" | "local" | "database";

/**
 * Marks a key as a row in the database's file table (the `postgres` target).
 * Serverless hosts have no durable disk, so uploaded bytes live in the same
 * database as everything else — private, and gone when the class is reset.
 */
const DATABASE_SCHEME = "db://";

function isDatabaseKey(key: string): boolean {
  return key.startsWith(DATABASE_SCHEME);
}

export interface StoredMaterial {
  /** Persisted on the material record as `s3Key`. */
  key: string;
  storage: MaterialStorage;
  bytes: number;
}

/** Whether a stored key points at an S3 object. */
export function isObjectKey(key: string): boolean {
  return !key.startsWith(LOCAL_SCHEME) && !isDatabaseKey(key);
}

/** The key recorded for a lecture file read from disk. */
export function localMaterialKey(filePath: string): string {
  // A file inside the project is recorded relative to it, so the key stays
  // valid when the repository is cloned somewhere else. Anything outside the
  // project keeps its absolute path.
  const absolute = path.resolve(filePath);
  const relative = path.relative(process.cwd(), absolute);
  const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);

  return `${LOCAL_SCHEME}${(inside ? relative : absolute).replace(/\\/g, "/")}`;
}

/**
 * Ids that become directory or file names under the local material root.
 *
 * Every Class_Session id and object id ClassMind creates fits this, but nothing
 * upstream enforces a filesystem-safe alphabet, so the local writer checks it
 * here rather than trusting that a `..` or a separator can never arrive.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * A path under the local material root built from ids, refused unless every id
 * is a plain name and the result stays inside the root.
 */
function assertSafeIds(ids: Record<string, string>): void {
  for (const [field, value] of Object.entries(ids)) {
    if (!SAFE_PATH_SEGMENT.test(value)) {
      throw new RangeError(`${field} is not a safe path segment: ${JSON.stringify(value)}`);
    }
  }
}

function pathUnderRoot(ids: Record<string, string>, relative: string): string {
  assertSafeIds(ids);

  const root = path.resolve(localMaterialRoot());
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new RangeError("Refusing a material path outside the local material root");
  }
  return resolved;
}

/**
 * Local mode must never reach S3. A stored key without the `file://` scheme can
 * only have come from data written on the AWS target, so it is refused rather
 * than resolved against whatever credentials the machine happens to hold.
 */
function assertObjectStorage(key: string): void {
  if (!hasObjectStorage()) {
    throw new Error(
      `Lecture material "${key}" is stored in S3, but S3 is only available with CLASSMIND_TARGET=aws.`,
    );
  }
}

/** The absolute path a local key names, resolving a project-relative one. */
function localPath(key: string): string {
  // Not traced: the path is data (an upload or the demo lecture), not code.
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), key.slice(LOCAL_SCHEME.length));
}

export interface StoreInput {
  sessionId: string;
  version: number;
  ext: MaterialExtension;
  bytes: Uint8Array;
  /** A stable id for the object, so a reseed overwrites rather than accumulates. */
  objectId: string;
  /**
   * The file the bytes were read from, when there is one. Recorded as the key
   * on the local target so the developer's own lecture file is referenced in
   * place rather than copied. An upload has no such file and omits this.
   */
  sourcePath?: string;
  contentType?: string;
}

/**
 * Stores lecture bytes and returns the key to persist.
 *
 * The object id is supplied rather than generated, so seeding the same demo
 * twice writes the same key and replaces the object instead of leaving an
 * orphan behind.
 */
export async function storeMaterialBytes(
  input: StoreInput,
): Promise<StoredMaterial> {
  if (usesPostgres()) {
    // Always copied into the database, even the demo lecture: a serverless
    // host's own files are not something to keep references to.
    assertSafeIds({ sessionId: input.sessionId, objectId: input.objectId });
    const key = materialObjectKey(input.sessionId, input.version, input.objectId, input.ext);
    await (await database()).putFile(key, input.bytes, input.contentType);
    return { key: `${DATABASE_SCHEME}${key}`, storage: "database", bytes: input.bytes.byteLength };
  }

  if (!hasObjectStorage()) {
    // Seeding names the file it read, and referencing it beats copying it.
    if (input.sourcePath) {
      return {
        key: localMaterialKey(input.sourcePath),
        storage: "local",
        bytes: input.bytes.byteLength,
      };
    }

    // An upload arrives as bytes with nowhere to point at, so they are written
    // under the same `sessions/<sid>/material/v<n>/` path S3 would have used.
    // One layout on both targets means a stored key is read the same way and a
    // material version is still the unit that gets replaced.
    const filePath = pathUnderRoot(
      { sessionId: input.sessionId, objectId: input.objectId },
      materialObjectKey(input.sessionId, input.version, input.objectId, input.ext),
    );

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.bytes);

    return {
      key: localMaterialKey(filePath),
      storage: "local",
      bytes: input.bytes.byteLength,
    };
  }

  const key = materialObjectKey(
    input.sessionId,
    input.version,
    input.objectId,
    input.ext,
  );

  await (await s3()).putObject(key, input.bytes, input.contentType);

  return { key, storage: "s3", bytes: input.bytes.byteLength };
}

/**
 * Reads lecture bytes back from wherever they were stored.
 *
 * This is the read the extraction pipeline performs. On the AWS target it is a
 * genuine `GetObject`, so the source text a Recap is grounded in has made a
 * real round trip through object storage.
 */
export async function loadMaterialBytes(key: string): Promise<Uint8Array> {
  if (isDatabaseKey(key)) {
    const bytes = await (await database()).getFile(key.slice(DATABASE_SCHEME.length));
    if (!bytes) throw new Error(`Lecture material ${key} is no longer stored`);
    return bytes;
  }

  if (!isObjectKey(key)) {
    const filePath = localPath(key);
    return new Uint8Array(await readFile(filePath));
  }

  assertObjectStorage(key);
  return (await s3()).getObject(key);
}

/** Whether the stored bytes are still retrievable. */
export async function materialExists(key: string): Promise<boolean> {
  if (isDatabaseKey(key)) {
    if (!usesPostgres()) return false;
    return (await (await database()).getFile(key.slice(DATABASE_SCHEME.length))) !== null;
  }

  if (!isObjectKey(key)) {
    try {
      await readFile(localPath(key));
      return true;
    } catch {
      return false;
    }
  }

  // Unreachable bytes are absent as far as local mode is concerned.
  if (!hasObjectStorage()) return false;
  return (await s3()).objectExists(key);
}

/**
 * Removes the objects for one material version.
 *
 * A no-op on the local target, where the lecture file belongs to the developer
 * and deleting it would be wrong.
 */
export async function purgeMaterialVersion(
  sessionId: string,
  version: number,
): Promise<number> {
  if (usesPostgres()) {
    return (await database()).deleteFiles(materialVersionPrefix(sessionId, version));
  }
  if (!hasObjectStorage()) return 0;

  return (await s3()).deletePrefix(materialVersionPrefix(sessionId, version));
}

/**
 * Removes every stored lecture file of one Class_Session: rows in the database
 * file table on the `postgres` target, or files under the local material root.
 * Locally only files ClassMind wrote are touched — a lecture referenced in place
 * (the demo lecture in the repository) lives elsewhere and is never deleted.
 */
export async function purgeLocalSessionFiles(sessionId: string): Promise<void> {
  if (usesPostgres()) {
    assertSafeIds({ sessionId });
    await (await database()).deleteFiles(sessionObjectPrefix(sessionId));
    return;
  }
  if (hasObjectStorage()) return;
  // A recursive delete is the last place a stray `..` should be allowed to land.
  await rm(pathUnderRoot({ sessionId }, path.join("sessions", sessionId)), {
    recursive: true,
    force: true,
  });
}

/** The content type recorded on an uploaded object. */
export function contentTypeFor(ext: MaterialExtension): string {
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "md":
    case "markdown":
      return "text/markdown";
    case "txt":
      return "text/plain";
  }
}
