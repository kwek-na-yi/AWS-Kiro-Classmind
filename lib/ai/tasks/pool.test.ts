import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { QuizItemOutput, QuizOptionOutput } from "@/lib/ai/provider";
import { countByDifficulty, validateQuizPool } from "@/lib/ai/tasks/pool";
import type { DifficultyLevel, SourceUnit, Topic } from "@/lib/types";

const UNITS: SourceUnit[] = [0, 1, 2].map((index) => ({
  materialVersion: 1,
  index,
  text: `Unit ${index} text.`,
  ref: { kind: "page", value: `p. ${index + 1}` },
}));

const TOPICS: Topic[] = [
  { topicId: "alpha", materialVersion: 1, order: 0, name: "Alpha", unitIdxs: [0, 1] },
  { topicId: "beta", materialVersion: 1, order: 1, name: "Beta", unitIdxs: [2] },
];

function options(overrides: Partial<QuizOptionOutput>[] = []): QuizOptionOutput[] {
  const base: QuizOptionOutput[] = [
    { text: "Correct answer", isCorrect: true, misconceptionLabel: null },
    { text: "Wrong one", isCorrect: false, misconceptionLabel: "Believes one" },
    { text: "Wrong two", isCorrect: false, misconceptionLabel: "Believes two" },
    { text: "Wrong three", isCorrect: false, misconceptionLabel: "Believes three" },
  ];

  return base.map((option, index) => ({ ...option, ...overrides[index] }));
}

function item(overrides: Partial<QuizItemOutput> = {}): QuizItemOutput {
  return {
    topicId: "alpha",
    difficulty: 1,
    stem: "Which statement about Alpha does the material make?",
    options: options(),
    unitIdx: 0,
    ...overrides,
  };
}

function validate(items: QuizItemOutput[], existingItemIds?: string[]) {
  return validateQuizPool({
    materialVersion: 1,
    topics: TOPICS,
    units: UNITS,
    output: { items },
    existingItemIds,
  });
}

