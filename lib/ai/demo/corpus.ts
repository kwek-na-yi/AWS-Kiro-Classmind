import {
  contentTerms,
  keyTerms,
  normalise,
  shapeOf,
  splitSentences,
  termFrequencies,
  wordCount,
  type Sentence,
} from "@/lib/ai/demo/text";
import type { SourceCorpus } from "@/lib/ai/provider";
import type { SourceUnit, Topic, UnderstandingLevel } from "@/lib/types";

/**
 * The source corpus, indexed for retrieval.
 *
 * Built once per request. Every sentence keeps the index of the unit it came
 * from, so anything the provider says can be traced back to a citable location
 * — a sentence that cannot name its unit is never emitted.
 */

export interface TopicView {
  topicId: string;
  name: string;
  order: number;
  sentences: Sentence[];
  /** The Topic's most frequent content terms. */
  terms: string[];
}

export interface IndexedCorpus {
  units: Map<number, SourceUnit>;
  topics: TopicView[];
  allSentences: Sentence[];
  /** False when there is nothing to ground an answer in. */
  usable: boolean;
}

/**
 * The unit's own heading, as plain text, or null when it has none.
 *
 * A `section` reference reads `§ Normalisation`; the heading itself is the rest.
 */
function headingOf(unit: SourceUnit): string | null {
  if (unit.ref.kind !== "section") return null;

  const heading = unit.ref.value.replace(/^§\s*/, "").trim();
  return heading.length > 0 ? heading : null;
}

/**
 * A unit's sentences, minus its own heading.
 *
 * Extraction keeps the heading at the top of the section text so a search for a
 * Topic name finds its own section. It is a label, not a claim, and treating it
 * as a sentence puts "1. Normalisation." at the head of a step-by-step recap and
 * offers the bare word as an answer option. Dropping exactly the heading leaves
 * every real statement intact.
 */
function sentencesOfUnit(unit: SourceUnit): Sentence[] {
  const heading = headingOf(unit);
  const headingKey = heading === null ? null : normalise(heading);

  return splitSentences(unit.text)
    .filter((text) => headingKey === null || normalise(text) !== headingKey)
    .map((text, position) => ({
      text,
      unitIdx: unit.index,
      position,
    }));
}

/**
 * Indexes the corpus by Topic.
 *
 * A Topic whose `unitIdxs` resolve to nothing gets an empty sentence list,
 * which is what the Recap reports as uncovered rather than filling in.
 */
export function indexCorpus(corpus: SourceCorpus): IndexedCorpus {
  const units = new Map<number, SourceUnit>();
  for (const unit of corpus.units) {
    if (unit.text.trim().length > 0) units.set(unit.index, unit);
  }

  const allSentences = [...units.values()]
    .sort((a, b) => a.index - b.index)
    .flatMap(sentencesOfUnit);

  const topics: TopicView[] = [...corpus.topics]
    .sort((a, b) => a.order - b.order)
    .map((topic: Topic) => {
      const sentences = topic.unitIdxs
        .filter((index) => units.has(index))
        .sort((a, b) => a - b)
        .flatMap((index) => sentencesOfUnit(units.get(index) as SourceUnit));

      return {
        topicId: topic.topicId,
        name: topic.name,
        order: topic.order,
        sentences,
        terms: keyTerms(
          [topic.name, ...sentences.map((sentence) => sentence.text)],
          8,
        ),
      };
    });

  return {
    units,
    topics,
    allSentences,
    usable: units.size > 0 && allSentences.length > 0,
  };
}

export interface ScoredSentence extends Sentence {
  score: number;
}

/**
 * Ranks sentences for a given Understanding_Level.
 *
 * The base score rewards a sentence for carrying terms that recur across the
 * Topic — a proxy for "this is what the Topic is about" — normalised by length
 * so a long sentence does not win merely by containing more words.
 *
 * The level then shifts what counts as a good sentence, which is how one source
 * text yields three genuinely different Recaps:
 *
 * - `No_Understanding` favours definitional sentences and shorter ones, and
 *   pushes edge cases down: a Learner with no exposure needs what the thing *is*.
 * - `Basic_Understanding` favours sentences linking concepts to one another.
 * - `Strong_Understanding` favours qualifications and conditions, and demotes
 *   the introductory definitions that Learner does not need.
 */
export function scoreSentences(
  sentences: readonly Sentence[],
  level: UnderstandingLevel,
  contextTexts: readonly string[] = [],
): ScoredSentence[] {
  const frequencies = termFrequencies([
    ...contextTexts,
    ...sentences.map((sentence) => sentence.text),
  ]);

  const scored = sentences.map((sentence) => {
    const terms = contentTerms(sentence.text);
    const mass = terms.reduce(
      (total, term) => total + (frequencies.get(term) ?? 0),
      0,
    );

    const base = terms.length === 0 ? 0 : mass / Math.sqrt(terms.length);
    const shape = shapeOf(sentence.text);
    const words = wordCount(sentence.text);

    let bonus = 0;

    if (level === "No_Understanding") {
      if (shape.definitional) bonus += 3;
      if (shape.exemplifying) bonus += 1;
      if (shape.qualifying) bonus -= 1;
      if (words <= 25) bonus += 1;
    } else if (level === "Basic_Understanding") {
      if (shape.relational) bonus += 3;
      if (shape.definitional) bonus += 1;
    } else {
      if (shape.qualifying) bonus += 3;
      if (shape.relational) bonus += 1;
      if (shape.definitional) bonus -= 2;
    }

    // Very short fragments — stray headings, list labels — carry little meaning.
    if (words < 4) bonus -= 3;

    return { ...sentence, score: base + bonus };
  });

  return scored.sort((a, b) => {
    const byScore = b.score - a.score;
    if (Math.abs(byScore) > 1e-9) return byScore;

    const byUnit = a.unitIdx - b.unitIdx;
    if (byUnit !== 0) return byUnit;

    return a.position - b.position;
  });
}

/** Restores reading order after ranking, so a section reads as the source does. */
export function inReadingOrder(sentences: readonly ScoredSentence[]): ScoredSentence[] {
  return [...sentences].sort((a, b) => {
    const byUnit = a.unitIdx - b.unitIdx;
    return byUnit !== 0 ? byUnit : a.position - b.position;
  });
}

/** The distinct unit indexes a set of sentences cites, ascending. */
export function citedUnits(sentences: readonly Sentence[]): number[] {
  return [...new Set(sentences.map((sentence) => sentence.unitIdx))].sort(
    (a, b) => a - b,
  );
}
