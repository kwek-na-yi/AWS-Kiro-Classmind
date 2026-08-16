import "server-only";

import { getAIProvider } from "@/lib/ai";
import type { AIProvider, LearnerProfileInput } from "@/lib/ai/provider";
import { buildFallbackRecap, buildRecap } from "@/lib/ai/tasks/recap";
import { logFallback } from "@/lib/aws/logger";
import { getRecap, listSourceUnits, listTopics, putRecap } from "@/lib/repo/material";
import type { Recap } from "@/lib/types";

/**
 * Recap orchestration: cache → generate → validate → persist.
 *
 * The retained Recap is the fast path and the common one. A profile combination
 * is generated at most once per material version, so a Learner switching back to
 * a style they have already seen pays a single key read.
 *
 * A generated Recap is only cached once it has passed validation, and a
 * Fallback_Mode Recap is never cached at all — so a degraded moment cannot
 * poison the cache for every later Learner who picks the same profile.
 */

export type RecapSource = "cache" | "generated" | "fallback";

export interface RecapServiceResult {
  recap: Recap;
  source: RecapSource;
  /** Generation tasks currently degraded, for the `degraded[]` response field. */
  degraded: string[];
  /** Advisory style post-check messages; never a reason to withhold a Recap. */
  warnings: string[];
}

export interface RecapServiceInput {
  sessionId: string;
  materialVersion: number;
  profile: LearnerProfileInput;
  provider?: AIProvider;
  requestId?: string;
  now?: () => string;
}

const TASK = "recap";

/**
 * Returns the Recap for a Learner_Profile, generating it if it is not retained.
 *
 * Every exit is a usable Recap: a cache hit, a freshly validated generation, or
 * a source extract. The Recap view is on the demo's critical path, so "nothing
 * to show" is not among the outcomes.
 */
export async function getOrGenerateRecap(
  input: RecapServiceInput,
): Promise<RecapServiceResult> {
  const { sessionId, materialVersion, profile } = input;

  const cached = await getRecap(
    sessionId,
    materialVersion,
    profile.understandingLevel,
    profile.explanationStyle,
  );

  if (cached) {
    return { recap: cached, source: "cache", degraded: [], warnings: [] };
  }

  const [units, topics] = await Promise.all([
    listSourceUnits(sessionId, materialVersion),
    listTopics(sessionId, materialVersion),
  ]);

  const fallback = (reason: Parameters<typeof logFallback>[0]["reason"]): RecapServiceResult => {
    logFallback({
      task: TASK,
      classSessionId: sessionId,
      materialVersion,
      reason,
      attempts: 1,
      requestId: input.requestId ?? "unknown",
    });

    return {
      recap: buildFallbackRecap({
        sessionId,
        materialVersion,
        profile,
        topics,
        units,
        now: input.now,
      }),
      source: "fallback",
      degraded: [TASK],
      warnings: [],
    };
  };

  const provider = input.provider ?? getAIProvider();

  const result = await provider.generateRecap({
    context: { sessionId, materialVersion, requestId: input.requestId },
    corpus: { units, topics },
    profile,
  });

  if (!result.ok) return fallback(result.reason);

  const built = buildRecap({
    sessionId,
    materialVersion,
    profile,
    topics,
    units,
    output: result.value,
    now: input.now,
  });

  // Validation failure is a generation failure: nothing from a response that
  // failed the checks reaches the cache.
  if (!built.ok) return fallback(built.reason);

  await putRecap(built.recap);

  return {
    recap: built.recap,
    source: "generated",
    degraded: [],
    warnings: built.warnings,
  };
}
