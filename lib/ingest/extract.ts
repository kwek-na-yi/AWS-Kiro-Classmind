import { validateMaterialExtension } from "@/lib/domain/validate-input";
import type { MaterialExtension } from "@/lib/types";

/**
 * Text extraction from an uploaded Lecture_Material.
 *
 * In-process parsing only — no OCR and no document-processing service. A PDF
 * without a text layer is rejected rather than recognised: a scanned page
 * simply yields too few characters and the caller marks the material
 * unprocessable.
 *
 * The output is *structured* text, not a single string, because the structure
 * is what later grounding depends on. Each block carries the location it came
 * from, which `lib/ingest/units.ts` turns into the `SourceRef` every generated
 * statement must cite.
 *
 * This module never throws for bad input. A corrupt file, an unknown extension
 * or an empty upload all come back as a typed failure result, so the confirm
 * handler can map the reason to an error code instead of a 500.
 */

/** Below this many extracted characters the material is treated as unprocessable. */
export const MIN_READABLE_CHARS = 200;

/** Lines per block when a TXT file has no usable headings. */
export const TXT_BLOCK_LINES = 40;

/**
 * One extracted region of the document, discriminated by the kind of location
 * that identifies it — the same three kinds a `SourceRef` can take.
 */
export type ExtractedBlock =
  | { kind: "page"; page: number; text: string }
  | { kind: "section"; heading: string; text: string }
  | { kind: "lines"; startLine: number; endLine: number; text: string };

export interface ExtractionSuccess {
  ok: true;
  blocks: ExtractedBlock[];
  /** Total characters extracted across every block. */
  charCount: number;
}

export type ExtractionFailureReason =
  | "unsupported_extension"
  | "empty_file"
  | "unreadable";

