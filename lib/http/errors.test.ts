import { describe, expect, it } from "vitest";

import {
  AppError,
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
