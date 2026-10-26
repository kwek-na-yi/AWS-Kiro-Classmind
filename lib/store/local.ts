import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

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
 * The embedded store: the whole table as one JSON file on disk.
 *
 * ClassMind's demo data is a few hundred small items, so the simplest store
 * that keeps the server-side semantics the repositories rely on is an
 * in-memory map flushed to disk after every write. It needs no native module,
 * no daemon and no setup, and it survives a server restart.
 *
 * Three properties matter, and each is deliberate:
 *
 * 1. **Every operation is atomic.** Each method does all of its work
 *    synchronously before it yields, so within the one Node process that serves
 *    the app no other request can interleave. Conditional writes and
 *    transactions therefore behave as they do in DynamoDB — a double-clicked
 *    answer is still recorded once.
 * 2. **Other processes are noticed.** `npm run seed` and `npm run demo:reset`
 *    write the same file from a separate process. Before each operation the
 *    file's modification time and size are compared with what was last loaded,
 *    and a change reloads it. A deleted file reads as an empty table, which is
 *    what makes "delete `.classmind/` to reset" work while the server runs.
 * 3. **Values are copied in and out.** Items are cloned through JSON on every
 *    read and write, so a caller mutating a returned object cannot change
 *    stored state, and `undefined` attributes are dropped exactly as the
 *    DynamoDB adapter drops them.
 */

type Partition = Record<string, Item>;

