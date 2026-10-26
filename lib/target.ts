import "server-only";

import path from "node:path";

/**
 * Which infrastructure the application is talking to.
 *
 * There is exactly one switch, resolved here. Repositories, services and route
 * handlers never ask where they are running — they call the same storage
 * primitives either way, and only the backend behind them differs.
 *
 * `local`           — the default. An embedded JSON store on disk and lecture
 *                     files on disk. No AWS SDK client is ever constructed, no
 *                     credentials are read and nothing leaves the machine.
 * `dynamodb-local`  — the DynamoDB adapter pointed at DynamoDB Local (Docker).
 *                     Exists so the optional AWS adapter can be exercised
 *                     without an AWS account. Files stay on disk.
 * `postgres`        — PostgreSQL (e.g. Neon) for data *and* uploaded lecture
 *                     files, via DATABASE_URL. The hosted-demo target: a
 *                     serverless platform has no durable local disk.
 * `aws`             — real DynamoDB and S3, credentials from the standard
 *                     provider chain. Optional; nothing in the default setup
 *                     needs it.
 */

export type DeploymentTarget = "local" | "dynamodb-local" | "postgres" | "aws";

const TARGETS: readonly DeploymentTarget[] = ["local", "dynamodb-local", "postgres", "aws"];

/**
 * Resolves the target.
 *
 * Unset means `local`, so a fresh clone runs with no configuration at all. An
 * unrecognised value is an error rather than a silent fallback: a typo in a
 * deployment should fail loudly, not quietly write to a file on the server.
 */
export function deploymentTarget(): DeploymentTarget {
  const declared = process.env.CLASSMIND_TARGET?.trim().toLowerCase();

  if (!declared) return "local";

  if ((TARGETS as readonly string[]).includes(declared)) {
    return declared as DeploymentTarget;
  }

  throw new Error(
    `CLASSMIND_TARGET="${process.env.CLASSMIND_TARGET}" is not recognised. ` +
      `Use one of: ${TARGETS.join(", ")} — or leave it unset for local mode.`,
  );
}

/** True for the default embedded store. */
export function isLocalTarget(): boolean {
  return deploymentTarget() === "local";
}

/** True when persistence goes through the DynamoDB adapter. */
export function usesDynamo(): boolean {
  const target = deploymentTarget();
  return target === "dynamodb-local" || target === "aws";
}

/** True when data and lecture files live in PostgreSQL. */
export function usesPostgres(): boolean {
  return deploymentTarget() === "postgres";
}

/**
 * Whether this process runs on a serverless host (Vercel sets `VERCEL`).
 *
 * The local store writes a file next to the code. On a serverless host that
 * file is not durable and is not shared between instances, so local mode there
 * would *look* like it works while losing data between requests — it is refused
 * instead of silently degrading.
 */
export function onServerlessHost(): boolean {
  return Boolean(process.env.VERCEL);
}

/**
 * Whether S3 is usable.
 *
 * Object storage only exists on the AWS target. Every other target keeps
 * lecture bytes on disk, so callers that would otherwise store or fetch an
 * object check this first rather than failing against an endpoint that is not
 * there.
 */
export function hasObjectStorage(): boolean {
  return deploymentTarget() === "aws";
}

/**
 * The directory holding everything local mode writes: the embedded store and
 * uploaded lecture files. Git-ignored. Read on each call so a test can point it
 * at a temporary directory.
 */
export function localDataRoot(): string {
  const configured = process.env.CLASSMIND_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), ".classmind");
}

/** A one-line description for logs and scripts. */
export function describeTarget(): string {
  switch (deploymentTarget()) {
    case "local":
      return `local (embedded store under ${localDataRoot()}, no AWS)`;
    case "postgres":
      return "postgres (DATABASE_URL; data and uploaded files in PostgreSQL)";
    case "dynamodb-local":
      return `dynamodb-local (DynamoDB Local at ${process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000"}, files on disk)`;
    case "aws":
      return `aws (region ${process.env.AWS_REGION ?? "unset"})`;
  }
}
