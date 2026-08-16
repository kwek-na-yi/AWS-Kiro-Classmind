import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { indexUnits, resolveRef, resolveRefs } from "@/lib/ai/resolve";
import type { SourceUnit } from "@/lib/types";

function unit(index: number, value: string): SourceUnit {
  return {
    materialVersion: 1,
    index,
    text: `Text of unit ${index}`,
    ref: { kind: "page", value },
  };
}

const UNITS = [unit(0, "p. 1"), unit(1, "p. 2"), unit(7, "p. 8")];

describe("resolveRefs", () => {
  it("resolves in-range indexes to their references", () => {
    expect(resolveRefs([0, 7], UNITS)).toEqual({
      refs: [
        { kind: "page", value: "p. 1" },
        { kind: "page", value: "p. 8" },
      ],
      resolved: [0, 7],
      unresolved: [],
    });
  });

  it("reports indexes that name no persisted unit", () => {
    const result = resolveRefs([0, 3, 99], UNITS);

    expect(result.resolved).toEqual([0]);
    expect(result.unresolved).toEqual([3, 99]);
    expect(result.refs).toHaveLength(1);
  });

  it("returns nothing resolvable when every index is out of range", () => {
    const result = resolveRefs([42, 43], UNITS);

    expect(result.refs).toEqual([]);
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([42, 43]);
  });

  it("collapses duplicates and normalises order", () => {
    expect(resolveRefs([7, 0, 7, 0], UNITS).resolved).toEqual([0, 7]);
  });

  it("handles an empty citation list", () => {
    expect(resolveRefs([], UNITS)).toEqual({ refs: [], resolved: [], unresolved: [] });
  });

  it("accepts a prebuilt index", () => {
    expect(resolveRefs([1], indexUnits(UNITS)).refs).toEqual([
      { kind: "page", value: "p. 2" },
    ]);
  });

  it("never invents a reference for an index the corpus lacks", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -50, max: 200 }), { maxLength: 20 }),
        (indexes) => {
          const result = resolveRefs(indexes, UNITS);
          const valid = new Set(UNITS.map((entry) => entry.index));

          expect(result.refs).toHaveLength(result.resolved.length);
          for (const index of result.resolved) expect(valid.has(index)).toBe(true);
          for (const index of result.unresolved) expect(valid.has(index)).toBe(false);
        },
      ),
    );
  });

  it("rebuilds the reference rather than sharing the unit's object", () => {
    const [ref] = resolveRefs([0], UNITS).refs;
    expect(ref).not.toBe(UNITS[0].ref);
  });
});

describe("resolveRef", () => {
  it("resolves one index or returns null", () => {
    expect(resolveRef(1, UNITS)).toEqual({ kind: "page", value: "p. 2" });
    expect(resolveRef(99, UNITS)).toBeNull();
  });
});
