import { percentage } from "@/lib/domain/round";
import type { DifficultyLevel } from "@/lib/types";

/**
 * Individual understanding arithmetic.
 *
 * Everything here is integer counting plus one division through the shared
 * rounding helper, so a Learner's Topic_Mastery is computed by exactly the rule
 * the Class_Understanding_Map uses. No I/O and no generation: an
 * Understanding_Report's numbers are always available, whatever else has
 * degraded.
 */

/** Below this percentage a Topic is a Weak_Topic. */
export const WEAK_TOPIC_THRESHOLD = 60;

/** Just enough of a Quiz_Response to score a Quiz_Session. */
export interface ScoredResponse {
  topicId: string;
  isCorrect: boolean;
  difficultyServed: DifficultyLevel;
}

export interface TopicMasteryEntry {
  topicId: string;
  /** Quiz_Responses for this Topic in the Quiz_Session. */
  answered: number;
  correct: number;
  /** `correct / answered` as a percentage, rounded half-up. */
  mastery: number;
  isWeak: boolean;
}

export interface MasterySummary {
  entries: TopicMasteryEntry[];
  /** The report's `topicMastery` map: Topic id to percentage. */
  topicMastery: Record<string, number>;
  weakTopics: string[];
  /** Null when no Quiz_Response in the Quiz_Session was correct. */
  highestCorrectDifficulty: DifficultyLevel | null;
}

/**
 * Topic_Mastery for every Topic holding at least one Quiz_Response.
 *
 * A Topic with no response is absent rather than reported as zero: no evidence
 * is not the same as evidence of no understanding, and showing 0% for an
 * unanswered Topic would misrepresent the Learner.
 *
 * Entries come back ordered by Topic id, which makes the result a function of
 * the response set alone — feeding the same responses in a different order
 * yields an identical array, not merely equivalent contents.
 */
export function computeTopicMastery(
  responses: readonly ScoredResponse[],
): TopicMasteryEntry[] {
  const answered = new Map<string, number>();
  const correct = new Map<string, number>();

  for (const response of responses) {
    answered.set(response.topicId, (answered.get(response.topicId) ?? 0) + 1);
    if (response.isCorrect) {
      correct.set(response.topicId, (correct.get(response.topicId) ?? 0) + 1);
    }
  }

  return [...answered.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((topicId) => {
      const total = answered.get(topicId) ?? 0;
      const hits = correct.get(topicId) ?? 0;
      const mastery = percentage(hits, total);

      return {
        topicId,
        answered: total,
        correct: hits,
        mastery,
        isWeak: mastery < WEAK_TOPIC_THRESHOLD,
      };
    });
}

/**
 * The Weak_Topics of a scored Quiz_Session: every Topic below the threshold,
 * and only those. Exactly 60 is not weak — the rule is *below* 60.
 */
export function selectWeakTopics(entries: readonly TopicMasteryEntry[]): string[] {
  return entries.filter((entry) => entry.isWeak).map((entry) => entry.topicId);
}

/**
 * The highest Difficulty_Level the Learner answered correctly, or null when no
 * response was correct — which is a different statement from "level 1", and the
 * report renders it differently.
 */
export function highestCorrectDifficulty(
  responses: readonly ScoredResponse[],
): DifficultyLevel | null {
  let highest: DifficultyLevel | null = null;

  for (const response of responses) {
    if (!response.isCorrect) continue;
    if (highest === null || response.difficultyServed > highest) {
      highest = response.difficultyServed;
    }
  }

  return highest;
}

/** Everything an Understanding_Report needs, computed in one pass of the rules. */
export function computeMasterySummary(
  responses: readonly ScoredResponse[],
): MasterySummary {
  const entries = computeTopicMastery(responses);

  const topicMastery: Record<string, number> = {};
  for (const entry of entries) {
    topicMastery[entry.topicId] = entry.mastery;
  }

  return {
    entries,
    topicMastery,
    weakTopics: selectWeakTopics(entries),
    highestCorrectDifficulty: highestCorrectDifficulty(responses),
  };
}
