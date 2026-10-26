/**
 * Deterministic text utilities for the demo provider.
 *
 * Everything here is counting and string handling — no model, no statistics
 * learned from anything, no randomness. Given identical input these functions
 * return identical output on every run and every machine, which is what lets the
 * demo provider be property-tested and rehearsed.
 */

/**
 * Words carrying no topical meaning, excluded when scoring or comparing text.
 * A fixed list rather than a computed one, so the behaviour cannot drift with
 * the corpus.
 *
 * The second block is the closed-class vocabulary a technical text is written
 * in — quantifiers, degree adverbs and discourse connectives. They are frequent
 * in every section, so a frequency ranking floats them to the top and a
 * generated question ends up asking what the material says about "every" or
 * "additionally". They carry no more topical meaning than "the" does.
 */
export const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "all", "also", "an", "and", "any",
  "are", "as", "at", "be", "because", "been", "before", "being", "below",
  "between", "both", "but", "by", "can", "cannot", "could", "did", "do", "does",
  "doing", "down", "during", "each", "few", "for", "from", "further", "had",
  "has", "have", "having", "he", "her", "here", "hers", "him", "his", "how",
  "however", "i", "if", "in", "into", "is", "it", "its", "itself", "just",
  "may", "me", "might", "more", "most", "must", "my", "no", "nor", "not", "now",
  "of", "off", "on", "once", "only", "or", "other", "our", "out", "over", "own",
  "same", "shall", "she", "should", "so", "some", "such", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "those", "through",
  "to", "too", "under", "until", "up", "very", "was", "we", "were", "what",
  "when", "where", "which", "while", "who", "whom", "why", "will", "with",
  "would", "you", "your",

  "additionally", "already", "always", "another", "even", "ever", "every",
  "less", "made", "make", "makes", "many", "means", "much", "never", "often",
  "one", "rather", "several", "still", "therefore", "though", "thus", "two",
  "usually", "whether", "whole", "within", "yet",
]);

/** Words that flip the polarity of a claim, used by the contradiction check. */
export const NEGATIONS = new Set([
  "not", "never", "no", "none", "cannot", "cant", "dont", "doesnt", "isnt",
  "arent", "wasnt", "werent", "without", "nothing", "neither", "nor", "fails",
  "unable",
]);

/** Openings that mark a sentence as definitional. */
const DEFINITIONAL = /\b(is|are|means|refers to|defined as|called|known as)\b/i;
/** Connectives that mark a sentence as explaining how concepts relate. */
const RELATIONAL = /\b(because|therefore|so that|which means|depends on|results in|leads to|when|while|thus|hence)\b/i;
/** Hedges and conditions that mark a sentence as stating an edge case. */
const QUALIFYING = /\b(unless|except|only|must|cannot|however|note that|provided|at least|at most|otherwise|but not)\b/i;
/** Markers of a concrete illustration. */
const EXEMPLIFYING = /\b(for example|for instance|such as|e\.g\.|consider|suppose|say)\b/i;
/** Markers of an ordered process. */
const SEQUENTIAL = /\b(first|second|third|then|next|finally|afterwards|step)\b/i;

export interface Sentence {
  text: string;
  /** The source unit this sentence came from — the citation token. */
  unitIdx: number;
  /** Position within the unit, used to restore reading order. */
  position: number;
}

