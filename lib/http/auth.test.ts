import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  hashInstructorToken,
  newInstructorToken,
  newLearnerId,
  requireOwner,
  verifyInstructorToken,
} from "@/lib/http/auth";
import { AppError } from "@/lib/http/errors";

/**
 * The credential primitives, which are pure. `requireLearner` and
 * `requireInstructor` read through the repository and belong to the integration
 * tests in Phase 13.
 */

describe("Learner_Id minting", () => {
  it("is 128 bits of randomness carrying no personal data", () => {
    const id = newLearnerId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newLearnerId()));
    expect(ids.size).toBe(500);
  });
});

describe("Instructor token", () => {
  it("mints a distinct token each time", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => newInstructorToken()));
    expect(tokens.size).toBe(100);
  });

  it("hashes to a fixed-width digest that is not the token", () => {
    const token = newInstructorToken();
    const hash = hashInstructorToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it("hashes deterministically", () => {
    const token = newInstructorToken();
    expect(hashInstructorToken(token)).toBe(hashInstructorToken(token));
  });

  it("accepts the matching token and rejects everything else", () => {
    const token = newInstructorToken();
    const stored = hashInstructorToken(token);

    expect(verifyInstructorToken(token, stored)).toBe(true);
    expect(verifyInstructorToken(newInstructorToken(), stored)).toBe(false);
    expect(verifyInstructorToken("", stored)).toBe(false);
    expect(verifyInstructorToken(`${token}x`, stored)).toBe(false);
  });

  it("rejects a malformed or truncated stored hash rather than throwing", () => {
    const token = newInstructorToken();

    expect(verifyInstructorToken(token, "")).toBe(false);
    expect(verifyInstructorToken(token, "not-hex")).toBe(false);
    expect(verifyInstructorToken(token, hashInstructorToken(token).slice(0, 32))).toBe(
      false,
    );
  });

  it("rejects any token other than the one that produced the hash", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        expect(verifyInstructorToken(b, hashInstructorToken(a))).toBe(false);
      }),
    );
  });
});

describe("requireOwner", () => {
  it("allows the owning Learner", () => {
    expect(() => requireOwner("l_1", "l_1")).not.toThrow();
  });

  it("denies another Learner with NOT_YOUR_REPORT", () => {
    try {
      requireOwner("l_2", "l_1");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("NOT_YOUR_REPORT");
      expect((error as AppError).status).toBe(403);
    }
  });
});
