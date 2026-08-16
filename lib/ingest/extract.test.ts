import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MIN_READABLE_CHARS,
  extractSourceText,
  isProcessable,
  type ExtractionResult,
} from "@/lib/ingest/extract";

/**
 * The PDF fixtures were generated with correct xref offsets; `lecture-sample.pdf`
 * carries three pages of text and `scanned-no-text.pdf` is a page of graphics
 * with no text layer, standing in for a scanned handout.
 */
const FIXTURES = path.resolve(process.cwd(), "tests/fixtures");

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)));
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function expectOk(result: ExtractionResult) {
  if (!result.ok) {
    throw new Error(`expected extraction to succeed, got ${result.reason}`);
  }
  return result;
}

describe("supported and unsupported file types", () => {
  it("accepts every extension in the supported set", async () => {
    for (const ext of ["txt", "md", "markdown"]) {
      const result = await extractSourceText({
        ext,
        bytes: bytesOf("Heading\n\nSome body text for the block."),
      });
      expect(result.ok).toBe(true);
    }
  });

  it("normalises a dotted, upper-case extension", async () => {
    const result = await extractSourceText({
      ext: ".TXT",
      bytes: bytesOf("Some text."),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unsupported extension without reading the bytes", async () => {
    const result = await extractSourceText({
      ext: "docx",
      bytes: bytesOf("anything"),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "unsupported_extension",
      charCount: 0,
    });
    if (!result.ok) expect(result.message).toContain("pdf");
  });
});

describe("empty and invalid input", () => {
  it("reports an empty upload rather than succeeding with nothing", async () => {
    const result = await extractSourceText({ ext: "txt", bytes: new Uint8Array() });
    expect(result).toMatchObject({ ok: false, reason: "empty_file" });
  });

  it("returns a failure result for a malformed PDF instead of throwing", async () => {
    const result = await extractSourceText({
      ext: "pdf",
      bytes: bytesOf("%PDF-1.4 this is not really a PDF"),
    });

    expect(result).toMatchObject({ ok: false, reason: "unreadable", charCount: 0 });
  });

  it("survives a PDF reader that throws", async () => {
    const result = await extractSourceText(
      { ext: "pdf", bytes: bytesOf("%PDF-1.4") },
      {
        extractPdfPages: () => {
          throw new Error("worker crashed");
        },
      },
    );

    expect(result).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("produces no blocks for whitespace-only text but does not throw", async () => {
    const result = expectOk(
      await extractSourceText({ ext: "txt", bytes: bytesOf("   \n\n  \t \n") }),
    );

    expect(result.blocks).toEqual([]);
    expect(result.charCount).toBe(0);
    expect(isProcessable(result)).toBe(false);
  });

  it("replaces invalid UTF-8 rather than failing the upload", async () => {
    const bytes = new Uint8Array([0x48, 0x69, 0xff, 0xfe, 0x21]);
    const result = expectOk(await extractSourceText({ ext: "txt", bytes }));

    expect(result.charCount).toBeGreaterThan(0);
  });
});

describe("PDF extraction", () => {
  it("returns one block per page, in page order", async () => {
    const result = expectOk(
      await extractSourceText({ ext: "pdf", bytes: fixture("lecture-sample.pdf") }),
    );

    expect(result.blocks).toHaveLength(3);
    expect(result.blocks.map((block) => block.kind)).toEqual([
      "page",
      "page",
      "page",
    ]);
    expect(result.blocks.map((block) => (block.kind === "page" ? block.page : 0))).toEqual(
      [1, 2, 3],
    );
    expect(result.blocks[0].text).toContain("Database Normalisation");
    expect(result.blocks[2].text).toContain("Denormalisation");
  });

  it("counts every extracted character", async () => {
    const result = expectOk(
      await extractSourceText({ ext: "pdf", bytes: fixture("lecture-sample.pdf") }),
    );

    const summed = result.blocks.reduce((total, block) => total + block.text.length, 0);
    expect(result.charCount).toBe(summed);
    expect(isProcessable(result)).toBe(true);
  });

  it("yields fewer than 200 characters for an image-only PDF", async () => {
    const result = expectOk(
      await extractSourceText({ ext: "pdf", bytes: fixture("scanned-no-text.pdf") }),
    );

    // The caller treats this as unprocessable — rejection, not OCR.
    expect(result.charCount).toBeLessThan(MIN_READABLE_CHARS);
    expect(isProcessable(result)).toBe(false);
  });

  it("drops pages that carry no text", async () => {
    const result = expectOk(
      await extractSourceText(
        { ext: "pdf", bytes: bytesOf("%PDF-1.4") },
        { extractPdfPages: async () => ["First page.", "   ", "Third page."] },
      ),
    );

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks.map((b) => (b.kind === "page" ? b.page : 0))).toEqual([1, 3]);
  });
});

describe("Markdown extraction", () => {
  it("returns one block per top-level and second-level heading", async () => {
    const result = expectOk(
      await extractSourceText({ ext: "md", bytes: fixture("lecture-sample.md") }),
    );

    const headings = result.blocks.map((block) =>
      block.kind === "section" ? block.heading : null,
    );

    expect(headings).toEqual([
      "Introductory notes for the relational modelling lecture, written before the",
      "Database Normalisation",
      "Second Normal Form",
      "Third Normal Form",
      "Denormalisation Trade-offs",
    ]);
  });

  it("keeps a third-level heading inside its parent block", async () => {
    const result = expectOk(
      await extractSourceText({ ext: "md", bytes: fixture("lecture-sample.md") }),
    );

    const secondNormalForm = result.blocks.find(
      (block) => block.kind === "section" && block.heading === "Second Normal Form",
    );

    expect(secondNormalForm?.text).toContain("### Worked example");
  });

  it("falls back to line blocks when a Markdown file has no headings", async () => {
    const result = expectOk(
      await extractSourceText({
        ext: "markdown",
        bytes: bytesOf("Just prose.\n\nMore prose with no heading anywhere."),
      }),
    );

    expect(result.blocks.every((block) => block.kind === "lines")).toBe(true);
  });
});

describe("plain text extraction", () => {
  it("splits on heading-like lines when the file has them", async () => {
    const result = expectOk(
      await extractSourceText({ ext: "txt", bytes: fixture("lecture-sample.txt") }),
    );

    expect(result.blocks).toHaveLength(4);
    expect(result.blocks.every((block) => block.kind === "lines")).toBe(true);
    expect(result.blocks[0].text).toContain("DATABASE NORMALISATION");
    expect(result.blocks[3].text).toContain("DENORMALISATION TRADE-OFFS");
  });

  it("reports line ranges that follow one another without gaps", async () => {
    const result = expectOk(
      await extractSourceText({ ext: "txt", bytes: fixture("lecture-sample.txt") }),
    );

    const ranges = result.blocks.map((block) =>
      block.kind === "lines" ? [block.startLine, block.endLine] : [0, 0],
    );

    expect(ranges[0][0]).toBe(1);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i][0]).toBe(ranges[i - 1][1] + 1);
    }
  });

  it("falls back to fixed 40-line blocks when no headings are present", async () => {
    const lines = Array.from({ length: 95 }, (_, i) => `Body line number ${i + 1}.`);

    const result = expectOk(
      await extractSourceText({ ext: "txt", bytes: bytesOf(lines.join("\n")) }),
    );

    expect(result.blocks.map((b) => (b.kind === "lines" ? [b.startLine, b.endLine] : []))).toEqual(
      [
        [1, 40],
        [41, 80],
        [81, 95],
      ],
    );
  });

  it("does not trust a single heading-like line", async () => {
    const text = ["Introduction", "", ...Array.from({ length: 50 }, () => "Prose line.")].join(
      "\n",
    );

    const result = expectOk(await extractSourceText({ ext: "txt", bytes: bytesOf(text) }));

    // One candidate heading is not structure: the 40-line fallback applies.
    expect(result.blocks[0].kind === "lines" && result.blocks[0].endLine).toBe(40);
  });
});

describe("determinism", () => {
  it("produces identical output for the same input", async () => {
    const bytes = fixture("lecture-sample.txt");

    const first = await extractSourceText({ ext: "txt", bytes });
    const second = await extractSourceText({ ext: "txt", bytes });

    expect(first).toEqual(second);
  });

  it("treats CRLF and LF input identically", async () => {
    const text = fixture("lecture-sample.txt");
    const asString = new TextDecoder().decode(text);

    const lf = await extractSourceText({ ext: "txt", bytes: bytesOf(asString) });
    const crlf = await extractSourceText({
      ext: "txt",
      bytes: bytesOf(asString.replace(/\n/g, "\r\n")),
    });

    expect(crlf).toEqual(lf);
  });
});
