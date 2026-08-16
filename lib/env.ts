import "server-only";

/**
 * Server-only environment configuration.
 *
 * Every value the application needs from the environment is read and validated
 * here, so a missing variable surfaces as one named error listing exactly what
 * is absent, rather than as an opaque AWS error deep in a request.
 *
 * No variable is prefixed `NEXT_PUBLIC_`: none of these values may reach the
 * browser. Credentials are never read here at all — the AWS SDK resolves them
 * from the standard provider chain (the local AWS profile in development, the
 * hosting role in deployment), so no key material is ever checked in.
 *
 * Validation is memoised on first use rather than executed at module load: a
 * build machine has no AWS configuration, and a build must not require one.
 * The first request that touches AWS pays the check, and it fails loudly.
 */

/** The variables the application requires to serve a request. */
const REQUIRED_VARS = [
  "AWS_REGION",
  "CLASSMIND_TABLE",
  "CLASSMIND_BUCKET",
  "APP_ORIGIN",
] as const;

type RequiredVar = (typeof REQUIRED_VARS)[number];

export type Env = Readonly<Record<RequiredVar, string>>;

/** Thrown when configuration is incomplete. Named so a caller can recognise it. */
export class MissingEnvError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Copy .env.local.example to .env.local and fill them in.",
    );
    this.name = "MissingEnvError";
    this.missing = missing;
  }
}

let cached: Env | undefined;

/** Reads and validates the environment, memoised for the life of the process. */
export function getEnv(): Env {
  if (cached) return cached;

  const missing: string[] = [];
  const resolved = {} as Record<RequiredVar, string>;

  for (const name of REQUIRED_VARS) {
    const value = process.env[name]?.trim();
    if (!value) {
      missing.push(name);
      continue;
    }
    resolved[name] = value;
  }

  if (missing.length > 0) throw new MissingEnvError(missing);

  cached = Object.freeze(resolved);
  return cached;
}

/** Test seam: clears the memoised value so a test can vary the environment. */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * Class_Session id prefix for local development.
 *
 * Local runs share the deployed table and bucket, so a developer's sessions are
 * created with this prefix and the demo Class_Session is never one of them. The
 * seed script writes the demo session without it.
 */
export const DEV_SESSION_PREFIX = "dev-";
