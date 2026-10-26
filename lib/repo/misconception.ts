import "server-only";

import { misconceptionSk, parseMisconceptionSk, sessionPk } from "@/lib/repo/keys";
import { getItem, getItems, putItem, type Item } from "@/lib/repo/table";
import type { SourceRef } from "@/lib/types";

/**
 * The misconception clarification cache.
 *
 * Which Distractors qualify as shared misconceptions is decided by pure
 * selection in `lib/domain/`; this module only retains the clarification text
 * generated for a qualifying (Quiz_Item, Answer_Option) pair, so a repeat view
 * of Class Insight costs a cache read rather than a fresh generation.
 */

interface ClarificationItem extends Item {
  clarification: string;
  sourceRef?: SourceRef;
  generatedAt: string;
}

export interface Clarification {
  quizItemId: string;
  optionId: string;
  clarification: string;
  sourceRef?: SourceRef;
  generatedAt: string;
}

export interface ClarificationRef {
  quizItemId: string;
  optionId: string;
}

export async function getClarification(
  sessionId: string,
  version: number,
  quizItemId: string,
  optionId: string,
): Promise<Clarification | null> {
  const item = await getItem<ClarificationItem>(
    sessionPk(sessionId),
    misconceptionSk(version, quizItemId, optionId),
  );
  if (!item) return null;

  return {
    quizItemId,
    optionId,
    clarification: item.clarification,
    sourceRef: item.sourceRef,
    generatedAt: item.generatedAt,
  };
}

/**
 * The cached clarifications for several candidates in one `BatchGetItem`.
 *
 * Class Insight shows at most three misconceptions, so this is one round trip
 * instead of three inside a 2-second budget.
 */
export async function getClarifications(
  sessionId: string,
  version: number,
  refs: readonly ClarificationRef[],
): Promise<Clarification[]> {
  if (refs.length === 0) return [];

  const items = await getItems<ClarificationItem>(
    refs.map((ref) => ({
      PK: sessionPk(sessionId),
      SK: misconceptionSk(version, ref.quizItemId, ref.optionId),
    })),
  );

  return items.flatMap((item) => {
    const parsed = parseMisconceptionSk(String(item.SK));
    if (!parsed) return [];

    return [
      {
        quizItemId: parsed.quizItemId,
        optionId: parsed.optionId,
        clarification: item.clarification,
        sourceRef: item.sourceRef,
        generatedAt: item.generatedAt,
      },
    ];
  });
}

export async function putClarification(
  sessionId: string,
  version: number,
  clarification: Clarification,
): Promise<void> {
  const item: ClarificationItem = {
    PK: sessionPk(sessionId),
    SK: misconceptionSk(version, clarification.quizItemId, clarification.optionId),
    clarification: clarification.clarification,
    sourceRef: clarification.sourceRef,
    generatedAt: clarification.generatedAt,
  };

  await putItem(item);
}