/** A line that begins a new block rather than continuing the one above it. */
const BLOCK_START = /^\s*(?:[-*•>|]|#{1,6}\s|\d+[.)]\s)/;

/**
 * A line nothing may be joined onto, even though it carries no full stop.
 *
 * A heading is the case that matters: "# Normalisation" followed by the
 * paragraph beneath it is two things, and gluing them produces "Normalisation
 * Normalisation organises the columns…" — which then appears as a quiz option
 * whose leading word names its own topic and gives the answer away. List items
 * are deliberately absent, because a long bullet genuinely does wrap.
 */
const NEVER_CONTINUED = /^\s*(?:#{1,6}\s|[>|])/;

/**
 * Rejoins lines that a writer hard-wrapped inside a paragraph.
 *
 * Lecture notes are routinely wrapped at a column, so "A table is in first
 * normal\nform when every column holds a single atomic value" is one sentence
 * written across two lines. Treating each line as a sentence produced quotations
 * that began and ended mid-clause — "form when every column holds a single
 * atomic value and each row is uniquely." — and those fragments went on to
 * become recap bullets, quiz options and misconception clarifications.
 *
 * A line continues the previous one when the previous line does not end in
 * terminal punctuation and the line itself does not open a new block. A blank
 * line always separates, so paragraphs, headings, table rows and list items stay
 * apart. Structure is preserved; only the wrapping is undone.
 */
export function unwrapLines(text: string): string {
  const out: string[] = [];

  for (const raw of text.split(/\n/)) {
    const line = raw.trim();

    if (line.length === 0) {
      out.push("");
      continue;
    }

    const previous = out[out.length - 1];
    const continues =
      previous !== undefined &&
      previous.length > 0 &&
      !/[.!?:;]$/.test(previous) &&
      !NEVER_CONTINUED.test(previous) &&
      !BLOCK_START.test(raw);

    if (continues) {
      out[out.length - 1] = `${previous} ${line}`;
    } else {
      out.push(line);
    }
  }

  return out.join("\n");
}

/**
 * Splits text into sentences.
 *
 * Hard wrapping is undone first (see `unwrapLines`), then the text breaks on
 * terminal punctuation followed by whitespace and on the remaining line breaks,
 * so bullet lists and headings become separate sentences rather than one
 * run-on. Abbreviations are not special-cased: an over-split sentence is a
 * cosmetic flaw, while a merged one would produce a misleading quotation.
 */
export function splitSentences(text: string): string[] {
  return unwrapLines(text)
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.replace(/^[\s\-*•\d.)]+/, "").trim())
    .filter((sentence) => sentence.length > 0);
}

/** Lowercased alphanumeric tokens. */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/** Tokens that carry topical meaning: not stopwords, at least three characters. */
export function contentTerms(text: string): string[] {
  return tokenise(text).filter(
    (token) => token.length >= 3 && !STOPWORDS.has(token),
  );
}

/** How often each content term appears across the given texts. */
export function termFrequencies(texts: readonly string[]): Map<string, number> {
  const frequencies = new Map<string, number>();

  for (const text of texts) {
    for (const term of contentTerms(text)) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    }
  }

  return frequencies;
}

/**
 * The most frequent content terms, most frequent first.
 *
 * Ties break on the term itself so the list is a function of the text alone,
 * never of the order terms happened to be inserted.
 */
export function keyTerms(texts: readonly string[], limit: number): string[] {
  const frequencies = termFrequencies(texts);

  return [...frequencies.entries()]
    .sort((a, b) => {
      const byCount = b[1] - a[1];
      if (byCount !== 0) return byCount;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .slice(0, limit)
    .map(([term]) => term);
}

/** Which shaping a sentence lends itself to, used to match it to a profile. */
export interface SentenceShape {
  definitional: boolean;
  relational: boolean;
  qualifying: boolean;
  exemplifying: boolean;
  sequential: boolean;
}

export function shapeOf(sentence: string): SentenceShape {
  return {
    definitional: DEFINITIONAL.test(sentence),
    relational: RELATIONAL.test(sentence),
    qualifying: QUALIFYING.test(sentence),
    exemplifying: EXEMPLIFYING.test(sentence),
    sequential: SEQUENTIAL.test(sentence),
  };
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/** Trims to a word budget on a word boundary, adding no words of its own. */
export function truncateWords(text: string, limit: number): string {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= limit) return text.trim();

  return `${words.slice(0, limit).join(" ")}…`;
}

/** Trims to a character budget without cutting mid-word where avoidable. */
export function truncateChars(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;

  const cut = trimmed.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Ends a fragment with a full stop when it has no terminal punctuation.
 *
 * An ellipsis counts as terminal: text that `truncateWords` has already cut
 * short says so with "…", and appending a full stop after it ("….") reads as a
 * typo rather than as a sentence.
 */
export function asSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;

  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * FNV-1a, 32-bit.
 *
 * Used to order answer options so the correct one does not always land in the
 * same position. A hash rather than a shuffle because it is a pure function of
 * the option text: the same Quiz_Item always presents its options in the same
 * order, which randomisation could not guarantee.
 */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

/** Normalised form used to compare two pieces of text for equivalence. */
export function normalise(text: string): string {
  return tokenise(text).join(" ");
}

/** How many of `terms` appear in `text`, counted once each. */
export function overlapCount(terms: readonly string[], text: string): number {
  const present = new Set(contentTerms(text));
  return new Set(terms.filter((term) => present.has(term))).size;
}

/** Whether the text asserts a negative, used for the polarity comparison. */
export function negationCount(text: string): number {
  return tokenise(text).filter((token) => NEGATIONS.has(token)).length;
}

/** Distinct numbers mentioned, used to spot a numeric contradiction. */
export function numbersIn(text: string): string[] {
  return [...new Set(text.match(/\b\d+(?:\.\d+)?\b/g) ?? [])];
}
