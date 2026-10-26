import { PGlite } from "@electric-sql/pglite";

import type { SqlDatabase, SqlExecutor } from "@/lib/store/postgres";

/**
 * A real PostgreSQL (compiled to WebAssembly, in memory) behind the same
 * interface production's `pg` pool implements — so tests exercise the actual
 * SQL the hosted deployment runs, without Docker or a cloud database.
 */
export async function pgliteDatabase(): Promise<SqlDatabase> {
  const db = new PGlite();
  await db.waitReady;

  const wrap = (executor: Pick<PGlite, "query">): SqlExecutor => ({
    async query(text, params) {
      const result = await executor.query(text, params as unknown[] | undefined);
      return { rows: result.rows as never[] };
    },
  });

  return {
    ...wrap(db),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx as unknown as Pick<PGlite, "query">))),
  };
}
