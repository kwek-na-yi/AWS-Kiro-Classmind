/**
 * Provisions the real AWS resources ClassMind needs.
 *
 * Creates the DynamoDB table and the S3 bucket, then applies the security
 * posture the design calls for: public access blocked, default encryption on,
 * and a policy refusing plaintext requests.
 *
 * Safe to re-run. Anything that already exists is reported and left alone, so
 * this can be used to check an environment as well as to build one.
 *
 * Usage:  npm run setup:aws
 *
 * Requires AWS credentials on the standard provider chain and
 * `CLASSMIND_TARGET=aws`. The account id is never written down — the bucket
 * name comes from the environment.
 */

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  type BucketLocationConstraint,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketPolicyCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { deploymentTarget, describeTarget } from "@/lib/target";
import { getEnv } from "@/lib/env";

/** Objects under `sessions/` expire after this many days. */
const LIFECYCLE_DAYS = 30;

async function setupTable(region: string, tableName: string): Promise<void> {
  const client = new DynamoDBClient({ region });

  try {
    const existing = await client.send(
      new DescribeTableCommand({ TableName: tableName }),
    );

    console.log(
      `  table ${tableName}: already exists (${existing.Table?.TableStatus})`,
    );
    return;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
  }

  // Partition key PK, sort key SK, on-demand billing, no secondary index —
  // every access pattern is a key lookup or a single-partition query.
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
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

  console.log(`  table ${tableName}: created`);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const described = await client.send(
      new DescribeTableCommand({ TableName: tableName }),
    );

    if (described.Table?.TableStatus === "ACTIVE") {
      console.log(`  table ${tableName}: active`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.warn(`  table ${tableName}: still not active after 60s`);
}

async function setupBucket(region: string, bucket: string): Promise<void> {
  const client = new S3Client({ region });

  let exists = false;

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    exists = true;
    console.log(`  bucket ${bucket}: already exists`);
  } catch {
    // A missing bucket and a bucket owned by someone else both land here; the
    // create below distinguishes them with a clearer error.
  }

  if (!exists) {
    await client.send(
      new CreateBucketCommand({
        Bucket: bucket,
        // us-east-1 rejects an explicit location constraint; every other
        // region requires one.
        ...(region === "us-east-1"
          ? {}
          : {
              CreateBucketConfiguration: {
                LocationConstraint: region as BucketLocationConstraint,
              },
            }),
      }),
    );

    console.log(`  bucket ${bucket}: created`);
  }

  // No object in this bucket is ever public: lecture material belongs to one
  // class and is read server-side only.
  await client.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    }),
  );
  console.log("  bucket: public access blocked");

  await client.send(
    new PutBucketEncryptionCommand({
      Bucket: bucket,
      ServerSideEncryptionConfiguration: {
        Rules: [
          { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
    }),
  );
  console.log("  bucket: SSE-S3 default encryption on");

  // Objects are hackathon artefacts; they should not accrue cost afterwards.
  try {
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: "expire-session-material",
              Status: "Enabled",
              Filter: { Prefix: "sessions/" },
              Expiration: { Days: LIFECYCLE_DAYS },
            },
          ],
        },
      }),
    );
    console.log(`  bucket: objects under sessions/ expire after ${LIFECYCLE_DAYS} days`);
  } catch (error) {
    console.warn(
      `  bucket: lifecycle rule not applied (${error instanceof Error ? error.name : "unknown"})`,
    );
  }

  // Refuse anything not over TLS.
  try {
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "DenyInsecureTransport",
              Effect: "Deny",
              Principal: "*",
              Action: "s3:*",
              Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
              Condition: { Bool: { "aws:SecureTransport": "false" } },
            },
          ],
        }),
      }),
    );
    console.log("  bucket: non-TLS requests denied");
  } catch (error) {
    // AWS Academy restricts several bucket-policy actions. The bucket is still
    // usable without this statement, so it is reported rather than fatal.
    console.warn(
      `  bucket: TLS-only policy not applied (${error instanceof Error ? error.name : "unknown"}) — ` +
        "this is expected under AWS Academy's restricted role",
    );
  }
}

async function main(): Promise<void> {
  const target = deploymentTarget();

  if (target !== "aws") {
    throw new Error(
      `This script provisions real AWS resources but CLASSMIND_TARGET is "${target}". ` +
        "Set CLASSMIND_TARGET=aws before running it (see docs/configuration.md).",
    );
  }

  const env = getEnv();

  console.log(`Target: ${describeTarget()}`);
  console.log(`Region: ${env.AWS_REGION}\n`);

  console.log("DynamoDB");
  await setupTable(env.AWS_REGION, env.CLASSMIND_TABLE);

  console.log("\nS3");
  await setupBucket(env.AWS_REGION, env.CLASSMIND_BUCKET);

  console.log("\nReady. Run `npm run seed:aws` to populate the demo class.");
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
