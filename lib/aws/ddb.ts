import "server-only";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { deploymentTarget } from "@/lib/target";
import { assertUsableAwsCredentials, dynamoEndpoint, getEnv } from "@/lib/env";

/**
 * The DynamoDB document client.
 *
 * Built once and reused for the life of the process: constructing an SDK client
 * per request would re-resolve credentials and re-open sockets on a path that
 * has a 2-second budget. No handler ever constructs a client itself.
 */

let client: DynamoDBDocumentClient | undefined;

/**
 * DynamoDB Local (the `dynamodb-local` target) authenticates nothing, but the
 * SDK still refuses to sign a request without a credential pair, so that target
 * supplies its own here.
 *
 * Supplying them in code rather than in an env file is the point: a placeholder
 * `AWS_ACCESS_KEY_ID` in an env file is picked up by *every* AWS client in the
 * process, and `next dev` loads `.env.local` even when the run was started for
 * the AWS target — which is exactly how a real run ends up signing real requests
 * with the string "local".
 *
 * This module is only ever loaded by `lib/store/dynamo.ts`, and that module only
 * by a DynamoDB-backed target. The default local mode never reaches it.
 */
const LOCAL_CREDENTIALS = {
  accessKeyId: "local",
  secretAccessKey: "local",
} as const;

export function ddb(): DynamoDBDocumentClient {
  if (client) return client;

  const local = deploymentTarget() === "dynamodb-local";
  if (!local) assertUsableAwsCredentials();

  client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: getEnv().AWS_REGION,
      // Undefined on the AWS target, so the SDK resolves the real endpoint.
      endpoint: dynamoEndpoint(),
      // On the AWS target this is omitted, so the standard provider chain runs.
      ...(local ? { credentials: LOCAL_CREDENTIALS } : {}),
    }),
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
