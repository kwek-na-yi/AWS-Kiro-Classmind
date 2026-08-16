import {
  scoreSentences,
  type IndexedCorpus,
  type ScoredSentence,
  type TopicView,
} from "@/lib/ai/demo/corpus";
import { asSentence, hashString, normalise, truncateWords } from "@/lib/ai/demo/text";
import type {
  QuizItemOutput,
  QuizOptionOutput,
  QuizPoolOutput,
} from "@/lib/ai/provider";
import type { DifficultyLevel } from "@/lib/types";

/**
 * Deterministic Quiz_Item construction.
 *
 * Every question is answerable from the lecture material and every option is
 * text the material actually contains. Distractors are drawn from *other*
 * Topics rather than invented or negated: a fabricated wrong answer risks being
 * accidentally true, while a true statement about the wrong Topic is reliably
 * wrong for this question — and names a real misconception, "confusing these two
 * things", which is exactly what the Misconception_Report needs.
 *
 * The three levels ask progressively narrower questions:
 *
 * 1. which statement the material makes about a Topic;
 * 2. which statement it makes about a specific term inside that Topic;
 * 3. which term completes a sentence taken from the material.
 */

const OPTION_COUNT = 4;
const DISTRACTOR_COUNT = OPTION_COUNT - 1;
const DEFAULT_ITEMS_PER_DIFFICULTY = 4;
const ALL_DIFFICULTIES: readonly DifficultyLevel[] = [1, 2, 3];

/** A Topic with its sentences pre-ranked, so item building is a lookup. */
interface QuizTopic extends TopicView {
  ranked: ScoredSentence[];
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term: string): RegExp {
  return new RegExp(`\\b${escapeForRegExp(term)}\\b`, "i");
}

/**
 * Assembles four options in a stable but non-obvious order.
 *
 * Options are ordered by a hash of their own text, so the correct answer is not
 * always in the same position, yet the same Quiz_Item always presents the same
 * order — a shuffle would break the replay guarantee the quiz depends on.
 */
function assembleOptions(
  correct: string,
  distractors: readonly { text: string; label: string }[],
): QuizOptionOutput[] | null {
  const seen = new Set<string>([normalise(correct)]);
  const options: QuizOptionOutput[] = [
    { text: correct, isCorrect: true, misconceptionLabel: null },
  ];

  for (const distractor of distractors) {
    const key = normalise(distractor.text);
    // A distractor equal to the correct answer would make two options right.
    if (key.length === 0 || seen.has(key)) continue;

    seen.add(key);
    options.push({
      text: distractor.text,
      isCorrect: false,
      misconceptionLabel: distractor.label,
    });

    if (options.length === OPTION_COUNT) break;
  }

  if (options.length !== OPTION_COUNT) return null;

  return options.sort((a, b) => {
    const byHash = hashString(a.text) - hashString(b.text);
    return byHash !== 0 ? byHash : a.text < b.text ? -1 : 1;
  });
}

/** The other Topics, in a rotation starting after the given one. */
function otherTopics(topics: readonly QuizTopic[], current: QuizTopic): QuizTopic[] {
  const start = topics.indexOf(current);

  return Array.from({ length: topics.length - 1 }, (_, offset) => {
    return topics[(start + offset + 1) % topics.length];
  });
}

function buildRecallItem(
  topic: QuizTopic,
  topics: readonly QuizTopic[],
  rotation: number,
): QuizItemOutput | null {
  const sentence = topic.ranked[rotation % topic.ranked.length];
  if (!sentence) return null;

  const distractors = otherTopics(topics, topic)
    .map((other) => {
      const candidate = other.ranked[rotation % Math.max(other.ranked.length, 1)];
      return candidate
        ? {
            text: asSentence(truncateWords(candidate.text, 26)),
            label: `Confuses ${topic.name} with ${other.name}`,
          }
        : null;
    })
    .filter((entry): entry is { text: string; label: string } => entry !== null);

  const options = assembleOptions(
    asSentence(truncateWords(sentence.text, 26)),
    distractors,
  );
  if (!options) return null;

  return {
    topicId: topic.topicId,
    difficulty: 1,
    stem: `Which statement about ${topic.name} does the lecture material make?`,
    options,
    unitIdx: sentence.unitIdx,
  };
}

