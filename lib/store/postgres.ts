import { applyUpdate, conditionHolds } from "@/lib/store/local";
import {
  ConditionFailedError,
  type Condition,
  type Item,
  type Key,
  type Store,
  type TransactOp,
  type UpdateSpec,
} from "@/lib/store/types";

/**
 * The PostgreSQL store — the hosted-demo backend.
 *
 * The same PK/SK item model as every other backend, in one table:
 *
 *   classmind_items (pk text, sk text COLLATE "C", data jsonb, PRIMARY KEY (pk, sk))
 *
 * Lecture files live beside it in `classmind_files`, so a deployment needs one
 * database and nothing else.
 *
 * **Consistency.** Every write runs in a transaction that first takes a
 * transaction-scoped advisory lock on each key it touches, in sorted order, and
 * only then reads, checks its condition and writes. Writers to the same key are
 * therefore serialised across connections and server instances — including
 * writers racing to create a key that does not exist yet, which row locks alone
 * cannot cover. Conditions and updates are evaluated by the same functions the
 * local store uses (`conditionHolds`, `applyUpdate`), so the two backends cannot
 * drift apart in meaning. Transaction-scoped locks are released on commit, which
 * keeps them safe behind a transaction-mode connection pooler such as Neon's.
 *
 * The SQL client is injected, so tests run this exact code against PGlite (real
 * PostgreSQL compiled to WebAssembly) and production runs it against `pg`.
 */

export interface SqlExecutor {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface SqlDatabase extends SqlExecutor {
  /** Runs `fn` in one transaction, committing on success and rolling back on throw. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS classmind_items (
     pk   text NOT NULL,
     sk   text COLLATE "C" NOT NULL,
     data jsonb NOT NULL,
     PRIMARY KEY (pk, sk)
   )`,
  `CREATE TABLE IF NOT EXISTS classmind_files (
     key          text PRIMARY KEY,
     bytes        bytea NOT NULL,
     content_type text,
     created_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS classmind_rate_limits (
     bucket     text PRIMARY KEY,
     count      integer NOT NULL,
     expires_at timestamptz NOT NULL
   )`,
];

/** Rows per multi-row statement, comfortably inside PostgreSQL's parameter limits. */
const CHUNK = 500;

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** The stored body of an item: everything but its key, cloned through JSON. */
function body(item: Item): string {
  const { PK: _pk, SK: _sk, ...rest } = item;
  void _pk;
  void _sk;
  return JSON.stringify(rest);
}

function keyOf(item: Item): Key {
  if (!item.PK || !item.SK) throw new Error("An item needs both PK and SK");
  return { PK: String(item.PK), SK: String(item.SK) };
}

function toItem(row: { pk: string; sk: string; data: unknown }): Item {
  const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  return { ...(data as Item), PK: row.pk, SK: row.sk };
}

function keyId(key: Key): string {
  return `${key.PK}\u001f${key.SK}`;
}

/** Locks every key, de-duplicated and sorted so two writers cannot deadlock. */
async function lockKeys(tx: SqlExecutor, keys: readonly Key[]): Promise<void> {
  const ids = [...new Set(keys.map(keyId))].sort();
  for (const id of ids) {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [id]);
  }
}

async function readOne(tx: SqlExecutor, key: Key): Promise<Item | null> {
  const { rows } = await tx.query<{ pk: string; sk: string; data: unknown }>(
    "SELECT pk, sk, data FROM classmind_items WHERE pk = $1 AND sk = $2",
    [key.PK, key.SK],
  );
  return rows[0] ? toItem(rows[0]) : null;
}

async function upsert(tx: SqlExecutor, items: readonly Item[]): Promise<void> {
  // One statement cannot update the same row twice, so the last write per key wins.
  const byKey = new Map<string, Item>();
  for (const item of items) byKey.set(keyId(keyOf(item)), item);

  for (const batch of chunk([...byKey.values()], CHUNK)) {
    await tx.query(
      `INSERT INTO classmind_items (pk, sk, data)
       SELECT t.pk, t.sk, t.data::jsonb FROM unnest($1::text[], $2::text[], $3::text[]) AS t(pk, sk, data)
       ON CONFLICT (pk, sk) DO UPDATE SET data = EXCLUDED.data`,
      [
        batch.map((item) => String(item.PK)),
        batch.map((item) => String(item.SK)),
        batch.map(body),
      ],
    );
  }
}

function check(current: Item | null, key: Key, condition?: Condition): void {
  if (!conditionHolds(current, condition)) {
    throw new ConditionFailedError(`Condition failed for ${key.PK} / ${key.SK}`);
  }
}

export class PostgresStore implements Store {
  private ready: Promise<void> | undefined;

  constructor(private readonly db: SqlDatabase) {}

