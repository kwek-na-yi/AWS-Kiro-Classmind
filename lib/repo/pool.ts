import "server-only";

import {
  parseQuizItemSk,
  prefixes,
  quizItemSk,
  sessionPk,
} from "@/lib/repo/keys";
import {
  putAll,
  queryPrefix,
  type Item,
} from "@/lib/repo/table";
import type { AnswerOption, DifficultyLevel, QuizItem, SourceRef } from "@/lib/types";

/**
 * Persistence for the Quiz_Pool — the Quiz_Items generated once per
 * Lecture_Material and retained for every Quiz_Session of the Class_Session.
 *
 * Validation of a candidate item (four options, one correct, a known Topic, a
 * resolvable citation) happens before a caller reaches this module: only
 * retained items are written here.
 */

interface QuizItemItem extends Item {
  topicId: string;
  difficulty: DifficultyLevel;
  stem: string;
  options: AnswerOption[];
  unitIdx: number;
  /**
   * The Source_Reference resolved from `unitIdx` at generation time, stored
   * alongside it so per-response feedback can cite the source without a second
   * read of the source units inside its 1-second budget.
   */
  sourceRef: SourceRef;
}

function toQuizItem(item: QuizItemItem): QuizItem | null {
  const parsed = parseQuizItemSk(String(item.SK));
  if (!parsed) return null;

  return {
    quizItemId: parsed.quizItemId,
    materialVersion: parsed.version,
    topicId: item.topicId,
    difficulty: parsed.difficulty,
    stem: item.stem,
    options: item.options,
    unitIdx: item.unitIdx,
    sourceRef: item.sourceRef,
  };
}

/** Persists retained Quiz_Items, chunked into `BatchWriteItem` batches of 25. */
export async function putQuizItems(
  sessionId: string,
  items: readonly QuizItem[],
): Promise<void> {
  const records: QuizItemItem[] = items.map((item) => ({
    PK: sessionPk(sessionId),
    SK: quizItemSk(item.materialVersion, item.difficulty, item.quizItemId),
    topicId: item.topicId,
    difficulty: item.difficulty,
    stem: item.stem,
    options: item.options,
    unitIdx: item.unitIdx,
    sourceRef: item.sourceRef,
  }));

  await putAll(records);
}

/** The whole Quiz_Pool of a material version. */
export async function listQuizItems(
  sessionId: string,
  version: number,
): Promise<QuizItem[]> {
  const items = await queryPrefix<QuizItemItem>(
    sessionId,
    prefixes.quizItems(version),
  );
  return items.flatMap((item) => toQuizItem(item) ?? []);
}

/**
 * One Quiz_Item when only its id is known — the shape of a submitted
 * Quiz_Response, which names the item but not the level it was served at.
 *
 * Implemented as the same single-partition pool query, then a match in memory:
 * the pool is 15–30 items, so this stays one query and never a scan.
 */
export async function findQuizItemById(
  sessionId: string,
  version: number,
  quizItemId: string,
): Promise<QuizItem | null> {
  const items = await listQuizItems(sessionId, version);
  return items.find((item) => item.quizItemId === quizItemId) ?? null;
}