function buildTermItem(
  topic: QuizTopic,
  topics: readonly QuizTopic[],
  rotation: number,
): QuizItemOutput | null {
  if (topic.terms.length === 0) return null;

  const term = topic.terms[rotation % topic.terms.length];
  const sentence =
    topic.ranked.find((candidate) => termPattern(term).test(candidate.text)) ??
    topic.ranked[0];
  if (!sentence) return null;

  const distractors = otherTopics(topics, topic)
    .map((other) => {
      const otherTerm = other.terms[rotation % Math.max(other.terms.length, 1)];
      const candidate =
        (otherTerm &&
          other.ranked.find((entry) => termPattern(otherTerm).test(entry.text))) ||
        other.ranked[0];

      return candidate && otherTerm
        ? {
            text: asSentence(truncateWords(candidate.text, 26)),
            label: `Confuses "${term}" with "${otherTerm}"`,
          }
        : null;
    })
    .filter((entry): entry is { text: string; label: string } => entry !== null);

  const options = assembleOptions(
    asSentence(truncateWords(sentence.text, 26)),
    distractors,
  );
  if (!options) return null;

  return {
    topicId: topic.topicId,
    difficulty: 2,
    stem: `According to the lecture material, which statement is made about "${term}"?`,
    options,
    unitIdx: sentence.unitIdx,
  };
}

function buildClozeItem(
  topic: QuizTopic,
  topics: readonly QuizTopic[],
  rotation: number,
): QuizItemOutput | null {
  if (topic.terms.length === 0) return null;

  const term = topic.terms[rotation % topic.terms.length];
  const pattern = termPattern(term);

  const sentence = topic.ranked.find((candidate) => pattern.test(candidate.text));
  if (!sentence) return null;

  const blanked = truncateWords(sentence.text, 34).replace(
    new RegExp(`\\b${escapeForRegExp(term)}\\b`, "gi"),
    "______",
  );

  const distractors = otherTopics(topics, topic)
    .map((other) => {
      const otherTerm = other.terms.find(
        (candidate) => normalise(candidate) !== normalise(term),
      );

      return otherTerm
        ? {
            text: otherTerm,
            label: `Substitutes "${otherTerm}" for "${term}"`,
          }
        : null;
    })
    .filter((entry): entry is { text: string; label: string } => entry !== null);

  // Fall back to this Topic's other terms when there are too few Topics to
  // supply three distinct alternatives.
  for (const candidate of topic.terms) {
    if (distractors.length >= DISTRACTOR_COUNT) break;
    if (normalise(candidate) === normalise(term)) continue;

    distractors.push({
      text: candidate,
      label: `Substitutes "${candidate}" for "${term}"`,
    });
  }

  const options = assembleOptions(term, distractors);
  if (!options) return null;

  return {
    topicId: topic.topicId,
    difficulty: 3,
    stem: `Complete this statement from the lecture material: "${blanked}"`,
    options,
    unitIdx: sentence.unitIdx,
  };
}

const BUILDERS: Record<
  DifficultyLevel,
  (topic: QuizTopic, topics: readonly QuizTopic[], rotation: number) => QuizItemOutput | null
> = {
  1: buildRecallItem,
  2: buildTermItem,
  3: buildClozeItem,
};

export interface BuildQuizPoolOptions {
  difficulties?: readonly DifficultyLevel[];
  itemsPerDifficulty?: number;
}

/**
 * Builds the Quiz_Pool.
 *
 * Items are produced by walking the Topics in rotation, so the pool spreads
 * across the material rather than exhausting one Topic first. A Topic that
 * cannot yield a well-formed item at some level is skipped rather than padded:
 * the server's validator would discard a malformed item anyway, and a short pool
 * is a state the quiz already handles.
 */
export function buildQuizPool(
  corpus: IndexedCorpus,
  options: BuildQuizPoolOptions = {},
): QuizPoolOutput {
  const difficulties = options.difficulties ?? ALL_DIFFICULTIES;
  const target = options.itemsPerDifficulty ?? DEFAULT_ITEMS_PER_DIFFICULTY;

  const topics: QuizTopic[] = corpus.topics
    .filter((topic) => topic.sentences.length > 0)
    .map((topic) => ({
      ...topic,
      // Ranked once, at a fixed level: item quality should not depend on which
      // Learner happens to trigger pool generation.
      ranked: scoreSentences(topic.sentences, "Basic_Understanding", [topic.name]),
    }));

  if (topics.length === 0) return { items: [] };

  const items: QuizItemOutput[] = [];
  const seenStems = new Set<string>();

  for (const difficulty of difficulties) {
    const build = BUILDERS[difficulty];
    let produced = 0;

    // Two passes over the Topics at most, so a Topic that cannot produce an
    // item never blocks the level from filling.
    for (let attempt = 0; attempt < topics.length * 3 && produced < target; attempt += 1) {
      const topic = topics[attempt % topics.length];
      const rotation = Math.floor(attempt / topics.length);

      const item = build(topic, topics, rotation);
      if (!item) continue;

      const key = normalise(item.stem);
      if (seenStems.has(key)) continue;

      seenStems.add(key);
      items.push(item);
      produced += 1;
    }
  }

  return { items };
}
