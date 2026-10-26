import "server-only";

import { randomUUID } from "node:crypto";

import { generateAndPersistQuizPool } from "@/lib/ai/services/pool";
import { extractSourceText, isProcessable, MIN_READABLE_CHARS } from "@/lib/ingest/extract";
import {
  contentTypeFor,
  loadMaterialBytes,
  purgeMaterialVersion,
  storeMaterialBytes,
  type MaterialStorage,
} from "@/lib/ingest/material-store";
import { deriveTopics } from "@/lib/ingest/topics";
import { segmentUnits } from "@/lib/ingest/units";
import {
  putMaterial,
  putSourceUnits,
  putTopics,
  setMaterialStatus,
} from "@/lib/repo/material";
import { setMaterialVersion } from "@/lib/repo/session";
import type { LectureMaterial, MaterialExtension, PoolStatus, Topic } from "@/lib/types";

/**
 * Ingestion of an uploaded Lecture_Material, end to end.
 *
 * This is the one place the upload path is assembled, and it assembles it out
 * of the pieces that already existed: `material-store` puts the bytes where the
 * target keeps them, `extract` reads them back into structured text, `units` and
 * `topics` derive the structure, `repo/material` persists it and the pool
 * service builds the Quiz_Pool. Nothing here re-implements any of those steps,
 * and the Route Handler that calls it performs none of them itself.
 *
 * Three decisions are worth stating.
 *
 * **The upload lands on a new material version.** It never overwrites the one
 * the class is currently reading. Everything derived from the previous version —
 * its source units, Topics, Quiz_Pool and retained Recaps — stays exactly where
 * it is, so the seeded CM2026 demo survives an upload into its own session and
 * can be restored by pointing the Class_Session back at v1.
 *
 * **The Class_Session pointer moves last.** `setMaterialVersion` is the final
 * write, after the material, the units, the Topics and the pool are all durable.
 * Readers resolve the version from that pointer, so a half-built version is
 * never visible and a failure part-way through leaves the class on the material
 * it already had.
 *
 * **The bytes make a real round trip.** What is extracted is what came back out
 * of storage, not the buffer the browser sent. On the AWS target that is a
 * genuine `PutObject` followed by a genuine `GetObject`, so a Recap grounded in
 * this material is grounded in bytes that actually reached S3.
 */

/** Why an upload could not become a lecture. Each maps to one error code. */
export type UploadFailureReason =
  | "empty_file"
  | "unreadable"
  | "no_readable_text";

export interface UploadFailure {
  ok: false;
  reason: UploadFailureReason;
  message: string;
}

export interface UploadSuccess {
  ok: true;
  material: LectureMaterial;
  topics: Topic[];
  /** Where the original file was put, so the caller can report S3 vs disk. */
  storage: MaterialStorage;
  pool: {
    poolStatus: PoolStatus;
    itemCount: number;
    /** False when the pool is too thin to fill a Quiz_Session. */
    meetsEngineMinimum: boolean;
  };
}

export type UploadResult = UploadSuccess | UploadFailure;

export interface UploadInput {
  sessionId: string;
  /** The version the class is on now; the upload becomes the one after it. */
  currentVersion: number;
  /** The name as uploaded, shown back to the Learner as the lecture's name. */
  filename: string;
  /** Already narrowed by `validateMaterialExtension` in the handler. */
  ext: MaterialExtension;
  bytes: Uint8Array;
  requestId?: string;
}

function failure(reason: UploadFailureReason, message: string): UploadFailure {
  return { ok: false, reason, message };
}

/**
 * Stores, extracts, segments, persists and builds a quiz from an uploaded file.
 *
 * A file that cannot be read comes back as a typed failure, never as a throw:
 * the extraction layer already distinguishes an empty upload from a corrupt one
 * from a scanned page with no text layer, and the handler turns each into its
 * own error code.
 */
export async function ingestUploadedMaterial(
  input: UploadInput,
): Promise<UploadResult> {
  const { sessionId, ext, filename } = input;
  const version = input.currentVersion + 1;

  if (input.bytes.byteLength === 0) {
    return failure("empty_file", "The uploaded file is empty.");
  }

  const stored = await storeMaterialBytes({
    sessionId,
    version,
    ext,
    bytes: input.bytes,
    // A fresh id per upload. The version prefix already isolates this material
    // from the previous one, so nothing is overwritten either way.
    objectId: randomUUID(),
    contentType: contentTypeFor(ext),
  });

  // Read back from storage and extract from *that*, so the Source_Text every
  // Recap and Quiz_Item is grounded in has genuinely round-tripped.
  const bytes = await loadMaterialBytes(stored.key);
  const extraction = await extractSourceText({ ext, bytes, filename });

  if (!extraction.ok || !isProcessable(extraction)) {
    // Nothing has been written to DynamoDB yet, so the only thing to undo is
    // the object. Removing it keeps a rejected upload from leaving bytes behind
    // under a version the class will never be pointed at.
    await purgeMaterialVersion(sessionId, version);

    if (!extraction.ok) {
      return extraction.reason === "empty_file"
        ? failure("empty_file", extraction.message)
        : failure("unreadable", extraction.message);
    }

    return failure(
      "no_readable_text",
      `Only ${extraction.charCount} characters of text could be read from this file — ` +
        `at least ${MIN_READABLE_CHARS} are needed. A scanned or image-only PDF has no ` +
        `text layer to read, so upload a text-based file instead.`,
    );
  }

  const units = segmentUnits(extraction.blocks, version);
  const topics = deriveTopics(units, version);

  const material: LectureMaterial = {
    sessionId,
    version,
    s3Key: stored.key,
    filename,
    ext,
    bytes: stored.bytes,
    status: "processing",
    stage: "Storing material",
    charCount: extraction.charCount,
    unitCount: units.length,
    poolStatus: "pending",
  };

  await putMaterial(sessionId, material);
  await putSourceUnits(sessionId, units);
  await putTopics(sessionId, topics);

  await setMaterialStatus(sessionId, version, {
    status: "ready",
    stage: "Generating quiz",
    charCount: extraction.charCount,
    unitCount: units.length,
  });

  // Generation is local and deterministic, so building the pool here costs no
  // network round trip and the Learner is never sent to a quiz that does not
  // exist yet. A pool that comes back unavailable is not fatal: the Recap is
  // still readable, which is what the material's `poolStatus` records.
  const pool = await generateAndPersistQuizPool({
    sessionId,
    materialVersion: version,
    requestId: input.requestId,
  });

  // Last, and only now: the class starts reading the new material.
  await setMaterialVersion(sessionId, version);

  return {
    ok: true,
    material: {
      ...material,
      status: "ready",
      stage: "Generating quiz",
      poolStatus: pool.poolStatus,
    },
    topics,
    storage: stored.storage,
    pool: {
      poolStatus: pool.poolStatus,
      itemCount: pool.persisted,
      meetsEngineMinimum: pool.meetsEngineMinimum,
    },
  };
}
