import "server-only";

import { sessionPk } from "@/lib/repo/keys";
import {
  ConditionFailedError,
  store,
  type Condition,
  type Item,
  type Key,
  type TransactOp,
  type UpdateSpec,
} from "@/lib/store";

/**
 * Shared table operations every repository module builds on.
 *
 * A thin layer over the storage port in `lib/store/`: repositories address
 * items by Class_Session and sort key, and never learn whether the embedded
 * local store or the optional DynamoDB adapter is behind them.
 *
 * There is no scan helper here. Every read in this product is "some or all of
 * one Class_Session", which is always a key lookup or a single-partition query.
 */

export type { Condition, Item, Key, TransactOp, UpdateSpec };

/** Reads one item by its full primary key. */
export async function getItem<T extends Item>(
  PK: string,
  SK: string,
): Promise<T | null> {
  return ((await (await store()).get({ PK, SK })) as T | null) ?? null;
}

/** The items that exist among `keys`, in one round trip. */
export async function getItems<T extends Item>(keys: readonly Key[]): Promise<T[]> {
  if (keys.length === 0) return [];
  return (await (await store()).batchGet(keys)) as T[];
}

/** Writes one item, overwriting any item with the same key unless `condition` forbids. */
export async function putItem(item: Item, condition?: Condition): Promise<void> {
  await (await store()).put(item, condition);
}

/** Updates one item in place. Throws `ConditionFailedError` when `condition` fails. */
export async function updateItem(
  key: Key,
  update: UpdateSpec,
  condition?: Condition,
): Promise<void> {
  await (await store()).update(key, update, condition);
}

/** Applies every operation or none. Throws `ConditionFailedError` when any condition fails. */
export async function transactWrite(ops: readonly TransactOp[]): Promise<void> {
  await (await store()).transact(ops);
}

/**
 * Every item in one Class_Session partition whose sort key begins with `prefix`,
 * in ascending sort-key order.
 */
export async function queryPrefix<T extends Item>(
  sessionId: string,
  prefix: string,
): Promise<T[]> {
  return (await (await store()).query(sessionPk(sessionId), prefix)) as T[];
}

/** The key of every item in one Class_Session partition. Used to wipe a class. */
export async function partitionKeys(sessionId: string): Promise<Key[]> {
  const items = await (await store()).query(sessionPk(sessionId), "");
  return items.map((item) => ({ PK: String(item.PK), SK: String(item.SK) }));
}

/**
 * How many items in the partition carry the prefix, counted rather than
 * transferred — the per-Difficulty_Level pool checks need the number only.
 */
export async function countPrefix(
  sessionId: string,
  prefix: string,
): Promise<number> {
  return (await store()).count(sessionPk(sessionId), prefix);
}

/** Writes many items. Batched and retried by the DynamoDB adapter. */
export async function putAll(items: readonly Item[]): Promise<void> {
  await (await store()).putAll(items);
}

/** Deletes many items by key. */
export async function deleteAll(keys: readonly Key[]): Promise<void> {
  await (await store()).deleteAll(keys);
}

/** True when a write failed because its condition was not met. */
export function isConditionalCheckFailure(error: unknown): boolean {
  return error instanceof ConditionFailedError;
}
