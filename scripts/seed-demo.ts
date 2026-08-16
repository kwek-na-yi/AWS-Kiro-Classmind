/**
 * Seeds the demo Class_Session.
 *
 * Writes through exactly the same ingest and repository functions the live
 * upload path uses, so the seeded class is not a special case — it is a normal
 * Class_Session that happens to have been created from a file on disk instead of
 * a browser upload.
 *
 * Usage:  npm run seed -- [path-to-lecture-file]
 *
 * Requires AWS_REGION, CLASSMIND_TABLE and CLASSMIND_BUCKET in the environment
 * and credentials on the standard provider chain. The bucket is not written to:
 * the source bytes are read from disk, so no object is uploaded.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { generateAndPersistQuizPool } from "@/lib/ai/services/pool";
import { hashInstructorToken, newInstructorToken } from "@/lib/http/auth";
import { extractSourceText, isProcessable } from "@/lib/ingest/extract";
import { deriveTopics } from "@/lib/ingest/topics";
import { segmentUnits } from "@/lib/ingest/units";
import {
  putMaterial,
  putSourceUnits,
  putTopics,
  setMaterialStatus,
} from "@/lib/repo/material";
import { createSession, JoinCodeTakenError } from "@/lib/repo/session";

/** Fixed so the presenter can type it, and reserved like any other Join_Code. */
const DEMO_JOIN_CODE = "CM2026";
const DEMO_SESSION_ID = "demo";
const DEMO_SESSION_NAME = "Relational Databases — Week 4";
const MATERIAL_VERSION = 1;

async function main(): Promise<void> {
  const file =
    process.argv[2] ??
    path.resolve(process.cwd(), "tests/fixtures/lecture-sample.md");

  const ext = path.extname(file).replace(/^\./, "") || "md";
  const bytes = new Uint8Array(readFileSync(file));

  console.log(`Reading ${file}`);

  const extraction = await extractSourceText({ ext, bytes, filename: path.basename(file) });

  if (!extraction.ok) {
    throw new Error(`Could not read the lecture material: ${extraction.reason}`);
  }

  if (!isProcessable(extraction)) {
    throw new Error(
      `Only ${extraction.charCount} characters were extracted — too few to build a class from.`,
    );
  }

  const units = segmentUnits(extraction.blocks, MATERIAL_VERSION);
  const topics = deriveTopics(units, MATERIAL_VERSION);

  console.log(
    `Extracted ${extraction.charCount} characters → ${units.length} source units → ${topics.length} topics`,
  );

  const instructorToken = newInstructorToken();

  try {
    await createSession({
      sessionId: DEMO_SESSION_ID,
      name: DEMO_SESSION_NAME,
      joinCode: DEMO_JOIN_CODE,
      instructorTokenHash: hashInstructorToken(instructorToken),
      isDemo: true,
      materialVersion: MATERIAL_VERSION,
    });

    console.log(`Created session ${DEMO_SESSION_ID} with join code ${DEMO_JOIN_CODE}`);
  } catch (error) {
    if (error instanceof JoinCodeTakenError) {
      // Re-seeding is expected between rehearsals: the session already exists,
      // and the writes below overwrite its material by key.
      console.log(`Join code ${DEMO_JOIN_CODE} already reserved — reseeding its material`);
    } else {
      throw error;
    }
  }

  await putMaterial(DEMO_SESSION_ID, {
    sessionId: DEMO_SESSION_ID,
    version: MATERIAL_VERSION,
    s3Key: `seed://${path.basename(file)}`,
    filename: path.basename(file),
    ext: ext === "markdown" ? "markdown" : (ext as "pdf" | "txt" | "md"),
    bytes: bytes.byteLength,
    status: "processing",
    stage: "Storing material",
    charCount: extraction.charCount,
    unitCount: units.length,
    poolStatus: "pending",
  });

  await putSourceUnits(DEMO_SESSION_ID, units);
  await putTopics(DEMO_SESSION_ID, topics);

  await setMaterialStatus(DEMO_SESSION_ID, MATERIAL_VERSION, {
    status: "ready",
    stage: "Generating quiz",
    charCount: extraction.charCount,
    unitCount: units.length,
  });

  console.log("Persisted material, source units and topics");

  const pool = await generateAndPersistQuizPool({
    sessionId: DEMO_SESSION_ID,
    materialVersion: MATERIAL_VERSION,
    requestId: "seed",
  });

  console.log(
    `Quiz pool ${pool.poolStatus}: ${pool.persisted} items ` +
      `(level 1: ${pool.countsByDifficulty[1]}, level 2: ${pool.countsByDifficulty[2]}, level 3: ${pool.countsByDifficulty[3]})`,
  );

  if (!pool.meetsEngineMinimum) {
    console.warn(
      "Warning: the pool holds fewer than 6 items, so a quiz session will be short.",
    );
  }

  console.log(`\nDone. Join at http://localhost:3000 with code ${DEMO_JOIN_CODE}`);
  console.log(`Instructor token (shown once): ${instructorToken}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