describe("retaining a well-formed item", () => {
  it("keeps it and resolves its Source_Reference", () => {
    const result = validate([item()]);

    expect(result.discarded).toEqual([]);
    expect(result.items).toHaveLength(1);

    const [retained] = result.items;
    expect(retained.sourceRef).toEqual({ kind: "page", value: "p. 1" });
    expect(retained.materialVersion).toBe(1);
    expect(retained.options).toHaveLength(4);
    expect(retained.options.filter((option) => option.isCorrect)).toHaveLength(1);
  });

  it("assigns option ids by position and labels only the distractors", () => {
    const [retained] = validate([item()]).items;

    expect(retained.options.map((option) => option.optionId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);

    for (const option of retained.options) {
      if (option.isCorrect) {
        expect(option.misconceptionLabel).toBeUndefined();
      } else {
        expect(option.misconceptionLabel).toBeTruthy();
      }
    }
  });

  it("derives a stable id from the item's own content", () => {
    const first = validate([item()]).items[0].quizItemId;
    const second = validate([item()]).items[0].quizItemId;

    expect(second).toBe(first);
    expect(first).toMatch(/^alpha-d1-[0-9a-f]{8}$/);
    // The id lands in a sort key, which cannot contain the separator.
    expect(first).not.toContain("#");
  });

  it("gives different questions different ids", () => {
    const result = validate([
      item(),
      item({ stem: "A different question about Alpha?" }),
    ]);

    expect(result.items).toHaveLength(2);
    expect(result.items[0].quizItemId).not.toBe(result.items[1].quizItemId);
  });
});

describe("discarding malformed items", () => {
  const cases: [string, QuizItemOutput, string][] = [
    ["three options", item({ options: options().slice(0, 3) }), "option_count"],
    [
      "five options",
      item({
        options: [
          ...options(),
          { text: "Extra", isCorrect: false, misconceptionLabel: "Extra belief" },
        ],
      }),
      "option_count",
    ],
    [
      "no correct option",
      item({ options: options([{ isCorrect: false, misconceptionLabel: "Belief" }]) }),
      "correct_count",
    ],
    [
      "two correct options",
      item({ options: options([{}, { isCorrect: true }]) }),
      "correct_count",
    ],
    ["an unknown Topic", item({ topicId: "ghost" }), "unknown_topic"],
    ["an out-of-range unit", item({ unitIdx: 99 }), "unresolvable_unit"],
    [
      "an invalid difficulty",
      item({ difficulty: 4 as DifficultyLevel }),
      "invalid_difficulty",
    ],
    ["an empty stem", item({ stem: "   " }), "empty_stem"],
    ["an empty option", item({ options: options([{ text: "  " }]) }), "empty_option"],
    [
      "two identical options",
      item({ options: options([{}, { text: "Correct answer" }]) }),
      "duplicate_option",
    ],
    [
      "a distractor with no misconception label",
      item({ options: options([{}, { misconceptionLabel: "" }]) }),
      "missing_misconception_label",
    ],
    [
      "a distractor with a whitespace label",
      item({ options: options([{}, { misconceptionLabel: "   " }]) }),
      "missing_misconception_label",
    ],
  ];

  for (const [description, malformed, reason] of cases) {
    it(`rejects ${description}`, () => {
      const result = validate([malformed]);

      expect(result.items).toEqual([]);
      expect(result.discarded).toHaveLength(1);
      expect(result.discarded[0].reason).toBe(reason);
    });
  }

  it("keeps the good items from a mixed batch", () => {
    const result = validate([
      item(),
      item({ topicId: "ghost", stem: "Bad topic question?" }),
      item({ topicId: "beta", unitIdx: 2, stem: "A question about Beta?" }),
    ]);

    expect(result.items).toHaveLength(2);
    expect(result.discarded).toHaveLength(1);
    expect(result.items.map((entry) => entry.topicId)).toEqual(["alpha", "beta"]);
  });

  it("survives structurally broken payloads without throwing", () => {
    const broken = [
      undefined,
      null,
      {},
      { topicId: "alpha" },
      { topicId: "alpha", difficulty: 1, stem: "x", options: "not an array", unitIdx: 0 },
    ] as unknown as QuizItemOutput[];

    const result = validate(broken);

    expect(result.items).toEqual([]);
    expect(result.discarded).toHaveLength(broken.length);
  });

  it("handles a missing output object", () => {
    const result = validateQuizPool({
      materialVersion: 1,
      topics: TOPICS,
      units: UNITS,
      output: undefined as never,
    });

    expect(result.items).toEqual([]);
    expect(result.countsByDifficulty).toEqual({ 1: 0, 2: 0, 3: 0 });
  });
});

describe("duplicates", () => {
  it("keeps the first of two identical items", () => {
    const result = validate([item(), item()]);

    expect(result.items).toHaveLength(1);
    expect(result.discarded.map((entry) => entry.reason)).toEqual(["duplicate_item"]);
  });

  it("treats a stem differing only in case or spacing as a duplicate", () => {
    const result = validate([
      item(),
      item({ stem: "  WHICH statement about Alpha does the material make?  " }),
    ]);

    expect(result.items).toHaveLength(1);
  });

  it("does not re-add an item already persisted", () => {
    const existing = validate([item()]).items[0].quizItemId;
    const result = validate([item()], [existing]);

    expect(result.items).toEqual([]);
    expect(result.discarded[0].reason).toBe("duplicate_item");
  });

  it("distinguishes the same stem at another difficulty", () => {
    const result = validate([item(), item({ difficulty: 2 })]);

    expect(result.items).toHaveLength(2);
  });
});

describe("counting", () => {
  it("counts retained items by difficulty", () => {
    const result = validate([
      item(),
      item({ difficulty: 2, stem: "Question two?" }),
      item({ difficulty: 2, stem: "Question three?" }),
      item({ difficulty: 3, stem: "Question four?" }),
    ]);

    expect(result.countsByDifficulty).toEqual({ 1: 1, 2: 2, 3: 1 });
    expect(countByDifficulty(result.items)).toEqual(result.countsByDifficulty);
  });
});

describe("every retained item satisfies the engine's assumptions", () => {
  it("holds for arbitrary generated payloads", () => {
    const optionArb = fc.record({
      text: fc.string({ maxLength: 20 }),
      isCorrect: fc.boolean(),
      misconceptionLabel: fc.oneof(fc.constant(null), fc.string({ maxLength: 12 })),
    });

    const itemArb = fc.record({
      topicId: fc.constantFrom("alpha", "beta", "ghost"),
      difficulty: fc.constantFrom(1, 2, 3, 4, 0),
      stem: fc.string({ maxLength: 30 }),
      options: fc.array(optionArb, { minLength: 0, maxLength: 6 }),
      unitIdx: fc.integer({ min: -5, max: 20 }),
    });

    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 12 }), (items) => {
        const result = validate(items as QuizItemOutput[]);
        const topicIds = new Set(TOPICS.map((topic) => topic.topicId));
        const unitIdxs = new Set(UNITS.map((unit) => unit.index));

        for (const retained of result.items) {
          expect(retained.options).toHaveLength(4);
          expect(retained.options.filter((option) => option.isCorrect)).toHaveLength(1);
          expect(topicIds.has(retained.topicId)).toBe(true);
          expect(unitIdxs.has(retained.unitIdx)).toBe(true);
          expect([1, 2, 3]).toContain(retained.difficulty);
          expect(retained.sourceRef.value.length).toBeGreaterThan(0);
          expect(retained.stem.trim()).toBe(retained.stem);

          for (const option of retained.options) {
            if (!option.isCorrect) {
              expect((option.misconceptionLabel ?? "").length).toBeGreaterThan(0);
            }
          }
        }

        // Ids are unique within a validated pool.
        const ids = result.items.map((retained) => retained.quizItemId);
        expect(new Set(ids).size).toBe(ids.length);
      }),
    );
  });
});