export interface ExtractionFailure {
  ok: false;
  reason: ExtractionFailureReason;
  message: string;
  charCount: 0;
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

export interface ExtractionInput {
  /** The declared file extension, with or without a leading dot. */
  ext: string;
  bytes: Uint8Array;
  filename?: string;
}

/**
 * Per-page plain text from a PDF, in page order.
 *
 * Injectable so tests can drive segmentation with fixed page text rather than
 * through a real PDF, and so the PDF library is loaded only when a PDF is
 * actually extracted.
 */
export type PdfPageExtractor = (bytes: Uint8Array) => Promise<string[]>;

export interface ExtractionDeps {
  extractPdfPages?: PdfPageExtractor;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/**
 * The default PDF reader: the pdf.js text layer, via `unpdf`.
 *
 * Imported dynamically so a TXT or Markdown upload never pays to load it, and
 * so a test that injects its own extractor never loads it at all.
 */
const defaultPdfExtractor: PdfPageExtractor = async (bytes) => {
  const { extractText, getDocumentProxy } = await import("unpdf");

  const document = await getDocumentProxy(bytes);
  const { text } = await extractText(document, { mergePages: false });

  return text;
};

async function extractPdf(
  bytes: Uint8Array,
  extractPages: PdfPageExtractor,
): Promise<ExtractionResult> {
  let pages: string[];

  try {
    pages = await extractPages(bytes);
  } catch {
    // A corrupt or password-protected PDF: a failure result, never a throw.
    return failure("unreadable", "This PDF could not be read.");
  }

  const blocks: ExtractedBlock[] = [];

  pages.forEach((raw, index) => {
    const text = normalise(raw);
    if (text.length === 0) return;
    blocks.push({ kind: "page", page: index + 1, text });
  });

  return success(blocks);
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** A top-level or second-level ATX heading. Deeper headings stay in their block. */
const MARKDOWN_HEADING = /^ {0,3}(#{1,2})\s+(.+?)\s*#*\s*$/;

/**
 * Markdown becomes one block per top-level or second-level heading.
 *
 * Content before the first heading is kept as its own block rather than
 * discarded — a lecture handout often opens with an unheaded paragraph, and
 * dropping it would lose text that a citation might need to point at. Its
 * heading is taken from its own first line.
 *
 * A Markdown file with no headings at all falls through to the line-block
 * strategy, which the requirements allow for Markdown as well as TXT.
 */
function extractMarkdown(text: string): ExtractionResult {
  const lines = normalise(text).split("\n");
  const hasHeading = lines.some((line) => MARKDOWN_HEADING.test(line));

  if (!hasHeading) return extractLineBlocks(lines);

  const blocks: ExtractedBlock[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const body = normalise(buffer.join("\n"));
    if (body.length === 0) return;

    blocks.push({
      kind: "section",
      heading: heading ?? headingFromText(body),
      // A blank line after the heading, as markdown itself would write it. The
      // heading is kept in the text so a search for the Topic name finds its own
      // section, but it is a separate paragraph: joined to the line below, the
      // pair reads as one run-on sentence that opens by naming its own Topic.
      text: heading === null ? body : `${heading}\n\n${body}`,
    });
  };

  for (const line of lines) {
    const match = MARKDOWN_HEADING.exec(line);

    if (match) {
      flush();
      heading = match[2].trim();
      buffer = [];
      continue;
    }

    buffer.push(line);
  }

  flush();

  return success(blocks);
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/**
 * Whether a line reads as a heading rather than as prose.
 *
 * Deliberately a small set of structural signals — no language processing. A
 * heading is short, is not a sentence, and stands apart from the text below it.
 * The cost of a wrong guess is only a block boundary in a different place: the
 * Source_Reference for TXT is a line range either way.
 */
function isHeadingLike(lines: string[], index: number): boolean {
  const trimmed = lines[index].trim();

  if (trimmed.length === 0 || trimmed.length > 80) return false;
  if (/[.,;:]$/.test(trimmed)) return false;
  if (!/[A-Za-z0-9]/.test(trimmed)) return false;

  // Must open a region: preceded by a blank line or the start of the file, with
  // some content still to come below it.
  const previous = lines[index - 1];
  const startsRegion = index === 0 || (previous?.trim().length ?? 0) === 0;
  const hasBodyBelow = lines.slice(index + 1).some((line) => line.trim().length > 0);
  if (!startsRegion || !hasBodyBelow) return false;

  const isAllCaps = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
  const isNumbered = /^(chapter|section|part|appendix)\s|^\d+([.)]\d*)*\s/i.test(
    trimmed,
  );

  // A short phrase counts only when a blank line separates it from the body.
  // Without that gap it is far more likely to be the first wrapped line of a
  // paragraph than a heading.
  const nextIsBlank = (lines[index + 1]?.trim().length ?? 0) === 0;
  const isSetOffPhrase = trimmed.split(/\s+/).length <= 8 && nextIsBlank;

  return isAllCaps || isNumbered || isSetOffPhrase;
}

/**
 * TXT becomes heading-delimited blocks when the file has usable headings, and
 * fixed 40-line blocks when it does not. Two headings are required before the
 * heading strategy is trusted — one match is as likely to be a stray short line
 * as a real structure.
 */
function extractText(text: string): ExtractionResult {
  const lines = normalise(text).split("\n");

  const headingIndexes = lines.reduce<number[]>((found, _line, index) => {
    if (isHeadingLike(lines, index)) found.push(index);
    return found;
  }, []);

  if (headingIndexes.length < 2) return extractLineBlocks(lines);

  const blocks: ExtractedBlock[] = [];
  const boundaries = headingIndexes[0] === 0 ? headingIndexes : [0, ...headingIndexes];

  boundaries.forEach((start, position) => {
    const end = (boundaries[position + 1] ?? lines.length) - 1;
    const body = normalise(lines.slice(start, end + 1).join("\n"));
    if (body.length === 0) return;

    blocks.push({
      kind: "lines",
      startLine: start + 1,
      endLine: end + 1,
      text: body,
    });
  });

  return success(blocks);
}

/** Fixed-size line blocks, the fallback when a file offers no structure. */
function extractLineBlocks(lines: string[]): ExtractionResult {
  const blocks: ExtractedBlock[] = [];

  for (let start = 0; start < lines.length; start += TXT_BLOCK_LINES) {
    const end = Math.min(start + TXT_BLOCK_LINES, lines.length);
    const body = normalise(lines.slice(start, end).join("\n"));
    if (body.length === 0) continue;

    blocks.push({ kind: "lines", startLine: start + 1, endLine: end, text: body });
  }

  return success(blocks);
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Normalises line endings and trims trailing whitespace, so the same document
 * uploaded from Windows and from macOS segments identically.
 */
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first non-empty line, trimmed — used to name an unheaded block. */
function headingFromText(text: string): string {
  const first = text.split("\n").find((line) => line.trim().length > 0) ?? "";
  return first.trim().slice(0, 80);
}

function success(blocks: ExtractedBlock[]): ExtractionResult {
  const charCount = blocks.reduce((total, block) => total + block.text.length, 0);
  return { ok: true, blocks, charCount };
}

function failure(
  reason: ExtractionFailureReason,
  message: string,
): ExtractionFailure {
  return { ok: false, reason, message, charCount: 0 };
}

function decodeUtf8(bytes: Uint8Array): string {
  // `fatal: false` replaces invalid sequences rather than throwing: a stray bad
  // byte in a lecture handout should not fail the whole upload.
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Extracts Source_Text from an uploaded file.
 *
 * PDF yields one block per page, Markdown one block per top-level or
 * second-level heading, and TXT heading-delimited or fixed 40-line blocks.
 */
export async function extractSourceText(
  input: ExtractionInput,
  deps: ExtractionDeps = {},
): Promise<ExtractionResult> {
  const ext = validateMaterialExtension(input.ext);
  if (!ext.ok) {
    return failure("unsupported_extension", ext.message);
  }

  if (input.bytes.byteLength === 0) {
    return failure("empty_file", "The uploaded file is empty.");
  }

  const extension: MaterialExtension = ext.value;

  if (extension === "pdf") {
    return extractPdf(input.bytes, deps.extractPdfPages ?? defaultPdfExtractor);
  }

  let text: string;
  try {
    text = decodeUtf8(input.bytes);
  } catch {
    return failure("unreadable", "This file could not be read as text.");
  }

  return extension === "md" || extension === "markdown"
    ? extractMarkdown(text)
    : extractText(text);
}

/**
 * Whether an extraction produced enough text to build a Recap and a Quiz_Pool
 * from. Below the floor the caller marks the material unprocessable — this is
 * the image-only-PDF path.
 */
export function isProcessable(result: ExtractionResult): boolean {
  return result.ok && result.charCount >= MIN_READABLE_CHARS;
}
