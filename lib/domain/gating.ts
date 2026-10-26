import type { PeerExplanation, ValidationStatus } from "@/lib/types";

/**
 * Which Peer_Explanations the Web_App may present as trustworthy.
 *
 * Recommendation is decided here, over the persisted Validation_Status, and
 * nowhere else. A handler never assembles this list itself, so an explanation
 * cannot reach Recommended_Explanations by any route other than having been
 * assessed and found supported.
 *
 * Every explanation is retained whatever its status — this module filters what
 * is *recommended*, never what is stored or shown.
 */

/** The only status that may be recommended. */
const RECOMMENDABLE: ValidationStatus = "Validated";

/**
 * Explanations safe to present as study material, strongest first.
 *
 * Ordering is by supporting citations, then by length as a rough proxy for how
 * much of the idea an explanation actually covers, then by id so the result is
 * a total order and a reload never reshuffles the list.
 */
export function recommended(
  explanations: readonly PeerExplanation[],
): PeerExplanation[] {
  return explanations
    .filter((explanation) => explanation.status === RECOMMENDABLE)
    .sort((a, b) => {
      const byCitations = (b.sourceRef ? 1 : 0) - (a.sourceRef ? 1 : 0);
      if (byCitations !== 0) return byCitations;

      const byLength = b.text.length - a.text.length;
      if (byLength !== 0) return byLength;

      return a.explanationId < b.explanationId ? -1 : 1;
    });
}

/**
 * The single explanation to feature, or null when none qualifies.
 *
 * Null rather than a fallback: presenting an unvalidated explanation as the one
 * to read would be exactly the failure the validation step exists to prevent.
 */
export function topRecommendation(
  explanations: readonly PeerExplanation[],
): PeerExplanation | null {
  return recommended(explanations)[0] ?? null;
}

/**
 * Every explanation in the thread, in the order a reader should meet them:
 * recommended first, then the rest oldest-first so a conversation reads
 * chronologically.
 */
export function orderThread(
  explanations: readonly PeerExplanation[],
): PeerExplanation[] {
  const recommendedIds = new Set(
    recommended(explanations).map((explanation) => explanation.explanationId),
  );

  const rest = explanations
    .filter((explanation) => !recommendedIds.has(explanation.explanationId))
    .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));

  return [...recommended(explanations), ...rest];
}

/** How many explanations sit in each Validation_Status. */
export function statusCounts(
  explanations: readonly PeerExplanation[],
): Record<ValidationStatus, number> {
  const counts: Record<ValidationStatus, number> = {
    Pending: 0,
    Validated: 0,
    Unsupported: 0,
    Contradicted: 0,
  };

  for (const explanation of explanations) counts[explanation.status] += 1;

  return counts;
}
