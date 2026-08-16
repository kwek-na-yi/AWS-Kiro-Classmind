import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ExtractedBlock } from "@/lib/ingest/extract";
import { MAX_UNIT_CHARS, segmentUnits } from "@/lib/ingest/units";

const page = (page: number, text: string): ExtractedBlock => ({
  kind: "page",
  page,
  text,
});

const section = (heading: string, text: string): ExtractedBlock => ({
  kind: "section",
  heading,
  text,
});

const lines = (startLine: number, endLine: number, text: string): ExtractedBlock => ({
  kind: "lines",
  startLine,
  endLine,
  text,
});

const paragraphs = (count: number, chars: number): string =>
  Array.from({ length: count }, (_, i) => `${String(i).padStart(2, "0")}${"x".repeat(chars - 2)}`).join(
    "\n\n",
  );

describe("source references", () => {
  it("gives a PDF page the page reference", () => {
    const [unit] = segmentUnits([page(7, "Some page text.")], 1);
    expect(unit.ref).toEqual({ kind: "page", value: "p. 7" });
  });

  it("gives a Markdown section the section reference", () => {
    const [unit] = segmentUnits([section("Normalisation", "Body text.")], 1);
    expect(unit.ref).toEqual({ kind: "section", value: "§ Normalisation" });
  });

  it("gives a text block its line range", () => {
    const [unit] = segmentUnits([lines(81, 120, "Body text.")], 1);
    expect(unit.ref).toEqual({ kind: "lines", value: "lines 81–120" });
  });

  it("uses the singular form for a one-line block", () => {
    const [unit] = segmentUnits([lines(5, 5, "One line.")], 1);
    expect(unit.ref).toEqual({ kind: "lines", value: "line 5" });
  });

  it("carries the material version onto every unit", () => {
    const units = segmentUnits([page(1, "a"), page(2, "b")], 4);
    expect(units.map((unit) => unit.materialVersion)).toEqual([4, 4]);
  });
});

describe("unit indexes", () => {
  it("numbers units sequentially from zero across all blocks", () => {
    const units = segmentUnits([page(1, "one"), page(2, "two"), page(3, "three")], 1);
    expect(units.map((unit) => unit.index)).toEqual([0, 1, 2]);
  });

  it("keeps numbering continuous across a block that splits", () => {
    // Six 400-character paragraphs pack two to a unit under the 1,200 cap, so
    // page 1 becomes three units and page 2 continues the numbering.
    const units = segmentUnits([page(1, paragraphs(6, 400)), page(2, "short")], 1);

    expect(units.map((unit) => unit.index)).toEqual([0, 1, 2, 3]);
    expect(units.at(-1)?.ref.value).toBe("p. 2");
  });

  it("skips blocks with no text", () => {
    const units = segmentUnits([page(1, ""), page(2, "content")], 1);
    expect(units).toHaveLength(1);
    expect(units[0].index).toBe(0);
  });
});

describe("unit boundaries", () => {
  it("keeps a block under the cap as a single unit", () => {
    const units = segmentUnits([page(1, "x".repeat(MAX_UNIT_CHARS))], 1);
    expect(units).toHaveLength(1);
  });

  it("splits an oversized page into lettered parts", () => {
    const units = segmentUnits([page(7, paragraphs(6, 400))], 1);

    expect(units.length).toBeGreaterThan(1);
    expect(units.map((unit) => unit.ref.value)).toEqual([
      "p. 7 (a)",
      "p. 7 (b)",
      "p. 7 (c)",
    ]);
  });

  it("splits an oversized section the same way", () => {
    const units = segmentUnits([section("Long Topic", paragraphs(9, 400))], 1);

    expect(units.map((unit) => unit.ref.value)).toEqual([
      "§ Long Topic (a)",
      "§ Long Topic (b)",
      "§ Long Topic (c)",
      "§ Long Topic (d)",
      "§ Long Topic (e)",
    ]);
  });

  it("splits a line block into real sub-ranges rather than letters", () => {
    const body = Array.from({ length: 40 }, (_, i) => `${i + 1}: ${"y".repeat(60)}`);
    const units = segmentUnits([lines(1, 40, body.join("\n"))], 1);

    expect(units.length).toBeGreaterThan(1);
    expect(units.every((unit) => !unit.ref.value.includes("("))).toBe(true);

    const ranges = units.map((unit) => unit.ref.value);
    expect(ranges[0]).toMatch(/^lines 1–\d+$/);

    // Sub-ranges are contiguous and cover the block exactly once.
    const numbers = ranges.map((value) => value.match(/(\d+)–(\d+)/)?.slice(1).map(Number) ?? []);
    expect(numbers[0][0]).toBe(1);
    expect(numbers.at(-1)?.[1]).toBe(40);
    for (let i = 1; i < numbers.length; i += 1) {
      expect(numbers[i][0]).toBe(numbers[i - 1][1] + 1);
    }
  });

  it("letters the pieces of a single line longer than the cap", () => {
    const units = segmentUnits([lines(9, 9, "z".repeat(MAX_UNIT_CHARS * 2 + 10))], 1);

    expect(units.map((unit) => unit.ref.value)).toEqual([
      "line 9 (a)",
      "line 9 (b)",
      "line 9 (c)",
    ]);
  });

  it("never exceeds the cap, whatever the input shape", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            page: fc.integer({ min: 1, max: 40 }),
            text: fc.string({ minLength: 0, maxLength: 5000 }),
          }),
          { maxLength: 6 },
        ),
        (blocks) => {
          const units = segmentUnits(
            blocks.map((block) => page(block.page, block.text)),
            1,
          );

          for (const unit of units) {
            expect(unit.text.length).toBeLessThanOrEqual(MAX_UNIT_CHARS);
            expect(unit.text.trim().length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("prefers a paragraph boundary to a mid-word cut", () => {
    const units = segmentUnits([page(1, paragraphs(4, 400))], 1);

    for (const unit of units) {
      expect(unit.text).not.toMatch(/^\s/);
      expect(unit.text).not.toMatch(/\s$/);
    }
  });
});

describe("determinism", () => {
  it("produces identical units on repeated runs", () => {
    const blocks = [
      page(1, paragraphs(5, 400)),
      section("A Section", "Some body."),
      lines(10, 20, "Text body over lines."),
    ];

    expect(segmentUnits(blocks, 2)).toEqual(segmentUnits(blocks, 2));
  });

  it("assigns every unit a unique index", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 3000 }), { maxLength: 8 }),
        (texts) => {
          const units = segmentUnits(
            texts.map((text, i) => page(i + 1, text)),
            1,
          );

          const indexes = units.map((unit) => unit.index);
          expect(new Set(indexes).size).toBe(indexes.length);
          expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
        },
      ),
      { numRuns: 60 },
    );
  });

  it("gives every unit of a block a distinct reference", () => {
    const units = segmentUnits(
      [page(1, paragraphs(9, 400)), section("S", paragraphs(9, 400))],
      1,
    );

    const values = units.map((unit) => unit.ref.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
