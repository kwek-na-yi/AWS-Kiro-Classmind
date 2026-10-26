import "server-only";

import { Pool } from "pg";

import type { SqlDatabase, SqlExecutor } from "@/lib/store/postgres";

/**
 * The production SQL client: a small `pg` pool over DATABASE_URL.
 *
 * Loaded only on the `postgres` target. On Vercel each function instance holds
 * its own pool, so it is kept small and points at Neon's pooled endpoint (the
 * `DATABASE_URL` the Neon integration provides), which multiplexes instances
 * onto a few server connections.
 */

/** The connection string, from the variable the Neon/Vercel integration sets. */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
  if (!url) {
    throw new Error(
      "CLASSMIND_TARGET=postgres needs a connection string in DATABASE_URL (or POSTGRES_URL). " +
        "On Vercel, connect a Neon database to the project; locally, unset CLASSMIND_TARGET to use the embedded store.",
    );
  }
  return url;
}

/**
 * States the TLS mode `pg` already applies. Current `pg` treats `require`,
 * `prefer` and `verify-ca` as `verify-full` — full certificate and hostname
 * verification — and prints a warning on every cold start saying so. Asking
 * for `verify-full` explicitly keeps exactly that behaviour without the noise,
 * which otherwise lands in the error-level logs. It never weakens a mode.
 */
export function withExplicitTls(url: string): string {
  try {
    const parsed = new URL(url);
    const mode = parsed.searchParams.get("sslmode");
    if (mode === "require" || mode === "prefer" || mode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

const POOL = Symbol.for("classmind.pgPool");

function pool(): Pool {
  const scope = globalThis as unknown as Record<symbol, Pool | undefined>;
  scope[POOL] ??= new Pool({
    connectionString: withExplicitTls(databaseUrl()),
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  return scope[POOL];
}

export function pgDatabase(): SqlDatabase {
  return {
    async query(text, params) {
      const result = await pool().query(text, params as unknown[] | undefined);
      return { rows: result.rows };
    },

    async transaction(fn) {
      const client = await pool().connect();
      try {
        await client.query("BEGIN");
        const tx: SqlExecutor = {
          async query(text, params) {
            const result = await client.query(text, params as unknown[] | undefined);
            return { rows: result.rows };
          },
        };
        const value = await fn(tx);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
