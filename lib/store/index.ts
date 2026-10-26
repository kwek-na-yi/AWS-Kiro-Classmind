import "server-only";

import path from "node:path";

import { localStoreFor } from "@/lib/store/local";
import type { PostgresStore, SqlDatabase } from "@/lib/store/postgres";
import type { Store } from "@/lib/store/types";
import { deploymentTarget, localDataRoot, onServerlessHost } from "@/lib/target";

/**
 * Resolves the store for the current target.
 *
 * - `local` (default): the embedded file store.
 * - `postgres`: PostgreSQL via DATABASE_URL — the hosted-demo backend.
 * - `dynamodb-local` / `aws`: the optional DynamoDB adapter.
 *
 * Each non-default backend is loaded with a dynamic `import()`, so local mode
 * never loads `pg` or the AWS SDK.
 */

let dynamo: Store | undefined;

/** The file the embedded store lives in. `CLASSMIND_DATA_DIR=:memory:` keeps it in memory. */
export function localStoreFile(): string | null {
  if (process.env.CLASSMIND_DATA_DIR?.trim() === ":memory:") return null;
  return path.join(localDataRoot(), "data", "store.json");
}

const POSTGRES = Symbol.for("classmind.postgresStore");
const SQL_OVERRIDE = Symbol.for("classmind.sqlOverride");

type Scope = Record<symbol, unknown>;

/**
 * Test seam: runs the `postgres` target against a supplied database (PGlite in
 * the test suite) instead of DATABASE_URL. Pass null to clear.
 */
export function overrideSqlDatabase(db: SqlDatabase | null): void {
  const scope = globalThis as unknown as Scope;
  scope[SQL_OVERRIDE] = db ?? undefined;
  scope[POSTGRES] = undefined;
}

/** The PostgreSQL store, which also holds lecture files and rate limits. */
export async function postgresStore(): Promise<PostgresStore> {
  const scope = globalThis as unknown as Scope;
  const existing = scope[POSTGRES] as PostgresStore | undefined;
  if (existing) return existing;

  const { PostgresStore: Impl } = await import("@/lib/store/postgres");
  const db =
    (scope[SQL_OVERRIDE] as SqlDatabase | undefined) ??
    (await import("@/lib/store/pg")).pgDatabase();

  const created = new Impl(db);
  scope[POSTGRES] = created;
  return created;
}

export async function store(): Promise<Store> {
  switch (deploymentTarget()) {
    case "local":
      if (onServerlessHost()) {
        // No silent fallback: a file on a serverless instance is neither durable
        // nor shared, so the demo would lose data between requests.
        throw new Error(
          "The local file store cannot be used on a serverless host. Set CLASSMIND_TARGET=postgres " +
            "and connect a database (DATABASE_URL).",
        );
      }
      return localStoreFor(localStoreFile());

    case "postgres":
      return postgresStore();

    case "dynamodb-local":
    case "aws":
      if (!dynamo) {
        const { DynamoStore } = await import("@/lib/store/dynamo");
        dynamo = new DynamoStore();
      }
      return dynamo;
  }
}

export { ConditionFailedError } from "@/lib/store/types";
export type { Condition, Item, Key, Store, TransactOp, UpdateSpec } from "@/lib/store/types";
