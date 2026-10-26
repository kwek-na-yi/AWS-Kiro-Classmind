import "server-only";

import { getAIProvider } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai/provider";
import { countByDifficulty, validateQuizPool } from "@/lib/ai/tasks/pool";
import { logFallback } from "@/lib/aws/logger";
import {
  getMaterial,
  listSourceUnits,
  listTopics,
  setPoolStatus,
  transitionPoolStatus,
} from "@/lib/repo/material";
import { listQuizItems, putQuizItems } from "@/lib/repo/pool";
import type { DifficultyLevel, PoolStatus, QuizItem } from "@/lib/types";

/**
 * Quiz_Pool orchestration: generate → validate → persist, once per material.
 *
 * The pool is generated once and served from retention for every Quiz_Session
 * afterwards. Two things make a repeated call safe:
 *
 * - a Quiz_Item's identity is derived from its own content, so re-persisting the
 *   same question overwrites its own key rather than duplicating the pool;
 * - the pool is only marked `ready` after the items are written, so a reader
 *   never sees a status promising items that are not there yet.
 */

export const ENGINE_MINIMUM_ITEMS = 6;
/** Below this many items at a level, one level-scoped regeneration is attempted. */
const REGENERATION_FLOOR = 2;
/** The level-by-level target. */
const TARGET_PER_DIFFICULTY = 4;

const ALL_DIFFICULTIES: readonly DifficultyLevel[] = [1, 2, 3];
const TASK = "pool";

export interface PoolServiceResult {
  poolStatus: PoolStatus;
  countsByDifficulty: Record<DifficultyLevel, number>;
  /** Items persisted by this call; zero when the pool was already retained. */
  persisted: number;
  /** True when the pool can supply a full Quiz_Session. */
  meetsEngineMinimum: boolean;
  degraded: string[];
  /** Why individual generated items were rejected, for diagnosis. */
  discarded: { reason: string; count: number }[];
}

export interface PoolServiceInput {
  sessionId: string;
  materialVersion: number;
  provider?: AIProvider;
  requestId?: string;
  itemsPerDifficulty?: number;
}

function summariseDiscards(
  reasons: readonly { reason: string }[],
): { reason: string; count: number }[] {
  const counts = new Map<string, number>();

  for (const { reason } of reasons) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1));
}

/**
 * Generates and persists the Quiz_Pool for a Lecture_Material.
 *
 * Returns the retained pool untouched when one already exists, so the Instructor
 * page and the Quiz view can both call this without racing to double-generate.
 */
export async function generateAndPersistQuizPool(
  input: PoolServiceInput,
): Promise<PoolServiceResult> {
  const { sessionId, materialVersion } = input;

  const material = await getMaterial(sessionId, materialVersion);

  // Already generated: report the retained pool rather than building a new one.
  if (material?.poolStatus === "ready") {
    const existing = await listQuizItems(sessionId, materialVersion);
    const counts = countByDifficulty(existing);

    return {
      poolStatus: "ready",
      countsByDifficulty: counts,
      persisted: 0,
      meetsEngineMinimum: existing.length >= ENGINE_MINIMUM_ITEMS,
      degraded: [],
      discarded: [],
    };
  }

  const [units, topics] = await Promise.all([
    listSourceUnits(sessionId, materialVersion),
    listTopics(sessionId, materialVersion),
  ]);

  const provider = input.provider ?? getAIProvider();

  // At least one item per Topic per level, so no Topic is left out of the pool
  // entirely. A fixed target below the Topic count silently excluded the last
  // Topics of the material: they had no Quiz_Item at any level, so no Learner
  // could ever answer them and the Class_Understanding_Map showed them as
  // "not enough responses" for the life of the class.
  const itemsPerDifficulty =
    input.itemsPerDifficulty ?? Math.max(TARGET_PER_DIFFICULTY, topics.length);

  const unavailable = async (
    reason: Parameters<typeof logFallback>[0]["reason"],
    discarded: { reason: string; count: number }[] = [],
  ): Promise<PoolServiceResult> => {
    logFallback({
      task: TASK,
      classSessionId: sessionId,
      materialVersion,
      reason,
      attempts: 1,
      requestId: input.requestId ?? "unknown",
    });

    await setPoolStatus(sessionId, materialVersion, "unavailable");

    return {
      poolStatus: "unavailable",
      countsByDifficulty: { 1: 0, 2: 0, 3: 0 },
      persisted: 0,
      meetsEngineMinimum: false,
      degraded: [TASK],
      discarded,
    };
  };

  const first = await provider.generateQuizPool({
    context: { sessionId, materialVersion, requestId: input.requestId },
    corpus: { units, topics },
    itemsPerDifficulty,
  });

  if (!first.ok) return unavailable(first.reason);

  const validated = validateQuizPool({
    materialVersion,
    topics,
    units,
    output: first.value,
  });

  const items: QuizItem[] = [...validated.items];
  const discarded = [...validated.discarded];

  // A level that came back nearly empty gets exactly one more attempt, scoped to
  // that level alone — a second full generation would cost the whole pool's
  // latency to fix one difficulty.
  const thin = ALL_DIFFICULTIES.filter(
    (difficulty) => countByDifficulty(items)[difficulty] < REGENERATION_FLOOR,
  );

  if (thin.length > 0) {
    const retry = await provider.generateQuizPool({
      context: { sessionId, materialVersion, requestId: input.requestId },
      corpus: { units, topics },
      difficulties: thin,
      itemsPerDifficulty,
    });

    if (retry.ok) {
      const revalidated = validateQuizPool({
        materialVersion,
        topics,
        units,
        output: retry.value,
        existingItemIds: items.map((item) => item.quizItemId),
      });

      items.push(...revalidated.items);
      discarded.push(...revalidated.discarded);
    }
  }

  if (items.length === 0) {
    return unavailable("schema_invalid_after_repair", summariseDiscards(discarded));
  }

  await putQuizItems(sessionId, items);

  // Status flips only after the items are durable. A losing racer finds the
  // transition already made, which is the correct outcome, not an error.
  await transitionPoolStatus(sessionId, materialVersion, {
    from: "pending",
    to: "ready",
  });

  return {
    poolStatus: "ready",
    countsByDifficulty: countByDifficulty(items),
    persisted: items.length,
    meetsEngineMinimum: items.length >= ENGINE_MINIMUM_ITEMS,
    degraded: [],
    discarded: summariseDiscards(discarded),
  };
}
