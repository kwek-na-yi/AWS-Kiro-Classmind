import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { generateAndPersistQuizPool } from "@/lib/ai/services/pool";
import { seedClassActivity, type SeededClass } from "@/lib/demo/class-activity";
import { hashInstructorToken, newInstructorToken } from "@/lib/http/auth";
import { extractSourceText, isProcessable } from "@/lib/ingest/extract";
import { sessionObjectPrefix } from "@/lib/ingest/material-keys";
import {
  contentTypeFor,
  loadMaterialBytes,
  purgeLocalSessionFiles,
  storeMaterialBytes,
} from "@/lib/ingest/material-store";
import { deriveTopics } from "@/lib/ingest/topics";
import { segmentUnits } from "@/lib/ingest/units";
import { joinCodeKey } from "@/lib/repo/keys";
import {
  purgeGeneratedForVersion,
  putMaterial,
  putSourceUnits,
  putTopics,
  setMaterialStatus,
} from "@/lib/repo/material";
import {
  createSession,
  getSession,
  JoinCodeTakenError,
  setMaterialVersion,
} from "@/lib/repo/session";
import { deleteAll, partitionKeys } from "@/lib/repo/table";
import { hasObjectStorage } from "@/lib/target";
import type { MaterialExtension } from "@/lib/types";

/**
 * Building and resetting the demo classes.
 *
 * Everything here writes through the same ingest and repository functions the
 * live upload path uses, so a seeded class is not a special case — it is a
 * normal Class_Session that happens to have been created from a file in the
 * repository instead of a browser upload. All learner names, answers and peer
 * explanations in it are synthetic.
 *
 * Used by the server's first-run bootstrap (`lib/demo/bootstrap.ts`) and by the
 * `npm run seed` / `npm run demo:reset` scripts.
 */

/** Fixed so the presenter can type it, and reserved like any other Join_Code. */
export const DEMO_JOIN_CODE = "CM2026";
export const DEMO_SESSION_ID = "demo";
export const DEMO_SESSION_NAME = "Relational Databases — Week 4";
const DEMO_MATERIAL_VERSION = 1;

/**
 * The class the "upload your own lecture" flow uses.
 *
 * Deliberately not the demo class: an upload moves its class onto a new
 * material version, and the seeded Quiz_Responses behind the
 * Class_Understanding_Map belong to the Topics of version 1.
 */
export const UPLOAD_SESSION_ID = "upload";
export const UPLOAD_JOIN_CODE = "UPLOAD";
export const UPLOAD_SESSION_NAME = "Your own lecture";

/** A class with no material yet still needs a version for its keys to be valid. */
const EMPTY_MATERIAL_VERSION = 1;

/** The synthetic lecture the demo class is built from. */
export function demoLecturePath(): string {
  return path.join(process.cwd(), "lib", "demo", "demo-lecture.md");
}

type Log = (line: string) => void;

export interface SeedSummary {
  topics: number;
  units: number;
  poolItems: number;
  classActivity: SeededClass;
  /** Shown once; only its hash is stored. No route in this build requires it. */
  instructorToken: string;
}

/**
 * Builds (or rebuilds) the demo Class_Session `CM2026` from the synthetic
 * lecture: material, source units, Topics, Quiz_Pool, six synthetic Learners
 * who have taken the quiz, and a validated Study_Thread.
 */
