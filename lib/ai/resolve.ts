import type { SourceRef, SourceUnit } from "@/lib/types";

/**
 * Citation resolution.
 *
 * A provider cites source units by index; this module turns those indexes into
 * the Source_References a Learner sees. It is the enforcement point for the
 * grounding rule: an index that does not exist resolves to nothing, so a
 * citation can never point at a location the material does not have.
 *
 * Pure — no I/O — so the check is trivially testable and cannot fail open.
 */

export interface ResolvedRefs {
  /** References for the in-range indexes, in ascending index order. */
  refs: SourceRef[];
  /** The indexes that resolved, ascending and de-duplicated. */
  resolved: number[];
  /** The indexes that named no persisted unit. */
  unresolved: number[];
}

/** Indexes source units for repeated lookups. */
export function indexUnits(
  units: readonly SourceUnit[],
): ReadonlyMap<number, SourceUnit> {
  return new Map(units.map((unit) => [unit.index, unit]));
}

/**
 * Resolves cited unit indexes against the persisted source units.
 *
 * Duplicates collapse and order is normalised, so the same citation set always
 * produces the same references regardless of the order a provider listed them.
 */
export function resolveRefs(
  unitIdxs: readonly number[],
  units: readonly SourceUnit[] | ReadonlyMap<number, SourceUnit>,
): ResolvedRefs {
  const index = units instanceof Map ? units : indexUnits(units as readonly SourceUnit[]);

  const resolved: number[] = [];
  const unresolved: number[] = [];

  for (const unitIdx of [...new Set(unitIdxs)].sort((a, b) => a - b)) {
    if (index.has(unitIdx)) {
      resolved.push(unitIdx);
    } else {
      unresolved.push(unitIdx);
    }
  }

  return {
    refs: resolved.map((unitIdx) => {
      const unit = index.get(unitIdx) as SourceUnit;
      return { kind: unit.ref.kind, value: unit.ref.value };
    }),
    resolved,
    unresolved,
  };
}

/** Resolves a single index, or null when it names no persisted unit. */
export function resolveRef(
  unitIdx: number,
  units: readonly SourceUnit[] | ReadonlyMap<number, SourceUnit>,
): SourceRef | null {
  return resolveRefs([unitIdx], units).refs[0] ?? null;
}
