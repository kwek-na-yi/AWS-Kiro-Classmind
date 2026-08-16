import "server-only";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { getEnv } from "@/lib/env";

/**
 * The DynamoDB document client.
 *
 * Built once and reused for the life of the process: constructing an SDK client
 * per request would re-resolve credentials and re-open sockets on a path that
 * has a 2-second budget. No handler ever constructs a client itself.
 */

let client: DynamoDBDocumentClient | undefined;

export function ddb(): DynamoDBDocumentClient {
  if (client) return client;

  client = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: getEnv().AWS_REGION }),
    {
      marshallOptions: {
        // An absent optional field is simply not written, rather than failing
        // the request — repositories can pass sparse objects freely.
        removeUndefinedValues: true,
        // Empty strings are legal DynamoDB values and are meaningful here
        // (an empty reason, an empty stage), so they are not converted to null.
        convertEmptyValues: false,
      },
      unmarshallOptions: {
        // Numbers come back as JS numbers; every number in this data model is
        // a small integer or a percentage, far inside the safe range.
        wrapNumbers: false,
      },
    },
  );

  return client;
}

/** The single table every item lives in. */
export function tableName(): string {
  return getEnv().CLASSMIND_TABLE;
}

/** Test seam: drops the memoised client. */
export function resetDdbClient(): void {
  client = undefined;
}
