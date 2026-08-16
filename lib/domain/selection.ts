import { MAX_DIFFICULTY, MIN_DIFFICULTY } from "@/lib/domain/difficulty";
import type { DifficultyLevel, QuizItem } from "@/lib/types";

/**
 * Deterministic Quiz_Item selection.
 *
 * There is no randomness anywhere in this module. Identical persisted input
 * produces an identical sequence of served items, which is what lets a
 * Quiz_Session be replayed, tested as a property, and rehearsed on stage
 * without the demo changing under the presenter.
 *
 * Pure: no I/O, no clock, no shared state.
 */

/** Just enough of a Quiz_Response to count Topic coverage. */
export interface TopicResponseLike {
  topicId: string;
}

/**
 * The Difficulty_Levels to try, nearest first, preferring the lower level when
 * two are equally near: from 2 → 2, 1, 3; from 1 → 1, 2, 3; from 3 → 3, 2, 1.
 */
export function difficultyWalk(from: DifficultyLevel): DifficultyLevel[] {
  const levels: DifficultyLevel[] = [];
  for (let level = MIN_DIFFICULTY; level <= MAX_DIFFICULTY; level += 1) {
    levels.push(level as DifficultyLevel);
  }

  return levels.sort((a, b) => {
    const distance = Math.abs(a - from) - Math.abs(b - from);
    return distance !== 0 ? distance : a - b;
  });
}

/** Byte-wise string order, so the result cannot vary with the host locale. */
function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Chooses the next Quiz_Item to serve, or null when the pool is exhausted.
 *
 * Candidates are the unserved items at the Current_Difficulty. When that level
 * has none left, the nearest level with an unserved item is used instead, so a
 * Quiz_Session can always run to its full length as long as *any* item remains.
 *
 * Among candidates the order is total and fixed:
 *
 * 1. fewest responses so far in this Quiz_Session for the item's Topic — this
 *    spreads six items across the Topics, so the Understanding_Report has more
 *    than one Topic to report on;
 * 2. then the Topic's persisted order index;
 * 3. then the Quiz_Item id.
 *
 * Every tie is broken by the next rule, so the ordering never depends on the
 * order the pool happened to arrive in.
 */
export function selectNextItem(
  pool: readonly QuizItem[],
  servedIds: readonly string[],
  responses: readonly TopicResponseLike[],
  topicOrder: readonly string[],
  difficulty: DifficultyLevel,
): QuizItem | null {
  const served = new Set(servedIds);

  const responsesByTopic = new Map<string, number>();
  for (const response of responses) {
    responsesByTopic.set(
      response.topicId,
      (responsesByTopic.get(response.topicId) ?? 0) + 1,
    );
  }

  const topicPosition = new Map<string, number>();
  topicOrder.forEach((topicId, index) => topicPosition.set(topicId, index));

  // A Topic missing from the ordering sorts after every known Topic rather than
  // ahead of them, so an item referencing an unknown Topic can still be served
  // but never displaces a properly ordered one.
  const positionOf = (topicId: string): number =>
    topicPosition.get(topicId) ?? Number.MAX_SAFE_INTEGER;

  for (const level of difficultyWalk(difficulty)) {
    const candidates = pool.filter(
      (item) => item.difficulty === level && !served.has(item.quizItemId),
    );

    if (candidates.length === 0) continue;

    const ordered = [...candidates].sort((a, b) => {
      const byCoverage =
        (responsesByTopic.get(a.topicId) ?? 0) - (responsesByTopic.get(b.topicId) ?? 0);
      if (byCoverage !== 0) return byCoverage;

      const byTopic = positionOf(a.topicId) - positionOf(b.topicId);
      if (byTopic !== 0) return byTopic;

      return compareIds(a.quizItemId, b.quizItemId);
    });

    return ordered[0];
  }

  return null;
}
