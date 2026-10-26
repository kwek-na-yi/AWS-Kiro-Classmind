import { afterAll, describe, expect, it, vi } from "vitest";

import { pgliteDatabase } from "@/tests/support/pglite";

/**
 * The whole learner journey on the `postgres` target — the hosted deployment's
 * backend — against real PostgreSQL (PGlite). Same routes, same assertions as
 * the local-mode journey; only the store differs. Lecture uploads must land in
 * the database's file table, never on disk.
 *
 * The AWS SDK is mocked to throw, proving the hosted path never loads it.
 */

const SDK_LOADED = "The AWS SDK was imported on the postgres target";
vi.mock("@aws-sdk/client-dynamodb", () => {
  throw new Error(SDK_LOADED);
});
vi.mock("@aws-sdk/lib-dynamodb", () => {
  throw new Error(SDK_LOADED);
});
vi.mock("@aws-sdk/client-s3", () => {
  throw new Error(SDK_LOADED);
});

// PGlite boots PostgreSQL in WebAssembly; give it room under a parallel run.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SAVED = {
  target: process.env.CLASSMIND_TARGET,
  materialDir: process.env.CLASSMIND_LOCAL_MATERIAL_DIR,
};

process.env.CLASSMIND_TARGET = "postgres";
// Anything written to disk on this target would be a bug; point the local
// material root somewhere that does not exist so such a write would be visible.
process.env.CLASSMIND_LOCAL_MATERIAL_DIR = "/nonexistent/classmind-must-not-write-here";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const db = await pgliteDatabase();
const { overrideSqlDatabase } = await import("@/lib/store");
overrideSqlDatabase(db);

afterAll(() => {
  overrideSqlDatabase(null);
  for (const [name, value] of [
    ["CLASSMIND_TARGET", SAVED.target],
    ["CLASSMIND_LOCAL_MATERIAL_DIR", SAVED.materialDir],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const { defineJourney } = await import("@/tests/integration/journey");
await defineJourney({ expectedStorage: "database" });

describe("what the hosted backend actually stored", () => {
  it("keeps lecture bytes in the database file table", async () => {
    const { rows } = await db.query<{ key: string }>("SELECT key FROM classmind_files ORDER BY key");
    // After the journey's reset: the demo lecture only; the upload was purged.
    expect(rows.map((row) => row.key)).toEqual(["sessions/demo/material/v1/demo-lecture.md"]);
  });

  it("keeps every class item in one table", async () => {
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM classmind_items WHERE pk = 'CS#demo' AND starts_with(sk, 'RESP#')",
    );
    expect(rows[0].n).toBe(30);
  });
});

describe("configuration", () => {
  it("refuses to run without a connection string rather than falling back", async () => {
    overrideSqlDatabase(null);
    const { postgresStore } = await import("@/lib/store");
    await expect(postgresStore().then((store) => store.ensureSchema())).rejects.toThrow(
      /DATABASE_URL/,
    );
    overrideSqlDatabase(db);
  });
});
