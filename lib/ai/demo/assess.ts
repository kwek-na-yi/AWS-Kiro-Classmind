import { scoreSentences, type IndexedCorpus } from "@/lib/ai/demo/corpus";
import {
  asSentence,
  contentTerms,
  negationCount,
  numbersIn,
  overlapCount,
  truncateChars,
  truncateWords,
  type Sentence,
} from "@/lib/ai/demo/text";
import type {
  AssessmentOutput,
  ClarificationOutput,
  MisconceptionInput,
  PeerExplanationInput,
} from "@/lib/ai/provider";

/**
 * Deterministic clarification and Peer_Explanation assessment.
 *
 * Both work by lexical comparison against the source text. That is a real
 * limitation and it is stated plainly here: this compares *words*, not meaning.
 * A correct explanation phrased entirely in the Learner's own vocabulary will
 * read as unsupported, and a contradiction expressed without a negation word
 * will not be caught. The thresholds below are therefore tuned to be cautious —
 * `Validated` requires strong overlap, because wrongly blessing an incorrect
 * explanation is the failure that would mislead a class.
 */

/** Fraction of the explanation's terms that must appear in the source. */
const VALIDATION_COVERAGE = 0.6;
/** Terms a single source sentence must share before it counts as support. */
const SUPPORTING_OVERLAP = 2;
/** Share of a sentence's terms an explanation must match to be judged against it. */
const CONTRADICTION_OVERLAP = 0.5;

const MAX_CLARIFICATION_CHARS = 400;
const MAX_REASON_CHARS = 300;

// ---------------------------------------------------------------------------
// Clarification
// ---------------------------------------------------------------------------

/**
 * Explains why the correct Answer_Option is correct, quoting the source.
 *
 * The clarification is assembled from the Quiz_Item's own correct option and a
 * sentence from the cited unit — it restates the source's position rather than
 * arguing a new one.
 */
export function buildClarification(
  corpus: IndexedCorpus,
  misconception: MisconceptionInput,
): ClarificationOutput | null {
  if (!corpus.usable) return null;

  const wanted = contentTerms(
    `${misconception.correctOptionText} ${misconception.stem}`,
  );

  const unit =
    corpus.units.get(misconception.unitIdx) ??
    // The cited unit may have been purged with an older material version; fall
    // back to whichever unit best matches the correct answer rather than
    // citing something arbitrary.
    [...corpus.units.values()].sort(
      (a, b) => overlapCount(wanted, b.text) - overlapCount(wanted, a.text),
    )[0];

  if (!unit) return null;

  const sentences: Sentence[] = corpus.allSentences.filter(
    (sentence) => sentence.unitIdx === unit.index,
  );

  const supporting =
    [...sentences].sort(
      (a, b) => overlapCount(wanted, b.text) - overlapCount(wanted, a.text),
    )[0] ?? sentences[0];

  const quoted = supporting ? asSentence(truncateWords(supporting.text, 40)) : "";

  const clarification = truncateChars(
    [
      quoted ? `The lecture material states: "${quoted}"` : "",
      `That supports: ${asSentence(misconception.correctOptionText)}`,
      `Choosing "${truncateWords(misconception.distractorText, 14)}" reflects ${misconception.misconceptionLabel}, which the material does not state.`,
    ]
      .filter((part) => part.length > 0)
      .join(" "),
    MAX_CLARIFICATION_CHARS,
  );

  return { clarification, unitIdx: unit.index };
}

// ---------------------------------------------------------------------------
// Peer_Explanation assessment
// ---------------------------------------------------------------------------

interface Match {
  sentence: Sentence;
  shared: number;
  /** Shared terms as a fraction of the source sentence's own terms. */
  ratio: number;
}

