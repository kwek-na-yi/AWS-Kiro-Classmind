import "server-only";

import { getAIProvider } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai/provider";
import {
  projectClassMap,
  projectMisconceptions,
  type AnonymousClassMapEntry,
  type AnonymousMisconception,
} from "@/lib/domain/anonymise";
import {
  ANONYMITY_THRESHOLD,
  computeClassMap,
  type ClassMapEntry,
} from "@/lib/domain/classmap";
import {
  selectCandidates,
  type SelectionResponse,
  type TalliedQuizItem,
} from "@/lib/domain/misconception";
import { listSourceUnits, listTopics } from "@/lib/repo/material";
import {
  getClarifications,
  putClarification,
} from "@/lib/repo/misconception";
import { listQuizItems } from "@/lib/repo/pool";
import { listAllClassResponses } from "@/lib/repo/quiz";
import type { MisconceptionCandidate, QuizItem } from "@/lib/types";

/**
 * The Class_Understanding_Map and its misconceptions.
 *
 * Everything published here is an aggregate. The map is recomputed from the
 * persisted Quiz_Responses on every request rather than read from a stored
 * total, so it cannot go stale, and it passes through the anonymisation
 * allow-list before it is returned — a Learner_Id or Display_Name cannot reach
 * a caller structurally, not merely by convention.
 *
 * A clarification for a misconception is generated at most once per class and
 * cached, so the same wrong belief costs one generation for everyone.
 */

export interface InsightResult {
  topics: AnonymousClassMapEntry[];
  misconceptions: AnonymousMisconception[];
  anonymityThreshold: number;
  /** Topic id of the weakest published Topic, or null when none is published. */
  weakestTopicId: string | null;
  /** How many Learners have answered anything in this Class_Session. */
  respondingLearners: number;
  degraded: string[];
}

export interface InsightInput {
  sessionId: string;
  materialVersion: number;
  provider?: AIProvider;
  requestId?: string;
}

const TASK = "clarify";

/** Only the fields the misconception selector reads. */
function tallied(items: readonly QuizItem[]): TalliedQuizItem[] {
  return items.map((item) => ({
    quizItemId: item.quizItemId,
    topicId: item.topicId,
    options: item.options,
  }));
}

/**
 * Generates the clarifications a candidate set needs, reusing anything already
 * cached. Failure is not fatal: the candidate is still published with its Topic,
 * share and Misconception_Label, and only the explanatory text is missing.
 */
async function clarify(
  input: InsightInput,
  candidates: readonly MisconceptionCandidate[],
  items: readonly QuizItem[],
): Promise<{ byKey: Map<string, string>; degraded: boolean }> {
  const byKey = new Map<string, string>();
  if (candidates.length === 0) return { byKey, degraded: false };

  const key = (quizItemId: string, optionId: string) => `${quizItemId}|${optionId}`;

  const cached = await getClarifications(
    input.sessionId,
    input.materialVersion,
    candidates.map((candidate) => ({
      quizItemId: candidate.quizItemId,
      optionId: candidate.optionId,
    })),
  );

  for (const entry of cached) {
    byKey.set(key(entry.quizItemId, entry.optionId), entry.clarification);
  }

  const missing = candidates.filter(
    (candidate) => !byKey.has(key(candidate.quizItemId, candidate.optionId)),
  );

  if (missing.length === 0) return { byKey, degraded: false };

  const [units, topics] = await Promise.all([
    listSourceUnits(input.sessionId, input.materialVersion),
    listTopics(input.sessionId, input.materialVersion),
  ]);

  const provider = input.provider ?? getAIProvider();
  let degraded = false;

  for (const candidate of missing) {
    const item = items.find((entry) => entry.quizItemId === candidate.quizItemId);
    if (!item) continue;

    const correct = item.options.find((option) => option.isCorrect);
    const distractor = item.options.find(
      (option) => option.optionId === candidate.optionId,
    );
    if (!correct || !distractor) continue;

    const result = await provider.clarifyMisconception({
      context: {
        sessionId: input.sessionId,
        materialVersion: input.materialVersion,
        requestId: input.requestId,
      },
      corpus: { units, topics },
      misconception: {
        quizItemId: item.quizItemId,
        topicId: item.topicId,
        stem: item.stem,
        correctOptionText: correct.text,
        distractorText: distractor.text,
        misconceptionLabel: candidate.misconceptionLabel,
        unitIdx: item.unitIdx,
      },
    });

    if (!result.ok) {
      degraded = true;
      continue;
    }

    byKey.set(
      key(candidate.quizItemId, candidate.optionId),
      result.value.clarification,
    );

    await putClarification(input.sessionId, input.materialVersion, {
      quizItemId: candidate.quizItemId,
      optionId: candidate.optionId,
      clarification: result.value.clarification,
      generatedAt: new Date().toISOString(),
    });
  }

  return { byKey, degraded };
}

/** The weakest published Topic — the one the class most needs to work on. */
function weakestPublished(entries: readonly ClassMapEntry[]): string | null {
  // `computeClassMap` already orders published Topics weakest first.
  const published = entries.find((entry) => entry.status === "published");
  return published?.topicId ?? null;
}

/**
 * Builds the Class Insight response.
 *
 * One partition query supplies every Quiz_Response; Topics and Quiz_Items are
 * fetched alongside it. All the arithmetic is integer counting in
 * `lib/domain/`, so no generation is involved in deciding what the class is
 * weak on or which misconception is shared.
 */
export async function getClassInsight(input: InsightInput): Promise<InsightResult> {
  const [allResponses, topics, items] = await Promise.all([
    listAllClassResponses(input.sessionId),
    listTopics(input.sessionId, input.materialVersion),
    listQuizItems(input.sessionId, input.materialVersion),
  ]);

  // Only answers to the current material's questions count. Responses are not
  // keyed by material version and Topic ids are slugs of Topic names, so after
  // a revised lecture is uploaded into a class, answers to the superseded
  // version would otherwise be tallied under the new version's Topics.
  const currentItemIds = new Set(items.map((item) => item.quizItemId));
  const responses = allResponses.filter((response) => currentItemIds.has(response.quizItemId));

  const namedTopics = topics.map((topic) => ({
    topicId: topic.topicId,
    name: topic.name,
  }));

  const entries = computeClassMap(
    namedTopics,
    responses.map((response) => ({
      topicId: response.topicId,
      learnerId: response.learnerId,
      isCorrect: response.isCorrect,
    })),
  );

  const selectionResponses: SelectionResponse[] = responses.map((response) => ({
    quizItemId: response.quizItemId,
    optionId: response.optionId,
    learnerId: response.learnerId,
  }));

  const candidates = selectCandidates(tallied(items), selectionResponses, {
    topicNames: new Map(topics.map((topic) => [topic.topicId, topic.name])),
  });

  const { byKey, degraded } = await clarify(input, candidates, items);

  const misconceptions = projectMisconceptions(
    candidates.map((candidate) => ({
      topicId: candidate.topicId,
      topicName:
        topics.find((topic) => topic.topicId === candidate.topicId)?.name ??
        candidate.topicId,
      sharePercent: candidate.share,
      misconceptionLabel: candidate.misconceptionLabel,
      clarification: byKey.get(`${candidate.quizItemId}|${candidate.optionId}`),
    })),
  );

  return {
    topics: projectClassMap(entries),
    misconceptions,
    anonymityThreshold: ANONYMITY_THRESHOLD,
    weakestTopicId: weakestPublished(entries),
    respondingLearners: new Set(responses.map((response) => response.learnerId)).size,
    degraded: degraded ? [TASK] : [],
  };
}
