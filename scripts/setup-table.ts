/**
 * Creates the single DynamoDB table, if it does not already exist.
 *
 * For the optional DynamoDB targets only (`dynamodb-local` or `aws`); local mode
 * refuses, because it has no table. Works against whatever `DYNAMODB_ENDPOINT`
 * and `AWS_REGION` point at, so the
 * same script provisions DynamoDB Local and a real AWS account. Safe to re-run:
 * an existing table is reported and left alone.
 *
 * Usage:  npm run setup:table
 */

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";

import { dynamoEndpoint, getEnv } from "@/lib/env";
import { deploymentTarget } from "@/lib/target";

async function main(): Promise<void> {
  const target = deploymentTarget();

  // Local mode has no table to create. Refusing here matters: without an
  // endpoint the client below would resolve real AWS and whatever credentials
  // happen to be on the machine.
  if (target === "local") {
    throw new Error(
      "CLASSMIND_TARGET is local (the default), which uses the embedded store and needs no table. " +
        "Set CLASSMIND_TARGET=dynamodb-local to provision DynamoDB Local, or use `npm run setup:aws`.",
    );
  }

  const env = getEnv();
  const endpoint = dynamoEndpoint();

  const client = new DynamoDBClient({
    region: env.AWS_REGION,
    endpoint,
    // DynamoDB Local accepts any credentials; real AWS uses the provider chain.
    ...(target === "dynamodb-local"
      ? { credentials: { accessKeyId: "local", secretAccessKey: "local" } }
      : {}),
  });

  console.log(
    `Target: ${endpoint ?? `AWS ${env.AWS_REGION}`} · table ${env.CLASSMIND_TABLE}`,
  );

  try {
    const existing = await client.send(
      new DescribeTableCommand({ TableName: env.CLASSMIND_TABLE }),
    );

    console.log(
      `Table already exists (status ${existing.Table?.TableStatus}). Nothing to do.`,
    );
    return;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
  }

  // Partition key PK, sort key SK, on-demand billing, no secondary index —
  // every access pattern in this product is a key lookup or a single-partition
  // query, so nothing more is needed.
  await client.send(
    new CreateTableCommand({
      TableName: env.CLASSMIND_TABLE,
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );

  console.log(`Created table ${env.CLASSMIND_TABLE}.`);

  // Creation is asynchronous on real AWS; wait until it can accept writes so a
  // seed run immediately afterwards does not fail.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const described = await client.send(
      new DescribeTableCommand({ TableName: env.CLASSMIND_TABLE }),
    );

    if (described.Table?.TableStatus === "ACTIVE") {
      console.log("Table is active and ready for seeding.");
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.warn("Table did not become active within 30 seconds — check the console.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