interface StoreFile {
  format: 1;
  partitions: Record<string, Partition>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Sleeps synchronously. Only used between retries of a blocked rename. */
function pauseSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ---------------------------------------------------------------------------
// Pure semantics, shared with the tests
// ---------------------------------------------------------------------------

function contains(value: unknown, member: string): boolean {
  if (Array.isArray(value)) return value.includes(member);
  if (value instanceof Set) return value.has(member);
  if (typeof value === "string") return value.includes(member);
  return false;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether `current` (null when absent) satisfies `condition`. */
export function conditionHolds(current: Item | null, condition?: Condition): boolean {
  if (!condition) return true;

  if (condition.exists === true && !current) return false;
  if (condition.exists === false && current) return false;

  for (const [name, expected] of Object.entries(condition.equals ?? {})) {
    if (!current || !(name in current) || !sameValue(current[name], expected)) return false;
  }

  for (const [name, member] of Object.entries(condition.notContains ?? {})) {
    if (current && contains(current[name], member)) return false;
  }

  return true;
}

/** The item `update` produces from `current`, which may be absent. */
export function applyUpdate(key: Key, current: Item | null, update: UpdateSpec): Item {
  const next: Item = { ...(current ?? {}), PK: key.PK, SK: key.SK };

  for (const [name, value] of Object.entries(update.set ?? {})) {
    next[name] = value;
  }

  for (const [name, by] of Object.entries(update.increment ?? {})) {
    const base = typeof next[name] === "number" ? (next[name] as number) : 0;
    next[name] = base + by;
  }

  for (const [name, values] of Object.entries(update.appendToList ?? {})) {
    const base = Array.isArray(next[name]) ? (next[name] as unknown[]) : [];
    next[name] = [...base, ...values];
  }

  for (const [name, members] of Object.entries(update.addToSet ?? {})) {
    const base = Array.isArray(next[name]) ? (next[name] as string[]) : [];
    next[name] = [...new Set([...base, ...members])];
  }

  return next;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export class LocalStore implements Store {
  private partitions: Record<string, Partition> = {};
  /** `mtimeMs:size` of the file as last loaded or written; null when absent. */
  private fingerprint: string | null = null;

  /**
   * @param file The JSON file backing the store, or null to keep everything in
   *   memory (tests).
   */
  constructor(private readonly file: string | null) {}

  // -- persistence ---------------------------------------------------------

  private stat(): string | null {
    if (!this.file) return null;
    try {
      const stats = statSync(this.file);
      return `${stats.mtimeMs}:${stats.size}`;
    } catch {
      return null;
    }
  }

  /** Reloads from disk when another process has changed or removed the file. */
  private refresh(): void {
    if (!this.file) return;

    const current = this.stat();
    if (current === this.fingerprint) return;

    if (current === null) {
      this.partitions = {};
      this.fingerprint = null;
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<StoreFile>;
      this.partitions = parsed.partitions ?? {};
    } catch (error) {
      throw new Error(
        `The local data file ${this.file} could not be read. Delete it (or run ` +
          "`npm run demo:reset`) to start again from the demo data.",
        { cause: error },
      );
    }
    this.fingerprint = current;
  }

  /**
   * Writes the table to a temporary file and renames it into place, so a crash
   * mid-write never leaves a truncated store behind. Windows can briefly refuse
   * the rename while an indexer or sync client holds the target, so a refused
   * rename is retried before falling back to an in-place write.
   */
  private flush(): void {
    if (!this.file) return;

    mkdirSync(path.dirname(this.file), { recursive: true });

    const body: StoreFile = { format: 1, partitions: this.partitions };
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(body));

    let renamed = false;
    for (let attempt = 0; attempt < 5 && !renamed; attempt += 1) {
      try {
        renameSync(temp, this.file);
        renamed = true;
      } catch {
        pauseSync(20 * (attempt + 1));
      }
    }

    if (!renamed) {
      writeFileSync(this.file, JSON.stringify(body));
      try {
        unlinkSync(temp);
      } catch {
        // A leftover temp file is harmless and is overwritten next time.
      }
    }

    this.fingerprint = this.stat();
  }

  // -- primitives (synchronous, so each public call is atomic) --------------

  private read(key: Key): Item | null {
    return this.partitions[key.PK]?.[key.SK] ?? null;
  }

  private write(item: Item): void {
    const PK = String(item.PK);
    const SK = String(item.SK);
    if (!item.PK || !item.SK) throw new Error("An item needs both PK and SK");

    const partition = (this.partitions[PK] ??= {});
    partition[SK] = clone(item);
  }

  private remove(key: Key): void {
    const partition = this.partitions[key.PK];
    if (!partition) return;
    delete partition[key.SK];
    if (Object.keys(partition).length === 0) delete this.partitions[key.PK];
  }

  private check(key: Key, condition?: Condition): void {
    if (!conditionHolds(this.read(key), condition)) {
      throw new ConditionFailedError(`Condition failed for ${key.PK} / ${key.SK}`);
    }
  }

  // -- Store ----------------------------------------------------------------

  async get(key: Key): Promise<Item | null> {
    this.refresh();
    const item = this.read(key);
    return item ? clone(item) : null;
  }

  async batchGet(keys: readonly Key[]): Promise<Item[]> {
    this.refresh();
    return keys.flatMap((key) => {
      const item = this.read(key);
      return item ? [clone(item)] : [];
    });
  }

  async put(item: Item, condition?: Condition): Promise<void> {
    this.refresh();
    this.check({ PK: String(item.PK), SK: String(item.SK) }, condition);
    this.write(item);
    this.flush();
  }

  async update(key: Key, update: UpdateSpec, condition?: Condition): Promise<void> {
    this.refresh();
    this.check(key, condition);
    this.write(applyUpdate(key, this.read(key), update));
    this.flush();
  }

  async query(pk: string, prefix: string): Promise<Item[]> {
    this.refresh();
    const partition = this.partitions[pk] ?? {};

    return Object.keys(partition)
      .filter((sk) => sk.startsWith(prefix))
      .sort(compareSortKeys)
      .map((sk) => clone(partition[sk]));
  }

  async count(pk: string, prefix: string): Promise<number> {
    this.refresh();
    return Object.keys(this.partitions[pk] ?? {}).filter((sk) => sk.startsWith(prefix))
      .length;
  }

  async putAll(items: readonly Item[]): Promise<void> {
    if (items.length === 0) return;
    this.refresh();
    for (const item of items) this.write(item);
    this.flush();
  }

  async deleteAll(keys: readonly Key[]): Promise<void> {
    if (keys.length === 0) return;
    this.refresh();
    for (const key of keys) this.remove(key);
    this.flush();
  }

  async transact(ops: readonly TransactOp[]): Promise<void> {
    this.refresh();

    // Every condition is checked against the state before any write, as a
    // DynamoDB transaction does, and one failure applies nothing.
    for (const op of ops) {
      const key = op.kind === "put" ? { PK: String(op.item.PK), SK: String(op.item.SK) } : op.key;
      this.check(key, op.condition);
    }

    for (const op of ops) {
      if (op.kind === "put") this.write(op.item);
      else this.write(applyUpdate(op.key, this.read(op.key), op.update));
    }

    this.flush();
  }

  /** Every partition key present. Used by the reset script only. */
  async partitionKeys(): Promise<string[]> {
    this.refresh();
    return Object.keys(this.partitions);
  }
}

/**
 * DynamoDB orders sort keys by their UTF-8 bytes. For the ASCII keys this data
 * model uses, plain code-unit comparison gives the same order.
 */
function compareSortKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// One instance per file per process
// ---------------------------------------------------------------------------

/**
 * Held on `globalThis` rather than in module scope: the dev server can
 * evaluate this module more than once (one copy per route bundle), and two
 * in-memory copies of the same table would each believe they were current.
 */
const REGISTRY = Symbol.for("classmind.localStores");

type Registry = Map<string, LocalStore>;

export function localStoreFor(file: string | null): LocalStore {
  const scope = globalThis as unknown as Record<symbol, Registry | undefined>;
  const registry = (scope[REGISTRY] ??= new Map());
  const id = file ?? ":memory:";

  let store = registry.get(id);
  if (!store) {
    store = new LocalStore(file);
    registry.set(id, store);
  }
  return store;
}

/** Test seam: forgets every instance, so the next call starts empty. */
export function resetLocalStores(): void {
  const scope = globalThis as unknown as Record<symbol, Registry | undefined>;
  scope[REGISTRY]?.clear();
}
