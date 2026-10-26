import "server-only";

import { buildCondition, buildUpdate } from "@/lib/store/expressions";
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
 * The optional DynamoDB adapter.
 *
 * Used only when `CLASSMIND_TARGET` is `aws` or `dynamodb-local`. The AWS SDK is
 * imported lazily, inside the first call, so the default local mode never loads
 * it, never constructs a client and never resolves credentials.
 */

/** DynamoDB's hard limit on a `BatchWriteItem` request. */
const BATCH_LIMIT = 25;
/** DynamoDB's hard limit on a `BatchGetItem` request. */
const BATCH_GET_LIMIT = 100;
/** Attempts to re-send unprocessed items before giving up. */
const UNPROCESSED_RETRIES = 3;

type Sdk = typeof import("@aws-sdk/lib-dynamodb");

async function sdk(): Promise<{ lib: Sdk; client: import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient; table: string }> {
  const [lib, aws] = await Promise.all([
    import("@aws-sdk/lib-dynamodb"),
    import("@/lib/aws/ddb"),
  ]);
  return { lib, client: aws.ddb(), table: aws.tableName() };
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Maps DynamoDB's two condition-failure shapes onto the port's one error. */
function translate(error: unknown): unknown {
  if (!(error instanceof Error)) return error;

  if (error.name === "ConditionalCheckFailedException") {
    return new ConditionFailedError(error.message, { cause: error });
  }

  if (error.name === "TransactionCanceledException") {
    // Only a cancellation caused by a failed condition is the caller's
    // "already done" signal. Throttling or a conflict is a genuine fault.
    const reasons = (error as { CancellationReasons?: { Code?: string }[] })
      .CancellationReasons;
    if (reasons?.some((reason) => reason.Code === "ConditionalCheckFailed")) {
      return new ConditionFailedError(error.message, { cause: error });
    }
  }

  return error;
}

async function writeBatches(
  requests: Record<string, unknown>[],
  label: string,
): Promise<void> {
  const { lib, client, table } = await sdk();

  for (const batch of chunk(requests, BATCH_LIMIT)) {
    let pending = batch;

    for (let attempt = 0; ; attempt += 1) {
      const result = await client.send(
        new lib.BatchWriteCommand({ RequestItems: { [table]: pending } }),
      );

      const unprocessed = (result.UnprocessedItems?.[table] ?? []) as Record<string, unknown>[];
      if (unprocessed.length === 0) break;

      if (attempt >= UNPROCESSED_RETRIES) {
        throw new Error(
          `BatchWriteItem left ${unprocessed.length} ${label}(s) unprocessed after ${UNPROCESSED_RETRIES} retries`,
        );
      }

      pending = unprocessed;
      await pause(100 * 2 ** attempt);
    }
  }
}

export class DynamoStore implements Store {
  async get(key: Key): Promise<Item | null> {
    const { lib, client, table } = await sdk();
    const result = await client.send(new lib.GetCommand({ TableName: table, Key: key }));
    return (result.Item as Item | undefined) ?? null;
  }

  async batchGet(keys: readonly Key[]): Promise<Item[]> {
    if (keys.length === 0) return [];
    const { lib, client, table } = await sdk();
    const items: Item[] = [];

    for (const batch of chunk(keys, BATCH_GET_LIMIT)) {
      let pending: Key[] = batch;

      for (let attempt = 0; pending.length > 0; attempt += 1) {
        const result = await client.send(
          new lib.BatchGetCommand({ RequestItems: { [table]: { Keys: pending } } }),
        );
        items.push(...((result.Responses?.[table] ?? []) as Item[]));

        pending = (result.UnprocessedKeys?.[table]?.Keys ?? []) as Key[];
        if (pending.length > 0) {
          if (attempt >= UNPROCESSED_RETRIES) {
            throw new Error(`BatchGetItem left ${pending.length} key(s) unprocessed`);
          }
          await pause(100 * 2 ** attempt);
        }
      }
    }

    return items;
  }

  async put(item: Item, condition?: Condition): Promise<void> {
    const { lib, client, table } = await sdk();
    try {
      await client.send(
        new lib.PutCommand({ TableName: table, Item: item, ...buildCondition(condition) }),
      );
    } catch (error) {
      throw translate(error);
    }
  }

  async update(key: Key, update: UpdateSpec, condition?: Condition): Promise<void> {
    const { lib, client, table } = await sdk();
    try {
      await client.send(
        new lib.UpdateCommand({ TableName: table, Key: key, ...buildUpdate(update, condition) }),
      );
    } catch (error) {
      throw translate(error);
    }
  }

  async query(pk: string, prefix: string): Promise<Item[]> {
    return this.paginate(pk, prefix, false).then((result) => result.items);
  }

  async count(pk: string, prefix: string): Promise<number> {
    return this.paginate(pk, prefix, true).then((result) => result.count);
  }

  /**
   * One partition, following pagination to completion. An empty prefix uses a
   * bare `PK = :pk` condition, because DynamoDB rejects `begins_with` with an
   * empty operand.
   */
  private async paginate(
    pk: string,
    prefix: string,
    countOnly: boolean,
  ): Promise<{ items: Item[]; count: number }> {
    const { lib, client, table } = await sdk();
    const items: Item[] = [];
    let count = 0;
    let startKey: Record<string, unknown> | undefined;

    do {
      const result = await client.send(
        new lib.QueryCommand({
          TableName: table,
          KeyConditionExpression: prefix
            ? "PK = :pk AND begins_with(SK, :sk)"
            : "PK = :pk",
          ExpressionAttributeValues: prefix ? { ":pk": pk, ":sk": prefix } : { ":pk": pk },
          ...(countOnly ? { Select: "COUNT" as const } : {}),
          ExclusiveStartKey: startKey,
        }),
      );

      if (result.Items) items.push(...(result.Items as Item[]));
      count += result.Count ?? 0;
      startKey = result.LastEvaluatedKey;
    } while (startKey);

    return { items, count };
  }

  async putAll(items: readonly Item[]): Promise<void> {
    if (items.length === 0) return;
    await writeBatches(
      items.map((Item) => ({ PutRequest: { Item } })),
      "item",
    );
  }

  async deleteAll(keys: readonly Key[]): Promise<void> {
    if (keys.length === 0) return;
    await writeBatches(
      keys.map((Key) => ({ DeleteRequest: { Key: { PK: Key.PK, SK: Key.SK } } })),
      "delete",
    );
  }

  async transact(ops: readonly TransactOp[]): Promise<void> {
    const { lib, client, table } = await sdk();

    const TransactItems = ops.map((op) =>
      op.kind === "put"
        ? { Put: { TableName: table, Item: op.item, ...buildCondition(op.condition) } }
        : {
            Update: {
              TableName: table,
              Key: op.key,
              ...buildUpdate(op.update, op.condition),
            },
          },
    );

    try {
      await client.send(new lib.TransactWriteCommand({ TransactItems }));
    } catch (error) {
      throw translate(error);
    }
  }
}