export async function seedDemoClass(
  options: { lecturePath?: string; log?: Log } = {},
): Promise<SeedSummary> {
  const log = options.log ?? (() => {});
  const file = options.lecturePath ?? demoLecturePath();

  const rawExt = path.extname(file).replace(/^\./, "").toLowerCase() || "md";
  const ext = (rawExt === "markdown" ? "markdown" : rawExt) as MaterialExtension;
  // Not traced: the default lecture is included explicitly in next.config.mjs.
  const sourceBytes = new Uint8Array(await readFile(/*turbopackIgnore: true*/ file));

  // Store the bytes, then read them back and extract from *that*. On the AWS
  // target this is a real PutObject followed by a real GetObject; locally the
  // key simply references the lecture file in the repository.
  const stored = await storeMaterialBytes({
    sessionId: DEMO_SESSION_ID,
    version: DEMO_MATERIAL_VERSION,
    ext,
    bytes: sourceBytes,
    // A fixed object id, so re-seeding replaces the object instead of leaving
    // an orphan behind on every run.
    objectId: "demo-lecture",
    sourcePath: file,
    contentType: contentTypeFor(ext),
  });

  const bytes = await loadMaterialBytes(stored.key);
  const extraction = await extractSourceText({ ext, bytes, filename: path.basename(file) });

  if (!extraction.ok) {
    throw new Error(`Could not read the lecture material: ${extraction.reason}`);
  }
  if (!isProcessable(extraction)) {
    throw new Error(
      `Only ${extraction.charCount} characters were extracted — too few to build a class from.`,
    );
  }

  const units = segmentUnits(extraction.blocks, DEMO_MATERIAL_VERSION);
  const topics = deriveTopics(units, DEMO_MATERIAL_VERSION);

  log(`Extracted ${extraction.charCount} characters → ${units.length} source units → ${topics.length} topics`);

  const instructorToken = newInstructorToken();

  try {
    await createSession({
      sessionId: DEMO_SESSION_ID,
      name: DEMO_SESSION_NAME,
      joinCode: DEMO_JOIN_CODE,
      instructorTokenHash: hashInstructorToken(instructorToken),
      isDemo: true,
      materialVersion: DEMO_MATERIAL_VERSION,
    });
    log(`Created session ${DEMO_SESSION_ID} with join code ${DEMO_JOIN_CODE}`);
  } catch (error) {
    if (!(error instanceof JoinCodeTakenError)) throw error;
    // Re-seeding is expected: the session already exists, and the writes below
    // overwrite its material by key.
    log(`Join code ${DEMO_JOIN_CODE} already reserved — reseeding its material`);
  }

  // Clear what a previous seed generated from this material version. Quiz_Items,
  // Recaps and clarifications are keyed by their own content, so without this a
  // re-seed leaves the old generation beside the new one.
  const purged = await purgeGeneratedForVersion(DEMO_SESSION_ID, DEMO_MATERIAL_VERSION);
  if (purged > 0) log(`Cleared ${purged} previously generated item(s)`);

  await putMaterial(DEMO_SESSION_ID, {
    sessionId: DEMO_SESSION_ID,
    version: DEMO_MATERIAL_VERSION,
    s3Key: stored.key,
    filename: path.basename(file),
    ext,
    bytes: stored.bytes,
    status: "processing",
    stage: "Storing material",
    charCount: extraction.charCount,
    unitCount: units.length,
    poolStatus: "pending",
  });

  await putSourceUnits(DEMO_SESSION_ID, units);
  await putTopics(DEMO_SESSION_ID, topics);

  await setMaterialStatus(DEMO_SESSION_ID, DEMO_MATERIAL_VERSION, {
    status: "ready",
    stage: "Generating quiz",
    charCount: extraction.charCount,
    unitCount: units.length,
  });

  // Point the session back at the seeded version explicitly, so a reseed
  // restores the demo even after someone uploaded into this class.
  await setMaterialVersion(DEMO_SESSION_ID, DEMO_MATERIAL_VERSION);

  const pool = await generateAndPersistQuizPool({
    sessionId: DEMO_SESSION_ID,
    materialVersion: DEMO_MATERIAL_VERSION,
    requestId: "seed",
  });

  log(
    `Quiz pool ${pool.poolStatus}: ${pool.persisted} items ` +
      `(level 1: ${pool.countsByDifficulty[1]}, level 2: ${pool.countsByDifficulty[2]}, level 3: ${pool.countsByDifficulty[3]})`,
  );

  // Class Insight is computed from real Quiz_Responses, so the demo needs a
  // class that has actually answered something.
  const classActivity = await seedClassActivity({
    sessionId: DEMO_SESSION_ID,
    materialVersion: DEMO_MATERIAL_VERSION,
    topics,
    log,
  });

  log(
    `Seeded ${classActivity.learners} synthetic learners, ${classActivity.responses} responses ` +
      `and ${classActivity.explanations} peer explanations (study thread on "${classActivity.weakestTopicName}")`,
  );

  return {
    topics: topics.length,
    units: units.length,
    poolItems: pool.persisted,
    classActivity,
    instructorToken,
  };
}

/**
 * Removes every item of one Class_Session, its Join_Code pointer, and on the
 * AWS target its S3 objects. Returns how many items went.
 */
export async function dropClass(sessionId: string): Promise<number> {
  const existing = await getSession(sessionId);
  const keys = await partitionKeys(sessionId);
  if (keys.length > 0) await deleteAll(keys);

  // The Join_Code pointer lives in its own partition, so the wipe above does
  // not reach it.
  if (existing) await deleteAll([joinCodeKey(existing.joinCode)]);

  if (hasObjectStorage()) {
    const s3 = await import("@/lib/aws/s3");
    await s3.deletePrefix(sessionObjectPrefix(sessionId));
  } else {
    await purgeLocalSessionFiles(sessionId);
  }

  return keys.length;
}

/**
 * Empties a Class_Session and recreates it with its Join_Code reserved and no
 * Lecture_Material, so the Lecture view offers the upload control.
 */
export async function resetEmptyClass(input: {
  sessionId: string;
  joinCode: string;
  name: string;
}): Promise<number> {
  const removed = await dropClass(input.sessionId);

  // Release the requested code too, in case it was reserved by a dropped class
  // that no longer has a meta item pointing at it.
  await deleteAll([joinCodeKey(input.joinCode)]);

  await createSession({
    sessionId: input.sessionId,
    name: input.name,
    joinCode: input.joinCode,
    instructorTokenHash: hashInstructorToken(newInstructorToken()),
    materialVersion: EMPTY_MATERIAL_VERSION,
  });

  return removed;
}

/** The demo upload class, empty. */
export function resetUploadClass(): Promise<number> {
  return resetEmptyClass({
    sessionId: UPLOAD_SESSION_ID,
    joinCode: UPLOAD_JOIN_CODE,
    name: UPLOAD_SESSION_NAME,
  });
}

/**
 * Returns both demo classes to their initial state: CM2026 rebuilt from the
 * synthetic lecture, UPLOAD emptied. Anything a visitor did is discarded.
 */
export async function resetDemo(options: { log?: Log } = {}): Promise<SeedSummary> {
  await dropClass(DEMO_SESSION_ID);
  const summary = await seedDemoClass(options);
  await resetUploadClass();
  options.log?.(`Reset ${UPLOAD_SESSION_NAME} (${UPLOAD_JOIN_CODE}) to an empty class`);
  return summary;
}
