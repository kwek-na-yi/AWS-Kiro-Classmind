import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { percentage, roundHalfUp } from "@/lib/domain/round";

describe("roundHalfUp", () => {
  it("rounds a tie upwards", () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(59.5)).toBe(60);
  });

  it("rounds to the nearer integer otherwise", () => {
    expect(roundHalfUp(0.49)).toBe(0);
    expect(roundHalfUp(0.51)).toBe(1);
    expect(roundHalfUp(99.4)).toBe(99);
  });

  it("leaves an integer untouched", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (value) => {
        expect(roundHalfUp(value)).toBe(value);
      }),
    );
  });

  it("rejects a non-finite value rather than producing NaN", () => {
    expect(() => roundHalfUp(Number.NaN)).toThrow(/finite/);
    expect(() => roundHalfUp(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});

describe("percentage", () => {
  it("computes the documented boundary cases", () => {
    expect(percentage(0, 6)).toBe(0);
    expect(percentage(6, 6)).toBe(100);
    expect(percentage(1, 2)).toBe(50);
    expect(percentage(1, 3)).toBe(33);
    expect(percentage(2, 3)).toBe(67);
    expect(percentage(3, 5)).toBe(60);
  });

  it("rounds a half up rather than to even", () => {
    // 1/8 is 12.5 and 3/8 is 37.5 — both exact ties.
    expect(percentage(1, 8)).toBe(13);
    expect(percentage(3, 8)).toBe(38);
  });

  it("always lands within 0 to 100", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        (total, raw) => {
          const part = raw % (total + 1);
          const value = percentage(part, total);

          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
          expect(Number.isInteger(value)).toBe(true);
        },
      ),
    );
  });

  it("is monotonic in the numerator", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 200 }), (total) => {
        for (let part = 1; part <= total; part += 1) {
          expect(percentage(part, total)).toBeGreaterThanOrEqual(
            percentage(part - 1, total),
          );
        }
      }),
      { numRuns: 25 },
    );
  });

  it("rejects inputs that would signal a caller bug", () => {
    expect(() => percentage(1, 0)).toThrow(/at least 1/);
    expect(() => percentage(-1, 5)).toThrow(/0 <= part <= total/);
    expect(() => percentage(6, 5)).toThrow(/0 <= part <= total/);
    expect(() => percentage(1.5, 5)).toThrow(/integer counts/);
  });
});
