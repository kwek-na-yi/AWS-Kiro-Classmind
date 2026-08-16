/**
 * The single rounding helper.
 *
 * Both the per-Learner Topic_Mastery and the class-wide Class_Mastery are
 * percentages "rounded to the nearest integer", which leaves the exact `.5`
 * case open. This module fixes it once, half-up, so a Learner's 50% and the
 * class's 50% are computed by the same rule and mean the same thing.
 *
 * It exists as its own module precisely so there is one definition site: a
 * second rounding rule appearing anywhere would make two published numbers
 * silently incomparable.
 */

/**
 * Rounds to the nearest integer, with a tie going up.
 *
 * `Math.round` is exactly this rule — ties toward positive infinity — and is
 * wrapped rather than called directly so the choice is stated in one place and
 * a non-finite input fails loudly instead of propagating `NaN` into a report.
 */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`roundHalfUp expects a finite number, got ${value}`);
  }

  return Math.round(value);
}

/**
 * A count as a whole-number percentage of a total.
 *
 * Counts accumulate as integers and are divided **once**, then rounded
 * **once**. Dividing per response and summing floats would make the result
 * depend on the order responses happened to be read in; this way the value is a
 * function of the response *set* alone, which is what makes the same input
 * reproduce the same number on every run.
 */
export function percentage(part: number, total: number): number {
  if (!Number.isInteger(part) || !Number.isInteger(total)) {
    throw new RangeError(
      `percentage expects integer counts, got ${part}/${total}`,
    );
  }
  if (total <= 0) {
    throw new RangeError("percentage expects a total of at least 1");
  }
  if (part < 0 || part > total) {
    throw new RangeError(`percentage expects 0 <= part <= total, got ${part}/${total}`);
  }

  return roundHalfUp((100 * part) / total);
}
