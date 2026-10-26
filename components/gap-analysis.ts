import type { DifficultyLevel } from "@/lib/types";

/**
 * Characterises *why* a Topic came out weak, from the answers the Learner just
 * gave.
 *
 * This is presentation, not scoring: mastery percentages and Weak_Topic
 * classification are computed on the server by the deterministic engine and are
 * not touched here. All this does is read the difficulty of the questions a
 * Learner missed and turn that into the sentence a Learner actually wants —
 * "you have the idea but not the application" rather than "40%".
 *
 * It runs on data the quiz view already holds: each served question carries its
 * Topic and Difficulty_Level, and each answer comes back with its correctness.
 * Nothing is inferred beyond what those answers support, and a Topic with too
 * little evidence returns no verdict at all rather than a guess.
 */

export interface AnsweredQuestion {
  topicName: string;
  difficulty: DifficultyLevel;
  isCorrect: boolean;
}

/**
 * `unclear` is the honest verdict when every question on a Topic was missed but
 * none of them was foundational: the answers show the Topic did not hold, and
 * nothing more. Calling that "mixed" would claim some answers held when none
 * did, and calling it a concept gap would claim evidence that was never
 * gathered.
 */
export type GapKind = "conceptual" | "application" | "mixed" | "unclear";

export interface TopicGap {
  topicName: string;
  kind: GapKind;
  /** One sentence naming what the answers actually showed. */
  summary: string;
  missed: number;
  answered: number;
}

const FOUNDATIONAL: DifficultyLevel = 1;

/**
 * Reads one Topic's answers.
 *
 * A missed foundational question means the idea itself has not landed. Holding
 * the foundational question but missing the harder ones is the opposite
 * problem: the concept is there and the application is not. Missing everything
 * across levels is reported as mixed rather than guessing which came first, and
 * missing everything without ever being asked a foundational question is
 * reported as unclear rather than as either.
 */
function classify(topicName: string, answers: readonly AnsweredQuestion[]): TopicGap | null {
  const missed = answers.filter((answer) => !answer.isCorrect);

  // Nothing missed, or nothing to read: no verdict.
  if (missed.length === 0 || answers.length === 0) return null;

  const missedFoundational = missed.some((answer) => answer.difficulty === FOUNDATIONAL);
  const heldFoundational = answers.some(
    (answer) => answer.difficulty === FOUNDATIONAL && answer.isCorrect,
  );
  const missedHarder = missed.some((answer) => answer.difficulty > FOUNDATIONAL);

  const base = { topicName, missed: missed.length, answered: answers.length };

  if (missedFoundational && !heldFoundational) {
    return missedHarder
      ? {
          ...base,
          kind: "mixed",
          summary: "The core idea did not hold, and neither did the questions built on it.",
        }
      : {
          ...base,
          kind: "conceptual",
          summary: "The foundational question was missed — start with what this topic is.",
        };
  }

  if (heldFoundational && missedHarder) {
    return {
      ...base,
      kind: "application",
      summary: "You had the basics but the harder question did not follow — practise applying it.",
    };
  }

  // Everything asked on this Topic was missed, and none of it was foundational,
  // so there is no evidence separating "does not know the idea" from "cannot
  // apply it". Saying so is the whole verdict.
  if (missed.length === answers.length) {
    return {
      ...base,
      kind: "unclear",
      summary:
        answers.length === 1
          ? "The one question asked on this topic was missed — read it again before the next check."
          : "None of the questions on this topic held — read it again before the next check.",
    };
  }

  return {
    ...base,
    kind: "mixed",
    summary: "Some answers held and some did not — worth another read.",
  };
}

/**
 * Groups a Quiz_Session's answers by Topic and characterises each weak one.
 *
 * Topics are returned worst first — most missed, then fewest answered, then by
 * name — so the view can lead with the one thing most worth doing next.
 */
export function analyseGaps(answers: readonly AnsweredQuestion[]): TopicGap[] {
  const byTopic = new Map<string, AnsweredQuestion[]>();

  for (const answer of answers) {
    const existing = byTopic.get(answer.topicName) ?? [];
    existing.push(answer);
    byTopic.set(answer.topicName, existing);
  }

  const gaps: TopicGap[] = [];

  for (const [topicName, topicAnswers] of byTopic) {
    const gap = classify(topicName, topicAnswers);
    if (gap) gaps.push(gap);
  }

  return gaps.sort((a, b) => {
    const byMissed = b.missed - a.missed;
    if (byMissed !== 0) return byMissed;

    const byAnswered = a.answered - b.answered;
    if (byAnswered !== 0) return byAnswered;

    return a.topicName < b.topicName ? -1 : a.topicName > b.topicName ? 1 : 0;
  });
}

/** The short label shown on a gap chip. */
export const GAP_LABEL: Record<GapKind, string> = {
  conceptual: "Concept gap",
  application: "Application gap",
  mixed: "Mixed",
  unclear: "Not yet held",
};
