import { hashString, normalise } from "@/lib/ai/demo/text";
import type { QuizItemOutput, QuizPoolOutput } from "@/lib/ai/provider";
import { indexUnits, resolveRef } from "@/lib/ai/resolve";
import type {
  AnswerOption,
  DifficultyLevel,
  QuizItem,
  SourceUnit,
  Topic,
} from "@/lib/types";

/**
 * Server-side validation of a generated Quiz_Pool.
 *
 * A malformed Quiz_Item is discarded, never repaired and never persisted. The
 * quiz engine assumes every item it serves has four options with exactly one
 * correct answer; enforcing that here means the engine, the scoring and the
 * misconception detector can all take it as given rather than each re-checking.
 *
 * Discards are reported rather than swallowed, so a caller can tell the
 * difference between "the provider returned nothing" and "everything it
 * returned was unusable".
 */

const REQUIRED_OPTIONS = 4;
/** Ids assigned by position once an item is known to be well-formed. */
const OPTION_IDS = ["a", "b", "c", "d"] as const;

export type DiscardReason =
  | "option_count"
  | "correct_count"
  | "unknown_topic"
  | "unresolvable_unit"
  | "invalid_difficulty"
  | "empty_stem"
  | "empty_option"
  | "duplicate_option"
  | "missing_misconception_label"
  | "duplicate_item";

export interface DiscardedItem {
  reason: DiscardReason;
  stem: string;
  topicId: string;
}

export interface PoolValidationResult {
  items: QuizItem[];
  discarded: DiscardedItem[];
  countsByDifficulty: Record<DifficultyLevel, number>;
}

export interface PoolValidationInput {
  materialVersion: number;
  topics: readonly Topic[];
  units: readonly SourceUnit[];
  output: QuizPoolOutput;
  /** Item identities already persisted, so a re-run cannot collide with them. */
  existingItemIds?: readonly string[];
}

/**
 * A stable identity for a Quiz_Item, derived from its own content.
 *
 * Deriving rather than counting makes regeneration idempotent: the same
 * question always produces the same key, so a repeated pool write overwrites
 * itself instead of duplicating the pool. Contains no `#`, so it is safe in a
 * sort key.
 */
function itemId(topicId: string, difficulty: DifficultyLevel, stem: string): string {
  const digest = hashString(`${topicId}|${difficulty}|${normalise(stem)}`)
    .toString(16)
    .padStart(8, "0");

  return `${topicId}-d${difficulty}-${digest}`;
}

function validateItem(
  raw: QuizItemOutput,
  context: {
    materialVersion: number;
    topicIds: ReadonlySet<string>;
    units: ReadonlyMap<number, SourceUnit>;
  },
): { ok: true; item: QuizItem } | { ok: false; reason: DiscardReason } {
  const stem = typeof raw?.stem === "string" ? raw.stem.trim() : "";
  if (stem.length === 0) return { ok: false, reason: "empty_stem" };

  if (raw.difficulty !== 1 && raw.difficulty !== 2 && raw.difficulty !== 3) {
    return { ok: false, reason: "invalid_difficulty" };
  }

  if (typeof raw.topicId !== "string" || !context.topicIds.has(raw.topicId)) {
    return { ok: false, reason: "unknown_topic" };
  }

  const options = Array.isArray(raw.options) ? raw.options : [];
  if (options.length !== REQUIRED_OPTIONS) {
    return { ok: false, reason: "option_count" };
  }

  if (options.filter((option) => option?.isCorrect === true).length !== 1) {
    return { ok: false, reason: "correct_count" };
  }

  if (options.some((option) => typeof option?.text !== "string" || option.text.trim().length === 0)) {
    return { ok: false, reason: "empty_option" };
  }

  // Two options saying the same thing would make the item unanswerable, or
  // worse, silently give it two correct answers.
  const texts = new Set(options.map((option) => normalise(option.text)));
  if (texts.size !== REQUIRED_OPTIONS) {
    return { ok: false, reason: "duplicate_option" };
  }

  // Every Distractor must name the belief it represents — that label is what
  // the Misconception_Report is built from.
  if (
    options.some(
      (option) =>
        !option.isCorrect &&
        (typeof option.misconceptionLabel !== "string" ||
          option.misconceptionLabel.trim().length === 0),
    )
  ) {
    return { ok: false, reason: "missing_misconception_label" };
  }

  const sourceRef = resolveRef(raw.unitIdx, context.units);
  if (!sourceRef) return { ok: false, reason: "unresolvable_unit" };

  const answerOptions: AnswerOption[] = options.map((option, position) => ({
    optionId: OPTION_IDS[position],
    text: option.text.trim(),
    isCorrect: option.isCorrect === true,
    ...(option.isCorrect
      ? {}
      : { misconceptionLabel: (option.misconceptionLabel as string).trim() }),
  }));

  return {
    ok: true,
    item: {
      quizItemId: itemId(raw.topicId, raw.difficulty, stem),
      materialVersion: context.materialVersion,
      topicId: raw.topicId,
      difficulty: raw.difficulty,
      stem,
      options: answerOptions,
      unitIdx: raw.unitIdx,
      sourceRef,
    },
  };
}

/**
 * Filters a generated pool down to the items that are safe to persist.
 *
 * An item is retained only if it holds exactly four Answer_Options, exactly one
 * correct answer, a Topic belonging to this Class_Session, a unit index that
 * resolves to a real Source_Reference, and a Misconception_Label on every
 * Distractor.
 */
export function validateQuizPool(input: PoolValidationInput): PoolValidationResult {
  const topicIds = new Set(input.topics.map((topic) => topic.topicId));
  const units = indexUnits(input.units);

  const items: QuizItem[] = [];
  const discarded: DiscardedItem[] = [];
  const seen = new Set<string>(input.existingItemIds ?? []);

  for (const raw of input.output?.items ?? []) {
    const result = validateItem(raw, {
      materialVersion: input.materialVersion,
      topicIds,
      units,
    });

    if (!result.ok) {
      discarded.push({
        reason: result.reason,
        stem: typeof raw?.stem === "string" ? raw.stem : "",
        topicId: typeof raw?.topicId === "string" ? raw.topicId : "",
      });
      continue;
    }

    if (seen.has(result.item.quizItemId)) {
      discarded.push({
        reason: "duplicate_item",
        stem: result.item.stem,
        topicId: result.item.topicId,
      });
      continue;
    }

    seen.add(result.item.quizItemId);
    items.push(result.item);
  }

  return { items, discarded, countsByDifficulty: countByDifficulty(items) };
}

export function countByDifficulty(
  items: readonly QuizItem[],
): Record<DifficultyLevel, number> {
  const counts: Record<DifficultyLevel, number> = { 1: 0, 2: 0, 3: 0 };

  for (const item of items) counts[item.difficulty] += 1;

  return counts;
}
