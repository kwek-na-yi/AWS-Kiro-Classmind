import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertUsableAwsCredentials,
  dynamoEndpoint,
  getEnv,
  MissingEnvError,
  resetEnvCache,
} from "@/lib/env";

/**
 * The environment reads behind the optional AWS adapter.
 *
 * Local mode — the default — must need none of them, and a DynamoDB target must
 * fail with a named list of what is missing rather than an opaque SDK error.
 */

const NAMES = [
  "CLASSMIND_TARGET",
  "DYNAMODB_ENDPOINT",
  "AWS_ACCESS_KEY_ID",
  "AWS_REGION",
  "CLASSMIND_TABLE",
  "CLASSMIND_BUCKET",
] as const;

const ORIGINAL = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

beforeEach(() => {
  for (const name of NAMES) delete process.env[name];
  resetEnvCache();
});

afterEach(() => {
  for (const name of NAMES) {
    const value = ORIGINAL[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvCache();
});

describe("required configuration per target", () => {
  it("requires nothing in local mode", () => {
    expect(() => getEnv()).not.toThrow();
  });

  it("names every missing variable on the aws target", () => {
    process.env.CLASSMIND_TARGET = "aws";

    expect(() => getEnv()).toThrow(MissingEnvError);
    try {
      getEnv();
    } catch (error) {
      expect((error as MissingEnvError).missing).toEqual([
        "AWS_REGION",
        "CLASSMIND_TABLE",
        "CLASSMIND_BUCKET",
      ]);
    }
  });

  it("accepts a complete aws configuration", () => {
    process.env.CLASSMIND_TARGET = "aws";
    process.env.AWS_REGION = "us-east-1";
    process.env.CLASSMIND_TABLE = "classmind";
    process.env.CLASSMIND_BUCKET = "classmind-example";

    expect(getEnv().CLASSMIND_BUCKET).toBe("classmind-example");
  });
});

describe("the DynamoDB endpoint", () => {
  it("is used on the dynamodb-local target, defaulting to port 8000", () => {
    process.env.CLASSMIND_TARGET = "dynamodb-local";
    expect(dynamoEndpoint()).toBe("http://localhost:8000");

    process.env.DYNAMODB_ENDPOINT = "http://127.0.0.1:9000";
    expect(dynamoEndpoint()).toBe("http://127.0.0.1:9000");
  });

  it("is ignored on the aws target, whatever the environment says", () => {
    // The leak this guards: .env.aws sets the target, .env.local supplies an
    // endpoint, and without this the run would write to localhost.
    process.env.CLASSMIND_TARGET = "aws";
    process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";

    expect(dynamoEndpoint()).toBeUndefined();
  });

  it("is ignored in local mode, which never talks to DynamoDB", () => {
    process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";
    expect(dynamoEndpoint()).toBeUndefined();
  });
});

describe("guarding AWS credentials", () => {
  it("accepts an absent key, which means the provider chain resolves it", () => {
    expect(() => assertUsableAwsCredentials()).not.toThrow();
  });

  it("accepts a well-formed access key id", () => {
    // AWS's documented example ids — not real credentials.
    for (const keyId of ["AKIAIOSFODNN7EXAMPLE", "ASIAIOSFODNN7EXAMPLE"]) {
      process.env.AWS_ACCESS_KEY_ID = keyId;
      expect(() => assertUsableAwsCredentials()).not.toThrow();
    }
  });

  it("refuses a placeholder, saying what to remove", () => {
    process.env.AWS_ACCESS_KEY_ID = "local";

    expect(() => assertUsableAwsCredentials()).toThrow(/AWS_ACCESS_KEY_ID/);
  });
});
