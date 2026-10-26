/**
 * The storage port every repository builds on.
 *
 * ClassMind's data model is one logical table of items addressed by a
 * partition key (`PK`) and a sort key (`SK`), read by key or by sort-key prefix
 * within one partition. That model was designed for DynamoDB, but nothing about
 * it requires DynamoDB, so the operations are declared here as a small
 * backend-neutral interface with two implementations:
 *
 * - `lib/store/local.ts`  — an embedded JSON-file store, the default.
 * - `lib/store/dynamo.ts` — the optional DynamoDB adapter.
 *
 * Updates and conditions are declarative rather than DynamoDB expression
 * strings, so the local store can apply them directly and the DynamoDB adapter
 * can translate them. The set is deliberately just what the repositories use.
 */

export type Item = Record<string, unknown>;

export interface Key {
  PK: string;
  SK: string;
}

/** The changes one update applies to an item. Each attribute appears once. */
export interface UpdateSpec {
  /** Overwrites attributes. */
  set?: Record<string, unknown>;
  /** Adds to a numeric attribute, treating an absent one as zero. */
  increment?: Record<string, number>;
  /** Appends to a list attribute, treating an absent one as empty. */
  appendToList?: Record<string, unknown[]>;
  /** Adds members to a string-set attribute, treating an absent one as empty. */
  addToSet?: Record<string, string[]>;
}

/** Preconditions an write must satisfy. All present clauses must hold. */
export interface Condition {
  /** `true`: the item must exist. `false`: it must not. */
  exists?: boolean;
  /** Each attribute must currently equal the given value. */
  equals?: Record<string, unknown>;
  /**
   * Each list or set attribute must not contain the given member. An absent
   * attribute contains nothing, so the clause holds.
   */
  notContains?: Record<string, string>;
}

export type TransactOp =
  | { kind: "put"; item: Item; condition?: Condition }
  | { kind: "update"; key: Key; update: UpdateSpec; condition?: Condition };

/**
 * Thrown when a write's condition is not met — including any condition inside
 * a transaction, in which case none of the transaction's writes are applied.
 */
export class ConditionFailedError extends Error {
  constructor(message = "The conditional write was rejected", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConditionFailedError";
  }
}

export interface Store {
  get(key: Key): Promise<Item | null>;
  /** The items that exist among `keys`, in no guaranteed order. */
  batchGet(keys: readonly Key[]): Promise<Item[]>;
  /** Writes an item, replacing any item with the same key. */
  put(item: Item, condition?: Condition): Promise<void>;
  /** Updates an item in place, creating it when absent unless a condition forbids. */
  update(key: Key, update: UpdateSpec, condition?: Condition): Promise<void>;
  /**
   * Every item in one partition whose sort key begins with `prefix`, in
   * ascending sort-key order. An empty prefix returns the whole partition.
   */
  query(pk: string, prefix: string): Promise<Item[]>;
  count(pk: string, prefix: string): Promise<number>;
  putAll(items: readonly Item[]): Promise<void>;
  deleteAll(keys: readonly Key[]): Promise<void>;
  /** Applies every operation or none of them. */
  transact(ops: readonly TransactOp[]): Promise<void>;
}