  /**
   * Creates the tables on first use. Idempotent, and serialised by an advisory
   * lock so two instances cold-starting together do not race on DDL.
   */
  ensureSchema(): Promise<void> {
    this.ready ??= this.db
      .transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('classmind:schema', 0))");
        for (const statement of SCHEMA) await tx.query(statement);
      })
      .catch((error: unknown) => {
        // Let the next request try again rather than caching the failure.
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }

  private async write<T>(keys: readonly Key[], fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    await this.ensureSchema();
    return this.db.transaction(async (tx) => {
      await lockKeys(tx, keys);
      return fn(tx);
    });
  }

  async get(key: Key): Promise<Item | null> {
    await this.ensureSchema();
    return readOne(this.db, key);
  }

  async batchGet(keys: readonly Key[]): Promise<Item[]> {
    if (keys.length === 0) return [];
    await this.ensureSchema();
    const { rows } = await this.db.query<{ pk: string; sk: string; data: unknown }>(
      `SELECT i.pk, i.sk, i.data FROM classmind_items i
       JOIN unnest($1::text[], $2::text[]) AS k(pk, sk) ON i.pk = k.pk AND i.sk = k.sk`,
      [keys.map((key) => key.PK), keys.map((key) => key.SK)],
    );
    return rows.map(toItem);
  }

  async put(item: Item, condition?: Condition): Promise<void> {
    const key = keyOf(item);
    await this.write([key], async (tx) => {
      if (condition) check(await readOne(tx, key), key, condition);
      await upsert(tx, [item]);
    });
  }

  async update(key: Key, update: UpdateSpec, condition?: Condition): Promise<void> {
    await this.write([key], async (tx) => {
      const current = await readOne(tx, key);
      check(current, key, condition);
      await upsert(tx, [applyUpdate(key, current, update)]);
    });
  }

  async query(pk: string, prefix: string): Promise<Item[]> {
    await this.ensureSchema();
    const { rows } = await this.db.query<{ pk: string; sk: string; data: unknown }>(
      `SELECT pk, sk, data FROM classmind_items
       WHERE pk = $1 AND starts_with(sk, $2) ORDER BY sk`,
      [pk, prefix],
    );
    return rows.map(toItem);
  }

  async count(pk: string, prefix: string): Promise<number> {
    await this.ensureSchema();
    const { rows } = await this.db.query<{ n: number | string }>(
      "SELECT count(*)::int AS n FROM classmind_items WHERE pk = $1 AND starts_with(sk, $2)",
      [pk, prefix],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async putAll(items: readonly Item[]): Promise<void> {
    if (items.length === 0) return;
    await this.write(items.map(keyOf), (tx) => upsert(tx, items));
  }

  async deleteAll(keys: readonly Key[]): Promise<void> {
    if (keys.length === 0) return;
    await this.write(keys, async (tx) => {
      for (const batch of chunk(keys, CHUNK)) {
        await tx.query(
          `DELETE FROM classmind_items i USING unnest($1::text[], $2::text[]) AS k(pk, sk)
           WHERE i.pk = k.pk AND i.sk = k.sk`,
          [batch.map((key) => key.PK), batch.map((key) => key.SK)],
        );
      }
    });
  }

  async transact(ops: readonly TransactOp[]): Promise<void> {
    const keys = ops.map((op) => (op.kind === "put" ? keyOf(op.item) : op.key));

    await this.write(keys, async (tx) => {
      // Every condition is checked against the state before any write, and one
      // failure throws before anything is written, so the rollback is total.
      const current = new Map<string, Item | null>();
      for (const key of keys) current.set(keyId(key), await readOne(tx, key));

      ops.forEach((op, index) => check(current.get(keyId(keys[index])) ?? null, keys[index], op.condition));

      const writes = ops.map((op, index) =>
        op.kind === "put"
          ? op.item
          : applyUpdate(op.key, current.get(keyId(keys[index])) ?? null, op.update),
      );
      await upsert(tx, writes);
    });
  }

  // -- Lecture files ----------------------------------------------------------

  async putFile(key: string, bytes: Uint8Array, contentType?: string): Promise<void> {
    await this.ensureSchema();
    await this.db.query(
      `INSERT INTO classmind_files (key, bytes, content_type) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET bytes = EXCLUDED.bytes, content_type = EXCLUDED.content_type,
         created_at = now()`,
      [key, Buffer.from(bytes), contentType ?? null],
    );
  }

  async getFile(key: string): Promise<Uint8Array | null> {
    await this.ensureSchema();
    const { rows } = await this.db.query<{ bytes: Uint8Array }>(
      "SELECT bytes FROM classmind_files WHERE key = $1",
      [key],
    );
    return rows[0] ? new Uint8Array(rows[0].bytes) : null;
  }

  async deleteFiles(prefix: string): Promise<number> {
    await this.ensureSchema();
    const { rows } = await this.db.query<{ n: number }>(
      `WITH gone AS (DELETE FROM classmind_files WHERE starts_with(key, $1) RETURNING 1)
       SELECT count(*)::int AS n FROM gone`,
      [prefix],
    );
    return Number(rows[0]?.n ?? 0);
  }

  // -- Rate limiting ------------------------------------------------------------

  /**
   * Counts one hit in a fixed window and returns the count so far, atomically.
   * Expired windows restart at 1.
   */
  async hit(bucket: string, windowSeconds: number): Promise<number> {
    await this.ensureSchema();
    const { rows } = await this.db.query<{ count: number }>(
      `INSERT INTO classmind_rate_limits (bucket, count, expires_at)
       VALUES ($1, 1, now() + make_interval(secs => $2::double precision))
       ON CONFLICT (bucket) DO UPDATE SET
         count = CASE WHEN classmind_rate_limits.expires_at <= now() THEN 1
                      ELSE classmind_rate_limits.count + 1 END,
         expires_at = CASE WHEN classmind_rate_limits.expires_at <= now()
                           THEN now() + make_interval(secs => $2::double precision)
                           ELSE classmind_rate_limits.expires_at END
       RETURNING count`,
      [bucket, windowSeconds],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Drops expired rate-limit windows. */
  async pruneRateLimits(): Promise<void> {
    await this.ensureSchema();
    await this.db.query("DELETE FROM classmind_rate_limits WHERE expires_at <= now()");
  }

  /** Drops every rate-limit window — part of returning the demo to a clean state. */
  async clearRateLimits(): Promise<void> {
    await this.ensureSchema();
    await this.db.query("DELETE FROM classmind_rate_limits");
  }
}