function bestMatches(
  sentences: readonly Sentence[],
  terms: readonly string[],
): Match[] {
  return sentences
    .map((sentence) => {
      const sourceTerms = contentTerms(sentence.text);
      const shared = overlapCount(terms, sentence.text);

      return {
        sentence,
        shared,
        ratio: sourceTerms.length === 0 ? 0 : shared / sourceTerms.length,
      };
    })
    .sort((a, b) => {
      const byShared = b.shared - a.shared;
      if (byShared !== 0) return byShared;

      const byRatio = b.ratio - a.ratio;
      if (Math.abs(byRatio) > 1e-9) return byRatio;

      const byUnit = a.sentence.unitIdx - b.sentence.unitIdx;
      return byUnit !== 0 ? byUnit : a.sentence.position - b.sentence.position;
    });
}

/**
 * Whether the explanation asserts the opposite of a source sentence it is
 * otherwise talking about.
 *
 * Two signals, both structural: the explanation negates where the source does
 * not (or the reverse), or the two state different numbers for the same claim.
 * Both require the explanation to be clearly discussing that sentence, so an
 * unrelated negation elsewhere cannot trigger it.
 */
function contradicts(explanation: string, match: Match): boolean {
  if (match.ratio < CONTRADICTION_OVERLAP || match.shared < SUPPORTING_OVERLAP) {
    return false;
  }

  const explanationNegations = negationCount(explanation);
  const sourceNegations = negationCount(match.sentence.text);

  if (explanationNegations > 0 !== sourceNegations > 0) return true;

  const explanationNumbers = numbersIn(explanation);
  const sourceNumbers = numbersIn(match.sentence.text);

  if (explanationNumbers.length > 0 && sourceNumbers.length > 0) {
    const agrees = explanationNumbers.some((value) => sourceNumbers.includes(value));
    if (!agrees) return true;
  }

  return false;
}

/**
 * Assesses a Peer_Explanation against the source text.
 *
 * Precedence is Contradicted > Unsupported > Validated: an explanation holding
 * one conflicting claim and one unsupported claim is Contradicted, because the
 * conflict is the more serious thing to tell the class about.
 */
export function assessExplanation(
  corpus: IndexedCorpus,
  explanation: PeerExplanationInput,
): AssessmentOutput | null {
  if (!corpus.usable) return null;

  const terms = contentTerms(explanation.text);

  if (terms.length === 0) {
    return {
      status: "Unsupported",
      unitIdxs: [],
      reason: truncateChars(
        "The explanation contains no statement that can be checked against the lecture material.",
        MAX_REASON_CHARS,
      ),
    };
  }

  const topic = corpus.topics.find((entry) => entry.topicId === explanation.topicId);
  // An explanation on an unknown Topic is still checked, against the whole
  // corpus, rather than being rejected on a technicality.
  const scope = topic && topic.sentences.length > 0 ? topic.sentences : corpus.allSentences;

  const matches = bestMatches(scope, terms);
  const best = matches[0];

  if (best && contradicts(explanation.text, best)) {
    return {
      status: "Contradicted",
      unitIdxs: [best.sentence.unitIdx],
      reason: truncateChars(
        `This conflicts with the lecture material, which states: "${truncateWords(best.sentence.text, 30)}"`,
        MAX_REASON_CHARS,
      ),
    };
  }

  const covered = terms.filter((term) =>
    scope.some((sentence) => overlapCount([term], sentence.text) > 0),
  );
  const coverage = covered.length / terms.length;

  if (best && best.shared >= SUPPORTING_OVERLAP && coverage >= VALIDATION_COVERAGE) {
    const supporting = matches
      .filter((match) => match.shared >= SUPPORTING_OVERLAP)
      .slice(0, 3)
      .map((match) => match.sentence.unitIdx);

    return {
      status: "Validated",
      unitIdxs: [...new Set(supporting)].sort((a, b) => a - b),
      reason: null,
    };
  }

  const unsupported = [...new Set(terms.filter((term) => !covered.includes(term)))]
    .slice(0, 4)
    .join(", ");

  return {
    status: "Unsupported",
    unitIdxs: [],
    reason: truncateChars(
      unsupported.length > 0
        ? `The lecture material does not state this. Unsupported wording: ${unsupported}.`
        : "The lecture material does not state this clearly enough to confirm it.",
      MAX_REASON_CHARS,
    ),
  };
}

/** Exported for tests and for callers wanting the ranking without the verdict. */
export { bestMatches, scoreSentences };
