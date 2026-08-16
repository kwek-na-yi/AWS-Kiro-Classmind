import { ANONYMITY_THRESHOLD } from "@/lib/domain/classmap";
import { percentage } from "@/lib/domain/round";
import type { AnswerOption, MisconceptionCandidate } from "@/lib/types";

/**
 * Misconception candidate selection.
 *
 * Finds the Distractors a large share of the class chose — the wrong beliefs
 * worth clarifying once for everyone rather than privately for each Learner.
 *
 * Entirely deterministic counting: no generation is involved in deciding *what*
 * the misconceptions are. A clarification may be generated later for a
 * candidate chosen here, but the choosing is arithmetic, so the same responses
 * always surface the same misconceptions.
 */

/** A Distractor must be chosen at least this many times to qualify. */
export const MIN_SELECTION_COUNT = 2;
/** …and by at least this share of the responses to the Quiz_Item. */
export const MIN_SHARE_PERCENT = 30;
/** At most this many misconceptions are reported per Class_Session. */
export const MAX_CANDIDATES = 3;

/** Just enough of a Quiz_Item to tally its Answer_Options. */
export interface TalliedQuizItem {
  quizItemId: string;
  topicId: string;
  options: readonly AnswerOption[];
}

/** Just enough of a Quiz_Response to attribute a selection. */
export interface SelectionResponse {
  quizItemId: string;
  optionId: string;
  learnerId: string;
}

export interface QuizItemTally {
  /** Quiz_Responses recorded for the Quiz_Item. */
  itemResponses: number;
  /** Distinct Learners who answered it — the anonymity gate. */
  distinctLearners: number;
  /** Selection count per Answer_Option id, including the correct one. */
  byOption: Map<string, number>;
}

/**
 * Counts the responses to one Quiz_Item.
 *
 * Every response is counted in `itemResponses`, including those choosing the
 * correct Answer_Option, because the selection share of a Distractor is a share
 * of everyone who answered — not of everyone who got it wrong.
 */
export function tallyQuizItem(
  item: TalliedQuizItem,
  responses: readonly SelectionResponse[],
): QuizItemTally {
  const byOption = new Map<string, number>();
  const learnerIds = new Set<string>();
  let itemResponses = 0;

  for (const response of responses) {
    if (response.quizItemId !== item.quizItemId) continue;

    itemResponses += 1;
    learnerIds.add(response.learnerId);
    byOption.set(response.optionId, (byOption.get(response.optionId) ?? 0) + 1);
  }

  return { itemResponses, distinctLearners: learnerIds.size, byOption };
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareNames(a: string, b: string): number {
  return compareIds(a.toLowerCase(), b.toLowerCase());
}

/**
 * The strongest misconception in one Quiz_Item, or null when none qualifies.
 *
 * At most one candidate comes from any single Quiz_Item. Without that limit one
 * badly written question could fill the whole cap and show the class three
 * flavours of the same mistake, crowding out the misconceptions in other Topics.
 */
function bestCandidateForItem(
  item: TalliedQuizItem,
  responses: readonly SelectionResponse[],
  threshold: number,
): MisconceptionCandidate | null {
  const tally = tallyQuizItem(item, responses);

  // An unserved item has no evidence; below the threshold, publishing one would
  // describe an identifiable Learner's answer.
  if (tally.itemResponses === 0) return null;
  if (tally.distinctLearners < threshold) return null;

  const qualifying: MisconceptionCandidate[] = [];

  for (const option of item.options) {
    if (option.isCorrect) continue;

    const misconceptionLabel = option.misconceptionLabel?.trim() ?? "";
    // A Distractor with no Misconception_Label names no belief to clarify. The
    // pool validator rejects such items, so this is a guard, not a filter.
    if (misconceptionLabel.length === 0) continue;

    const selCount = tally.byOption.get(option.optionId) ?? 0;
    if (selCount < MIN_SELECTION_COUNT) continue;

    const share = percentage(selCount, tally.itemResponses);
    if (share < MIN_SHARE_PERCENT) continue;

    qualifying.push({
      quizItemId: item.quizItemId,
      topicId: item.topicId,
      optionId: option.optionId,
      misconceptionLabel,
      selCount,
      itemResponses: tally.itemResponses,
      share,
    });
  }

  if (qualifying.length === 0) return null;

  qualifying.sort((a, b) => {
    const byShare = b.share - a.share;
    if (byShare !== 0) return byShare;

    const byCount = b.selCount - a.selCount;
    if (byCount !== 0) return byCount;

    return compareIds(a.optionId, b.optionId);
  });

  return qualifying[0];
}

export interface SelectCandidatesOptions {
  /** Distinct Learners required before a Quiz_Item can produce a candidate. */
  threshold?: number;
  /** Topic names, used only to break a ranking tie deterministically. */
  topicNames?: ReadonlyMap<string, string>;
}

/**
 * The misconceptions worth showing the class, strongest first, capped at three.
 *
 * A Distractor qualifies only when at least two Learners chose it, it accounts
 * for at least 30 percent of the responses to its Quiz_Item, and at least three
 * distinct Learners answered that item. Ranking runs by descending share, then
 * descending count, then Topic name, then Quiz_Item id — a total order, so the
 * same response set always yields the same three.
 */
export function selectCandidates(
  items: readonly TalliedQuizItem[],
  responses: readonly SelectionResponse[],
  options: SelectCandidatesOptions = {},
): MisconceptionCandidate[] {
  const threshold = options.threshold ?? ANONYMITY_THRESHOLD;
  const topicNames = options.topicNames;

  const candidates = items.flatMap((item) => {
    const candidate = bestCandidateForItem(item, responses, threshold);
    return candidate ? [candidate] : [];
  });

  const nameOf = (topicId: string): string => topicNames?.get(topicId) ?? topicId;

  candidates.sort((a, b) => {
    const byShare = b.share - a.share;
    if (byShare !== 0) return byShare;

    const byCount = b.selCount - a.selCount;
    if (byCount !== 0) return byCount;

    const byTopic = compareNames(nameOf(a.topicId), nameOf(b.topicId));
    if (byTopic !== 0) return byTopic;

    return compareIds(a.quizItemId, b.quizItemId);
  });

  return candidates.slice(0, MAX_CANDIDATES);
}
