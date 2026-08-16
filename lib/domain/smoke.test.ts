import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  EXPLANATION_STYLES,
  UNDERSTANDING_LEVELS,
  VALIDATION_STATUSES,
} from "@/lib/types";

/**
 * Harness smoke test (task 1.3). It proves three things the property tests in
 * Phases 6–10 depend on: Vitest runs and exits, fast-check is importable from a
 * test under `lib/domain/`, and the `@/*` alias resolves in a test file.
 */
describe("test harness", () => {
  it("runs a trivial assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("resolves the @/* alias to the shared domain types", () => {
    expect(UNDERSTANDING_LEVELS).toHaveLength(3);
    expect(EXPLANATION_STYLES).toHaveLength(5);
    expect(VALIDATION_STATUSES).toHaveLength(4);
  });

  it("runs a fast-check property", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
    );
  });
});
