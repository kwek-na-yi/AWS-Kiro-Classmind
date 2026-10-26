import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deploymentTarget,
  describeTarget,
  hasObjectStorage,
  isLocalTarget,
  localDataRoot,
  usesDynamo,
} from "@/lib/target";

/**
 * The environment switch. These tests set and clear the variables that decide
 * it, restoring whatever the process started with.
 */

const ORIGINAL = {
  target: process.env.CLASSMIND_TARGET,
  dataDir: process.env.CLASSMIND_DATA_DIR,
};

function setTarget(value?: string): void {
  if (value === undefined) delete process.env.CLASSMIND_TARGET;
  else process.env.CLASSMIND_TARGET = value;
}

beforeEach(() => {
  setTarget(undefined);
  delete process.env.CLASSMIND_DATA_DIR;
});

afterEach(() => {
  setTarget(ORIGINAL.target);
  if (ORIGINAL.dataDir === undefined) delete process.env.CLASSMIND_DATA_DIR;
  else process.env.CLASSMIND_DATA_DIR = ORIGINAL.dataDir;
});

describe("resolving the target", () => {
  it("defaults to local when nothing is configured", () => {
    // The whole point: a fresh clone runs with no environment at all.
    expect(deploymentTarget()).toBe("local");
    expect(isLocalTarget()).toBe(true);
    expect(usesDynamo()).toBe(false);
    expect(hasObjectStorage()).toBe(false);
  });

  it("treats an empty value as unset", () => {
    setTarget("   ");
    expect(deploymentTarget()).toBe("local");
  });

  it("honours each explicit setting, case-insensitively", () => {
    setTarget("AWS");
    expect(deploymentTarget()).toBe("aws");

    setTarget("dynamodb-local");
    expect(deploymentTarget()).toBe("dynamodb-local");

    setTarget("local");
    expect(deploymentTarget()).toBe("local");
  });

  it("rejects an unrecognised value instead of guessing", () => {
    setTarget("dynamo");
    expect(() => deploymentTarget()).toThrow(/not recognised/);
  });

  it("ignores DYNAMODB_ENDPOINT when choosing the target", () => {
    // A leftover endpoint from the old DynamoDB Local setup must not pull a
    // run off the embedded store.
    process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";
    try {
      expect(deploymentTarget()).toBe("local");
    } finally {
      delete process.env.DYNAMODB_ENDPOINT;
    }
  });
});

describe("capabilities per target", () => {
  it("uses DynamoDB but not S3 on dynamodb-local", () => {
    setTarget("dynamodb-local");
    expect(usesDynamo()).toBe(true);
    expect(hasObjectStorage()).toBe(false);
  });

  it("uses DynamoDB and S3 on aws", () => {
    setTarget("aws");
    expect(usesDynamo()).toBe(true);
    expect(hasObjectStorage()).toBe(true);
  });
});

describe("the local data root", () => {
  it("defaults to .classmind in the project", () => {
    expect(localDataRoot()).toBe(path.join(process.cwd(), ".classmind"));
  });

  it("follows CLASSMIND_DATA_DIR", () => {
    process.env.CLASSMIND_DATA_DIR = "some/other/place";
    expect(localDataRoot()).toBe(path.resolve("some/other/place"));
  });
});

describe("describing the target", () => {
  it("says local mode needs no AWS", () => {
    expect(describeTarget()).toMatch(/no AWS/);
  });

  it("names the region on aws", () => {
    setTarget("aws");
    expect(describeTarget()).toMatch(/^aws/);
  });
});
