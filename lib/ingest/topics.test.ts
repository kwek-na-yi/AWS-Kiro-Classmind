import { readFileSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { extractSourceText } from "@/lib/ingest/extract";
import {
  MAX_TOPICS,
  MAX_TOPIC_NAME_CHARS,
  MIN_TOPICS,
  deriveTopics,
} from "@/lib/ingest/topics";
import { segmentUnits } from "@/lib/ingest/units";
import type { SourceUnit } from "@/lib/types";

const FIXTURES = path.resolve(process.cwd(), "tests/fixtures");

function unit(index: number, text: string, ref: SourceUnit["ref"]): SourceUnit {
  return { materialVersion: 1, index, text, ref };
}

function sectionUnit(index: number, heading: string, text: string): SourceUnit {
  return unit(index, text, { kind: "section", value: `§ ${heading}` });
}

function pageUnit(index: number, page: number, text: string): SourceUnit {
  return unit(index, text, { kind: "page", value: `p. ${page}` });
}

async function unitsFromFixture(name: string, ext: string): Promise<SourceUnit[]> {
  const bytes = new Uint8Array(readFileSync(path.join(FIXTURES, name)));
  const extraction = await extractSourceText({ ext, bytes });
  if (!extraction.ok) throw new Error("fixture failed to extract");
  return segmentUnits(extraction.blocks, 1);
}

function expectWellFormed(topics: ReturnType<typeof deriveTopics>, units: SourceUnit[]) {
  const valid = new Set(units.map((u) => u.index));

  expect(topics.length).toBeGreaterThanOrEqual(MIN_TOPICS);
  expect(topics.length).toBeLessThanOrEqual(MAX_TOPICS);

  topics.forEach((topic, position) => {
    expect(topic.order).toBe(position);
    expect(topic.name.length).toBeGreaterThan(0);
    expect(topic.name.length).toBeLessThanOrEqual(MAX_TOPIC_NAME_CHARS);
    expect(topic.topicId).toMatch(/^[a-z0-9-]+$/);
    expect(topic.unitIdxs.length).toBeGreaterThanOrEqual(1);

    for (const index of topic.unitIdxs) {
      expect(valid.has(index)).toBe(true);
    }
  });

  expect(new Set(topics.map((t) => t.topicId)).size).toBe(topics.length);
}

describe("heading-derived topics", () => {
  it("names one topic per heading, in document order", () => {
    const units = [
      sectionUnit(0, "Normalisation", "First body."),
      sectionUnit(1, "Second Normal Form", "Second body."),
      sectionUnit(2, "Third Normal Form", "Third body."),
      sectionUnit(3, "Denormalisation", "Fourth body."),
    ];

    const topics = deriveTopics(units);

    expect(topics.map((topic) => topic.name)).toEqual([
      "Normalisation",
      "Second Normal Form",
      "Third Normal Form",
      "Denormalisation",
    ]);
    expect(topics.map((topic) => topic.topicId)).toEqual([
      "normalisation",
      "second-normal-form",
      "third-normal-form",
      "denormalisation",
    ]);
    expectWellFormed(topics, units);
  });

  it("attaches following prose units to the heading in force", () => {
    const units = [
      sectionUnit(0, "Alpha", "Alpha body."),
      pageUnit(1, 2, "Continued prose that carries no heading of its own, running on."),
      sectionUnit(2, "Beta", "Beta body."),
      sectionUnit(3, "Gamma", "Gamma body."),
    ];

    const topics = deriveTopics(units);

    expect(topics).toHaveLength(3);
    expect(topics[0].unitIdxs).toEqual([0, 1]);
  });

  it("merges a heading that repeats and keeps its first position", () => {
    const units = [
      sectionUnit(0, "Alpha", "One."),
      sectionUnit(1, "Beta", "Two."),
      sectionUnit(2, "Alpha", "Three."),
      sectionUnit(3, "Gamma", "Four."),
    ];

    const topics = deriveTopics(units);

    expect(topics.map((topic) => topic.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(topics[0].unitIdxs).toEqual([0, 2]);
  });

  it("treats the two halves of a split section as one topic", () => {
    const units = [
      unit(0, "First half.", { kind: "section", value: "§ Long Topic (a)" }),
      unit(1, "Second half.", { kind: "section", value: "§ Long Topic (b)" }),
      sectionUnit(2, "Beta", "Two."),
      sectionUnit(3, "Gamma", "Three."),
    ];

    const topics = deriveTopics(units);

    expect(topics.map((topic) => topic.name)).toEqual(["Long Topic", "Beta", "Gamma"]);
    expect(topics[0].unitIdxs).toEqual([0, 1]);
  });

  it("trims a long heading to the name budget on a word boundary", () => {
    const long =
      "An Extremely Long Section Heading About Relational Database Normalisation Practice";
    const units = [
      sectionUnit(0, long, "Body."),
      sectionUnit(1, "Beta", "Body."),
      sectionUnit(2, "Gamma", "Body."),
    ];

    const topics = deriveTopics(units);

    expect(topics[0].name.length).toBeLessThanOrEqual(MAX_TOPIC_NAME_CHARS);
    expect(topics[0].name).not.toMatch(/\s$/);
    expect(long.startsWith(topics[0].name)).toBe(true);
  });

  it("buckets more than eight headings down to eight, covering every unit", () => {
    const units = Array.from({ length: 20 }, (_, i) =>
      sectionUnit(i, `Heading ${i}`, `Body of section ${i}.`),
    );

    const topics = deriveTopics(units);

    expect(topics).toHaveLength(MAX_TOPICS);
    expectWellFormed(topics, units);

    const covered = topics.flatMap((topic) => topic.unitIdxs).sort((a, b) => a - b);
    expect(covered).toEqual(units.map((u) => u.index));
  });
});

describe("weak-heading fallback", () => {
  it("partitions by length when there are too few headings", () => {
    const units = Array.from({ length: 9 }, (_, i) =>
      pageUnit(
        i,
        i + 1,
        `This page is unbroken prose with no heading at all, part ${i}, and it simply runs on.`,
      ),
    );

    const topics = deriveTopics(units);

    expectWellFormed(topics, units);

    // Every unit lands in some topic, so no material is orphaned.
    const covered = new Set(topics.flatMap((topic) => topic.unitIdxs));
    expect(covered.size).toBe(units.length);
  });

  it("still returns the minimum when the document is a single unit", () => {
    const units = [
      pageUnit(
        0,
        1,
        "One long page of continuous prose. ".repeat(20) +
          "It has no headings anywhere, so structure must come from its length alone.",
      ),
    ];

    const topics = deriveTopics(units);

    expect(topics).toHaveLength(MIN_TOPICS);
    expectWellFormed(topics, units);
    expect(topics.every((topic) => topic.unitIdxs.includes(0))).toBe(true);
  });

  it("keeps names unique when parts open with the same words", () => {
    const units = Array.from({ length: 6 }, (_, i) =>
      pageUnit(i, i + 1, `Identical opening words for every part of this document, ${i}.`),
    );

    const topics = deriveTopics(units);

    expect(new Set(topics.map((topic) => topic.name)).size).toBe(topics.length);
    expectWellFormed(topics, units);
  });

  it("falls back to a positional name when a unit has no usable words", () => {
    const units = Array.from({ length: 4 }, (_, i) => pageUnit(i, i + 1, "--- ~~~ ---"));

    const topics = deriveTopics(units);

    expect(topics.length).toBeGreaterThanOrEqual(MIN_TOPICS);
    expect(topics.every((topic) => topic.name.length > 0)).toBe(true);
    expect(new Set(topics.map((t) => t.topicId)).size).toBe(topics.length);
  });

  it("returns nothing for an empty unit set", () => {
    expect(deriveTopics([])).toEqual([]);
  });
});

describe("determinism", () => {
  it("returns the same topics, in the same order, on repeated runs", () => {
    const units = [
      sectionUnit(0, "Alpha", "One."),
      sectionUnit(1, "Beta", "Two."),
      sectionUnit(2, "Gamma", "Three."),
      sectionUnit(3, "Delta", "Four."),
    ];

    expect(deriveTopics(units)).toEqual(deriveTopics(units));
  });

  it("holds its guarantees for arbitrary unit sets", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 300 }), {
          minLength: 1,
          maxLength: 25,
        }),
        (texts) => {
          const units = texts.map((text, i) => pageUnit(i, i + 1, text));
          const topics = deriveTopics(units);

          expect(topics.length).toBeGreaterThanOrEqual(MIN_TOPICS);
          expect(topics.length).toBeLessThanOrEqual(MAX_TOPICS);

          const valid = new Set(units.map((u) => u.index));
          for (const topic of topics) {
            expect(topic.unitIdxs.length).toBeGreaterThanOrEqual(1);
            expect(topic.unitIdxs.every((index) => valid.has(index))).toBe(true);
            expect(topic.topicId).toMatch(/^[a-z0-9-]+$/);
            expect(topic.topicId).not.toContain("#");
          }

          expect(new Set(topics.map((t) => t.topicId)).size).toBe(topics.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("makes no network call and reaches for no provider", () => {
    // Topic derivation is the Fallback_Mode path, so it must never depend on a
    // generation provider of any kind.
    const source = readFileSync(
      path.resolve(process.cwd(), "lib/ingest/topics.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/from\s+["']@aws-sdk/);
    expect(source).not.toMatch(/\bawait import\b/);
  });
});

describe("end to end over the fixtures", () => {
  it("derives topics from the Markdown lecture", async () => {
    const units = await unitsFromFixture("lecture-sample.md", "md");
    const topics = deriveTopics(units);

    expectWellFormed(topics, units);
    expect(topics.map((topic) => topic.name)).toContain("Database Normalisation");
    expect(topics.map((topic) => topic.name)).toContain("Denormalisation Trade-offs");
  });

  it("derives topics from the plain-text lecture", async () => {
    const units = await unitsFromFixture("lecture-sample.txt", "txt");
    const topics = deriveTopics(units);

    expectWellFormed(topics, units);
    expect(topics.map((topic) => topic.name)).toContain("DATABASE NORMALISATION");
  });

  it("derives topics from the PDF lecture", async () => {
    const units = await unitsFromFixture("lecture-sample.pdf", "pdf");
    const topics = deriveTopics(units);

    expectWellFormed(topics, units);
    expect(topics.map((topic) => topic.name)).toContain("Database Normalisation");
  });
});
