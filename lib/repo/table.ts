import "server-only";

import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import { ddb, tableName } from "@/lib/aws/ddb";
import { sessionPk } from "@/lib/repo/keys";

/**
 * Shared table operations every repository module builds on.
 *
 * Not one of the entity repositories: this is the thin layer that holds the
 * mechanics they would otherwise each repeat — single-partition prefix queries
 * with pagination, and `BatchWriteItem` chunking with unprocessed-item retry.
 *
 * There is no scan helper here, and no repository imports `ScanCommand`. Every
 * read in this product is "some or all of one Class_Session", which is always a
 * key lookup or a single-partition query.
 */

/** DynamoDB's hard limit on a `BatchWriteItem` request. */
const BATCH_LIMIT = 25;
/** Attempts to re-send unprocessed items before giving up. */
const UNPROCESSED_RETRIES = 3;

export type Item = Record<string, unknown>;

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads one item by its full primary key. */
export async function getItem<T extends Item>(
  PK: string,
  SK: string,
): Promise<T | null> {
  const result = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { PK, SK } }),
  );
  return (result.Item as T | undefined) ?? null;
}

/** Writes one item, overwriting any item with the same key. */
export async function putItem(item: Item): Promise<void> {
  await ddb().send(new PutCommand({ TableName: tableName(), Item: item }));
}

/**
 * Every item in one Class_Session partition whose sort key begins with `prefix`,
 * following pagination to completion.
 */
export async function queryPrefix<T extends Item>(
  sessionId: string,
  prefix: string,
): Promise<T[]> {
  const items: T[] = [];
  let startKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb().send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": sessionPk(sessionId), ":sk": prefix },
        ExclusiveStartKey: startKey,
      }),
    );

    if (result.Items) items.push(...(result.Items as T[]));
    startKey = result.LastEvaluatedKey;
  } while (startKey);

  return items;
}

/**
 * How many items in the partition carry the prefix, counted by DynamoDB rather
 * than transferred — the per-Difficulty_Level pool checks need the number only.
 */
export async function countPrefix(
  sessionId: string,
  prefix: string,
): Promise<number> {
  let count = 0;
  let startKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb().send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": sessionPk(sessionId), ":sk": prefix },
        Select: "COUNT",
        ExclusiveStartKey: startKey,
      }),
    );

    count += result.Count ?? 0;
    startKey = result.LastEvaluatedKey;
  } while (startKey);

  return count;
}

/**
 * Writes many items in `BatchWriteItem` chunks of 25.
 *
 * DynamoDB may accept a batch while declining individual items under
 * throttling, so unprocessed items are re-sent with a short backoff rather than
 * being silently dropped — a half-written Topic set would corrupt every
 * downstream view.
 */
export async function putAll(items: readonly Item[]): Promise<void> {
  for (const batch of chunk(items, BATCH_LIMIT)) {
    let requests = batch.map((Item) => ({ PutRequest: { Item } }));

    for (let attempt = 0; ; attempt += 1) {
      const result = await ddb().send(
        new BatchWriteCommand({ RequestItems: { [tableName()]: requests } }),
      );

      const unprocessed = result.UnprocessedItems?.[tableName()] ?? [];
      if (unprocessed.length === 0) break;

      if (attempt >= UNPROCESSED_RETRIES) {
        throw new Error(
          `BatchWriteItem left ${unprocessed.length} item(s) unprocessed after ${UNPROCESSED_RETRIES} retries`,
        );
      }

      requests = unprocessed as typeof requests;
      await pause(100 * 2 ** attempt);
    }
  }
}

/** Deletes many items by key, chunked and retried exactly as `putAll`. */
export async function deleteAll(
  keys: readonly { PK: string; SK: string }[],
): Promise<void> {
  for (const batch of chunk(keys, BATCH_LIMIT)) {
    let requests = batch.map((Key) => ({ DeleteRequest: { Key } }));

    for (let attempt = 0; ; attempt += 1) {
      const result = await ddb().send(
        new BatchWriteCommand({ RequestItems: { [tableName()]: requests } }),
      );

      const unprocessed = result.UnprocessedItems?.[tableName()] ?? [];
      if (unprocessed.length === 0) break;

      if (attempt >= UNPROCESSED_RETRIES) {
        throw new Error(
          `BatchWriteItem left ${unprocessed.length} delete(s) unprocessed after ${UNPROCESSED_RETRIES} retries`,
        );
      }

      requests = unprocessed as typeof requests;
      await pause(100 * 2 ** attempt);
    }
  }
}

/** True when a write failed because its condition expression was not met. */
export function isConditionalCheckFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ConditionalCheckFailedException" ||
      error.name === "TransactionCanceledException")
  );
}
