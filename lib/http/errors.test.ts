import { describe, expect, it } from "vitest";

import {
  AppError,
  asAwsError,
  ERROR_STATUS,
  errorEnvelope,
  errorResponse,
  internalEnvelope,
  isAppError,
  type ErrorCode,
} from "@/lib/http/errors";

describe("the error code table", () => {
  it("declares every code from the design with its status", () => {
    expect(ERROR_STATUS).toEqual({
      SESSION_NOT_FOUND: 404,
      INVALID_DISPLAY_NAME: 400,
      UNSUPPORTED_EXTENSION: 400,
      MATERIAL_TOO_LARGE: 400,
      NO_READABLE_TEXT: 422,
      PROFILE_REQUIRED: 400,
      INVALID_PROFILE: 400,
      POOL_UNAVAILABLE: 409,
      EXPLANATION_LENGTH: 400,
      NOT_YOUR_REPORT: 403,
      LEARNER_NOT_IN_SESSION: 403,
      INSTRUCTOR_TOKEN_REQUIRED: 403,
      QUIZ_CLOSED: 409,
      ANSWER_CONFLICT: 409,
      MATERIAL_REQUIRED: 409,
      DEMO_READ_ONLY: 403,
      RATE_LIMITED: 429,
      AWS_UNAVAILABLE: 503,
      INTERNAL: 500,
    });
  });

  it("gives every code a status in a valid range", () => {
    for (const status of Object.values(ERROR_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });
});

describe("the error envelope", () => {
  it("has one shape for every failure", () => {
    expect(errorEnvelope("POOL_UNAVAILABLE", "No quiz yet.")).toEqual({
      error: { code: "POOL_UNAVAILABLE", message: "No quiz yet." },
    });
  });

  it("carries the offending field when the failure names one", () => {
    expect(errorEnvelope("INVALID_PROFILE", "Bad value.", "explanationStyle")).toEqual({
      error: {
        code: "INVALID_PROFILE",
        message: "Bad value.",
        field: "explanationStyle",
      },
    });
  });

  it("omits the field key entirely when there is none", () => {
    const envelope = errorEnvelope("SESSION_NOT_FOUND", "Unrecognised code.");
    expect("field" in envelope.error).toBe(false);
  });
});

describe("AppError", () => {
  it("resolves its status from the table", () => {
    const codes = Object.keys(ERROR_STATUS) as ErrorCode[];

    for (const code of codes) {
      const error = new AppError(code, "message");
      expect(error.status).toBe(ERROR_STATUS[code]);
      expect(isAppError(error)).toBe(true);
    }
  });

  it("is distinguishable from an ordinary error", () => {
    expect(isAppError(new Error("boom"))).toBe(false);
    expect(isAppError("boom")).toBe(false);
  });

  it("serialises to the envelope with its status", async () => {
    const response = errorResponse(
      new AppError("MATERIAL_TOO_LARGE", "Limit is 20 MB.", "bytes"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MATERIAL_TOO_LARGE",
        message: "Limit is 20 MB.",
        field: "bytes",
      },
    });
  });
});

describe("the internal envelope", () => {
  it("carries the request id and no internals", () => {
    const envelope = internalEnvelope("req-123");

    expect(envelope.error.code).toBe("INTERNAL");
    expect(envelope.error.message).toContain("req-123");
    expect(envelope.error).not.toHaveProperty("stack");
    expect(envelope.error).not.toHaveProperty("field");
  });
});

describe("recognising an AWS failure", () => {
  /** The SDK reports its failures by `name`, not by class. */
  function awsFailure(name: string): Error {
    const error = new Error("the SDK said so");
    error.name = name;
    return error;
  }

  it("names an unusable credential as a service failure the caller can act on", () => {
    for (const name of [
      "UnrecognizedClientException",
      "ExpiredToken",
      "ExpiredTokenException",
      "InvalidClientTokenId",
      "AccessDeniedException",
    ]) {
      const mapped = asAwsError(awsFailure(name));

      expect(mapped?.code).toBe("AWS_UNAVAILABLE");
      expect(mapped?.status).toBe(503);
      expect(mapped?.message).toMatch(/credential/i);
    }
  });

  it("names a missing table or bucket as setup that has not been run", () => {
    expect(asAwsError(awsFailure("ResourceNotFoundException"))?.message).toMatch(
      /DynamoDB table/,
    );
    expect(asAwsError(awsFailure("NoSuchBucket"))?.message).toMatch(/S3 bucket/);
  });

  it("leaves anything else to the internal path", () => {
    expect(asAwsError(awsFailure("ValidationException"))).toBeNull();
    expect(asAwsError(new Error("boom"))).toBeNull();
    expect(asAwsError("boom")).toBeNull();
    expect(asAwsError(null)).toBeNull();
  });
});
