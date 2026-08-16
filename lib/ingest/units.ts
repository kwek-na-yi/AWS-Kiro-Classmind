import type { ExtractedBlock } from "@/lib/ingest/extract";
import type { SourceRef, SourceUnit } from "@/lib/types";

/**
 * Source-unit segmentation.
 *
 * Extracted blocks become numbered source units, each carrying the
 * `SourceRef` a citation resolves to. The unit index is the only citation token
 * the generation layer ever sees or returns: it cites an index, and the server
 * turns that index back into a reference, which is what makes a fabricated
 * citation impossible.
 *
 * The function is pure and deterministic — the same file always yields the same
 * unit indexes and the same references, on every run and on every machine.
 */

/**
 * The size a unit is capped at.
 *
 * Small enough that a citation points at something a Learner can actually find
 * on the page, large enough that a coherent explanation is not split mid-idea.
 */
export const MAX_UNIT_CHARS = 1200;

/** Separators tried in order when a block has to be split. */
const SEPARATORS = ["\n\n", "\n", " "] as const;

/**
 * Splits text to fit the cap, preferring the most meaningful boundary
 * available: paragraph, then line, then word, and only then a hard cut.
 */
function splitText(text: string, max: number, depth = 0): string[] {
  if (text.length <= max) return [text];

  const separator = SEPARATORS[depth];

  if (separator === undefined) {
    const slices: string[] = [];
    for (let start = 0; start < text.length; start += max) {
      slices.push(text.slice(start, start + max));
    }
    return slices;
  }

  const pieces = text.split(separator);
  if (pieces.length === 1) return splitText(text, max, depth + 1);

  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    const candidate = current === "" ? piece : current + separator + piece;

    if (candidate.length <= max) {
      current = candidate;
      continue;
    }

    if (current !== "") {
      chunks.push(current);
      current = "";
    }

    if (piece.length > max) {
      const sub = splitText(piece, max, depth + 1);
      chunks.push(...sub.slice(0, -1));
      current = sub[sub.length - 1] ?? "";
    } else {
      current = piece;
    }
  }

  if (current !== "") chunks.push(current);

  return chunks.filter((chunk) => chunk.trim().length > 0);
}

interface Chunk {
  text: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Splits a line-addressed block while tracking real line numbers, so each unit
 * keeps a reference a reader can follow rather than an opaque sub-label.
 */
function chunkLines(
  lines: string[],
  firstLine: number,
  lastLine: number,
  max: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let bufferStart = firstLine;

  const flush = (endLine: number) => {
    const text = buffer.join("\n").trim();
    if (text.length > 0) {
      chunks.push({ text, startLine: bufferStart, endLine });
    }
    buffer = [];
  };

  lines.forEach((line, offset) => {
    const lineNumber = firstLine + offset;
    const pending = [...buffer, line].join("\n");

    if (pending.length <= max) {
      if (buffer.length === 0) bufferStart = lineNumber;
      buffer.push(line);
      return;
    }

    if (buffer.length > 0) flush(lineNumber - 1);

    if (line.length > max) {
      // One line longer than the whole cap: split it, and let every piece keep
      // that line's number. The pieces collide on reference, so they are
      // lettered below.
      for (const piece of splitText(line, max)) {
        chunks.push({ text: piece, startLine: lineNumber, endLine: lineNumber });
      }
      bufferStart = lineNumber + 1;
      return;
    }

    bufferStart = lineNumber;
    buffer = [line];
  });

  // The final chunk closes at the block's declared last line, so a block whose
  // text holds fewer physical lines than its range still reports the range the
  // extractor gave it.
  flush(lastLine);

  return chunks;
}

/** `a`, `b`, … `z`, `aa`, `ab`, … for lettering split units. */
function letterLabel(index: number): string {
  let label = "";
  let n = index;

  do {
    label = String.fromCharCode(97 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);

  return label;
}

function refFor(block: ExtractedBlock, chunk: Chunk): SourceRef {
  switch (block.kind) {
    case "page":
      return { kind: "page", value: `p. ${block.page}` };
    case "section":
      return { kind: "section", value: `§ ${block.heading}` };
    case "lines": {
      const start = chunk.startLine ?? block.startLine;
      const end = chunk.endLine ?? block.endLine;
      return {
        kind: "lines",
        value: start === end ? `line ${start}` : `lines ${start}–${end}`,
      };
    }
  }
}

function chunkBlock(block: ExtractedBlock, max: number): Chunk[] {
  const chunks =
    block.kind === "lines"
      ? chunkLines(block.text.split("\n"), block.startLine, block.endLine, max)
      : splitText(block.text, max).map((text) => ({ text }));

  // An empty or whitespace-only block produces no unit at all: a unit that
  // cites a location holding no text would be an unresolvable citation.
  return chunks
    .map((chunk) => ({ ...chunk, text: chunk.text.trim() }))
    .filter((chunk) => chunk.text.length > 0);
}

/**
 * Turns extracted blocks into numbered source units.
 *
 * Indexes are assigned in document order and are stable for a given file. They
 * are stored zero-padded in the sort key, so a unit's lexicographic order in
 * DynamoDB matches its numeric order here.
 *
 * A page or section too large for one unit splits into `p. 7 (a)`, `p. 7 (b)`:
 * the reference cannot be subdivided any further, so the letter says which part
 * of it a citation means. A line-addressed block splits into real sub-ranges
 * instead, because there the reference *can* be narrowed.
 */
export function segmentUnits(
  blocks: readonly ExtractedBlock[],
  materialVersion: number,
  maxUnitChars: number = MAX_UNIT_CHARS,
): SourceUnit[] {
  const units: SourceUnit[] = [];
  let index = 0;

  for (const block of blocks) {
    const chunks = chunkBlock(block, maxUnitChars);
    const refs = chunks.map((chunk) => refFor(block, chunk));

    // Letter only the references that would otherwise be identical, so a block
    // that split into genuinely distinct line ranges keeps its plain reference.
    const counts = new Map<string, number>();
    for (const ref of refs) {
      counts.set(ref.value, (counts.get(ref.value) ?? 0) + 1);
    }

    const seen = new Map<string, number>();

    chunks.forEach((chunk, position) => {
      const ref = refs[position];
      let value = ref.value;

      if ((counts.get(ref.value) ?? 0) > 1) {
        const occurrence = seen.get(ref.value) ?? 0;
        seen.set(ref.value, occurrence + 1);
        value = `${ref.value} (${letterLabel(occurrence)})`;
      }

      units.push({
        materialVersion,
        index,
        text: chunk.text,
        ref: { kind: ref.kind, value },
      });

      index += 1;
    });
  }

  return units;
}
