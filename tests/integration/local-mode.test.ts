import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, vi } from "vitest";

/**
 * The whole application in local mode, with nothing mocked but the AWS SDK —
 * and that only to prove it is never loaded.
 *
 * The real route handlers run against the real embedded store (in memory for
 * the test), seeded by the same bootstrap a fresh clone triggers on its first
 * join. Every number the UI would show is checked against an independent
 * recomputation from the persisted responses.
 */

const SDK_LOADED = "The AWS SDK was imported in local mode";
vi.mock("@aws-sdk/client-dynamodb", () => {
  throw new Error(SDK_LOADED);
});
vi.mock("@aws-sdk/lib-dynamodb", () => {
  throw new Error(SDK_LOADED);
});
vi.mock("@aws-sdk/client-s3", () => {
  throw new Error(SDK_LOADED);
});

const MATERIAL_DIR = mkdtempSync(path.join(tmpdir(), "classmind-local-mode-"));
const SAVED = {
  target: process.env.CLASSMIND_TARGET,
  dataDir: process.env.CLASSMIND_DATA_DIR,
  materialDir: process.env.CLASSMIND_LOCAL_MATERIAL_DIR,
};

delete process.env.CLASSMIND_TARGET;
delete process.env.AWS_REGION;
delete process.env.CLASSMIND_TABLE;
delete process.env.CLASSMIND_BUCKET;
process.env.CLASSMIND_DATA_DIR = ":memory:";
process.env.CLASSMIND_LOCAL_MATERIAL_DIR = MATERIAL_DIR;

const { resetLocalStores } = await import("@/lib/store/local");
resetLocalStores();


afterAll(() => {
  resetLocalStores();
  rmSync(MATERIAL_DIR, { recursive: true, force: true });
  for (const [name, value] of [
    ["CLASSMIND_TARGET", SAVED.target],
    ["CLASSMIND_DATA_DIR", SAVED.dataDir],
    ["CLASSMIND_LOCAL_MATERIAL_DIR", SAVED.materialDir],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});


const { defineJourney } = await import("@/tests/integration/journey");
await defineJourney({ expectedStorage: "local" });
