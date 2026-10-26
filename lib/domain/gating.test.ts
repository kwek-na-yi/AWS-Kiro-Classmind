import { describe, expect, it } from "vitest";

import {
  orderThread,
  recommended,
  statusCounts,
  topRecommendation,
} from "@/lib/domain/gating";
import type { PeerExplanation, ValidationStatus } from "@/lib/types";

function explanation(
  explanationId: string,
  status: ValidationStatus,
  overrides: Partial<PeerExplanation> = {},
): PeerExplanation {
  return {
    explanationId,
    topicId: "t1",
    learnerId: `learner-${explanationId}`,
    displayName: `Name ${explanationId}`,
    text: `Explanation ${explanationId}`,
    status,
    attempts: 1,
    submittedAt: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("recommended", () => {
  it("keeps only validated explanations", () => {
    const all = [
      explanation("a", "Validated"),
      explanation("b", "Pending"),
      explanation("c", "Contradicted"),
      explanation("d", "Unsupported"),
    ];

    expect(recommended(all).map((entry) => entry.explanationId)).toEqual(["a"]);
  });

  it("excludes a pending explanation even when it is the only one", () => {
    expect(recommended([explanation("a", "Pending")])).toEqual([]);
  });

  it("prefers an explanation carrying a source reference", () => {
    const withRef = explanation("a", "Validated", {
      sourceRef: { kind: "page", value: "p. 1" },
    });
    const withoutRef = explanation("b", "Validated", {
      text: "A considerably longer explanation than the other one",
    });

    expect(recommended([withoutRef, withRef])[0].explanationId).toBe("a");
  });

  it("is a total order, so the list never reshuffles", () => {
    const all = [explanation("a", "Validated"), explanation("b", "Validated")];

    expect(recommended(all)).toEqual(recommended([...all].reverse()));
  });

  it("returns an empty list for an empty thread", () => {
    expect(recommended([])).toEqual([]);
  });
});

describe("topRecommendation", () => {
  it("returns null rather than falling back to an unvalidated explanation", () => {
    expect(topRecommendation([explanation("a", "Contradicted")])).toBeNull();
    expect(topRecommendation([explanation("a", "Pending")])).toBeNull();
    expect(topRecommendation([])).toBeNull();
  });

  it("returns the strongest validated explanation", () => {
    const all = [explanation("a", "Unsupported"), explanation("b", "Validated")];

    expect(topRecommendation(all)?.explanationId).toBe("b");
  });
});

describe("orderThread", () => {
  it("puts recommended explanations first, then the rest chronologically", () => {
    const all = [
      explanation("c", "Contradicted", { submittedAt: "2026-01-01T10:00:03.000Z" }),
      explanation("a", "Pending", { submittedAt: "2026-01-01T10:00:01.000Z" }),
      explanation("b", "Validated", { submittedAt: "2026-01-01T10:00:02.000Z" }),
    ];

    expect(orderThread(all).map((entry) => entry.explanationId)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("retains every explanation whatever its status", () => {
    const all = [
      explanation("a", "Validated"),
      explanation("b", "Contradicted"),
      explanation("c", "Unsupported"),
      explanation("d", "Pending"),
    ];

    expect(orderThread(all)).toHaveLength(4);
  });
});

describe("statusCounts", () => {
  it("counts every status, including those with none", () => {
    const all = [
      explanation("a", "Validated"),
      explanation("b", "Validated"),
      explanation("c", "Contradicted"),
    ];

    expect(statusCounts(all)).toEqual({
      Validated: 2,
      Contradicted: 1,
      Unsupported: 0,
      Pending: 0,
    });
  });
});
