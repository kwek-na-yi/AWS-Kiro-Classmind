import "server-only";

import { deploymentTarget } from "@/lib/target";

/**
 * Server-only environment configuration for the optional AWS adapter.
 *
 * The default local mode reads none of this: a fresh clone needs no
 * environment variables at all. These values are only read, and only
 * validated, when `CLASSMIND_TARGET` selects a DynamoDB-backed target — so a
 * missing variable surfaces as one named error listing exactly what is absent
 * rather than as an opaque AWS error deep in a request.
 *
 * No variable is prefixed `NEXT_PUBLIC_`: none of these values may reach the
 * browser. Credentials are never read here — the AWS SDK resolves them from the
 * standard provider chain — so no key material is ever checked in.
 *
 * Validation is memoised on first use rather than executed at module load, so
 * a build never requires any of it.
 */

/** The variables a target needs before its first request. */
const REQUIRED_BY_TARGET = {
  local: [],
  // Reads DATABASE_URL itself (lib/store/pg.ts); needs nothing from AWS.
  postgres: [],
  "dynamodb-local": ["CLASSMIND_TABLE"],
  aws: ["AWS_REGION", "CLASSMIND_TABLE", "CLASSMIND_BUCKET"],
} as const;

export interface Env {
  readonly AWS_REGION: string;
  readonly CLASSMIND_TABLE: string;
  readonly CLASSMIND_BUCKET: string;
}

/** Defaults for the variables a target does not require. */
const DEFAULTS: Env = {
  AWS_REGION: "us-east-1",
  CLASSMIND_TABLE: "classmind",
  CLASSMIND_BUCKET: "",
};

/** The DynamoDB Local endpoint, used only by the `dynamodb-local` target. */
export function dynamoEndpoint(): string | undefined {
  if (deploymentTarget() !== "dynamodb-local") return undefined;
  return process.env.DYNAMODB_ENDPOINT?.trim() || "http://localhost:8000";
}

/**
 * The shape of a real AWS access key id: uppercase alphanumerics, at least 16
 * of them. `AKIA…` for a long-lived key, `ASIA…` for a session credential.
 */
const ACCESS_KEY_ID_PATTERN = /^[A-Z0-9]{16,128}$/;

/**
 * Refuses to run against AWS with placeholder credentials in the environment.
 *
 * `next dev` loads `.env.local` on every run, and the SDK's environment
 * provider outranks `~/.aws/credentials` — so a placeholder such as
 * `AWS_ACCESS_KEY_ID=local` left in an env file silently becomes the
 * credential every real request is signed with. This makes that fail with the
 * sentence that fixes it, rather than as an opaque 500 per request.
 */
export function assertUsableAwsCredentials(): void {
  const keyId = process.env.AWS_ACCESS_KEY_ID?.trim();

  // Absent is fine and common: the SDK then reads ~/.aws/credentials or the
  // hosting role, which is the documented way to run against AWS.
  if (!keyId) return;

  if (!ACCESS_KEY_ID_PATTERN.test(keyId)) {
    throw new Error(
      "AWS_ACCESS_KEY_ID is set to a placeholder rather than a real access key id, " +
        "so every AWS request would be rejected. Remove the AWS_ACCESS_KEY_ID, " +
        "AWS_SECRET_ACCESS_KEY and AWS_SESSION_TOKEN lines from your env file.",
    );
  }
}

/** Thrown when configuration is incomplete. Named so a caller can recognise it. */
export class MissingEnvError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `Missing required environment variable(s) for CLASSMIND_TARGET=${deploymentTarget()}: ` +
        `${missing.join(", ")}. See docs/configuration.md — or unset CLASSMIND_TARGET to run locally.`,
    );
    this.name = "MissingEnvError";
    this.missing = missing;
  }
}

let cached: Env | undefined;

/** Reads and validates the environment for the current target, memoised. */
export function getEnv(): Env {
  if (cached) return cached;

  const required: readonly string[] = REQUIRED_BY_TARGET[deploymentTarget()];
  const missing: string[] = [];
  const resolved: Record<string, string> = { ...DEFAULTS };

  for (const name of Object.keys(DEFAULTS)) {
    const value = process.env[name]?.trim();
    if (value) resolved[name] = value;
    else if (required.includes(name)) missing.push(name);
  }

  if (missing.length > 0) throw new MissingEnvError(missing);

  cached = Object.freeze(resolved as unknown as Env);
  return cached;
}

/** Test seam: clears the memoised value so a test can vary the environment. */
export function resetEnvCache(): void {
  cached = undefined;
}
