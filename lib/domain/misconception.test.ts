import { readFileSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  MAX_CANDIDATES,
  MIN_SELECTION_COUNT,
  MIN_SHARE_PERCENT,
  selectCandidates,
  tallyQuizItem,
  type SelectionResponse,
  type TalliedQuizItem,
} from "@/lib/domain/misconception";
import type { AnswerOption } from "@/lib/types";

/** Four Answer_Options: `a` correct, `b`/`c`/`d` labelled Distractors. */
function options(): AnswerOption[] {
  return [
    { optionId: "a", text: "Correct", isCorrect: true },
    { optionId: "b", text: "Wrong b", isCorrect: false, misconceptionLabel: "Belief B" },
    { optionId: "c", text: "Wrong c", isCorrect: false, misconceptionLabel: "Belief C" },
    { optionId: "d", text: "Wrong d", isCorrect: false, misconceptionLabel: "Belief D" },
  ];
}

function quizItem(quizItemId: string, topicId = "t1"): TalliedQuizItem {
  return { quizItemId, topicId, options: options() };
}

/**
 * Responses to one Quiz_Item, one per Learner: `picks` lists the option each
 * distinct Learner chose.
 */
function picks(quizItemId: string, chosen: string[]): SelectionResponse[] {
  return chosen.map((optionId, i) => ({
    quizItemId,
    optionId,
    learnerId: `l${i}`,
  }));
}

const TOPIC_NAMES = new Map([
  ["t1", "Normalisation"],
  ["t2", "Indexing"],
  ["t3", "Transactions"],
]);

describe("tallying a Quiz_Item", () => {
  it("counts every response, including correct ones, in the denominator", () => {
    const tally = tallyQuizItem(quizItem("q1"), picks("q1", ["a", "a", "b", "b"]));

    expect(tally.itemResponses).toBe(4);
    expect(tally.distinctLearners).toBe(4);
    expect(tally.byOption.get("a")).toBe(2);
    expect(tally.byOption.get("b")).toBe(2);
  });

  it("ignores responses belonging to another Quiz_Item", () => {
    const responses = [...picks("q1", ["b", "b"]), ...picks("q2", ["c", "c", "c"])];

    expect(tallyQuizItem(quizItem("q1"), responses).itemResponses).toBe(2);
  });

  it("reports an unserved Quiz_Item as empty", () => {
    const tally = tallyQuizItem(quizItem("q1"), []);

    expect(tally).toMatchObject({ itemResponses: 0, distinctLearners: 0 });
    expect(tally.byOption.size).toBe(0);
  });
});

describe("thresholds", () => {
  it("qualifies a Distractor at exactly the minimums", () => {
    // 2 of 5 selections is 40 percent, with 5 distinct Learners.
    const candidates = selectCandidates(
      [quizItem("q1")],
      picks("q1", ["b", "b", "a", "a", "a"]),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      optionId: "b",
      selCount: 2,
      itemResponses: 5,
      share: 40,
      misconceptionLabel: "Belief B",
    });
  });

  it("qualifies at exactly 30 percent", () => {
    // 3 of 10 is exactly 30.
    const chosen = ["b", "b", "b", "a", "a", "a", "a", "a", "a", "a"];
    const candidates = selectCandidates([quizItem("q1")], picks("q1", chosen));

    expect(candidates[0]).toMatchObject({ share: MIN_SHARE_PERCENT, selCount: 3 });
  });

  it("rejects a share just below 30 percent", () => {
    // 3 of 11 is 27 percent.
    const chosen = ["b", "b", "b", ...Array(8).fill("a")];
    expect(selectCandidates([quizItem("q1")], picks("q1", chosen))).toEqual([]);
  });

  it("rejects a single selection however large its share", () => {
    // 1 of 3 is 33 percent, but only one Learner chose it.
    const candidates = selectCandidates([quizItem("q1")], picks("q1", ["b", "a", "a"]));

    expect(candidates).toEqual([]);
    expect(MIN_SELECTION_COUNT).toBe(2);
  });

  it("rejects an item answered by fewer than three distinct Learners", () => {
    const responses: SelectionResponse[] = [
      { quizItemId: "q1", optionId: "b", learnerId: "l1" },
      { quizItemId: "q1", optionId: "b", learnerId: "l1" },
      { quizItemId: "q1", optionId: "b", learnerId: "l2" },
    ];

    expect(selectCandidates([quizItem("q1")], responses)).toEqual([]);
  });

  it("publishes the same item once a third Learner answers", () => {
    const responses: SelectionResponse[] = [
      { quizItemId: "q1", optionId: "b", learnerId: "l1" },
      { quizItemId: "q1", optionId: "b", learnerId: "l2" },
      { quizItemId: "q1", optionId: "a", learnerId: "l3" },
    ];

    expect(selectCandidates([quizItem("q1")], responses)).toHaveLength(1);
  });

  it("never treats the correct Answer_Option as a misconception", () => {
    const candidates = selectCandidates([quizItem("q1")], picks("q1", ["a", "a", "a", "a"]));
    expect(candidates).toEqual([]);
  });

  it("skips a Distractor carrying no Misconception_Label", () => {
    const item: TalliedQuizItem = {
      quizItemId: "q1",
      topicId: "t1",
      options: [
        { optionId: "a", text: "Correct", isCorrect: true },
        { optionId: "b", text: "Unlabelled", isCorrect: false },
        { optionId: "c", text: "Blank", isCorrect: false, misconceptionLabel: "  " },
      ],
    };

    expect(selectCandidates([item], picks("q1", ["b", "b", "b", "c", "c"]))).toEqual([]);
  });

  it("returns nothing for an unserved Quiz_Item or an empty pool", () => {
    expect(selectCandidates([quizItem("q1")], [])).toEqual([]);
    expect(selectCandidates([], picks("q1", ["b", "b", "b"]))).toEqual([]);
  });
});

describe("one candidate per Quiz_Item", () => {
  it("keeps only the strongest Distractor of an item", () => {
    // b chosen 4 of 10 (40%), c chosen 3 of 10 (30%) — both qualify.
    const chosen = ["b", "b", "b", "b", "c", "c", "c", "a", "a", "a"];
    const candidates = selectCandidates([quizItem("q1")], picks("q1", chosen));

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ optionId: "b", share: 40 });
  });

  it("breaks a share tie inside an item by the lower option id", () => {
    // b and c both chosen 3 of 9.
    const chosen = ["b", "b", "b", "c", "c", "c", "a", "a", "a"];
    const candidates = selectCandidates([quizItem("q1")], picks("q1", chosen));

    expect(candidates[0].optionId).toBe("b");
  });
});

describe("ranking and cap", () => {
  it("ranks by descending share", () => {
    const items = [quizItem("q1", "t1"), quizItem("q2", "t2"), quizItem("q3", "t3")];
    const responses = [
      ...picks("q1", ["b", "b", "a", "a"]), // 50%
      ...picks("q2", ["b", "b", "b", "a"]), // 75%
      ...picks("q3", ["b", "b", "a", "a", "a"]), // 40%
    ];

    const candidates = selectCandidates(items, responses, { topicNames: TOPIC_NAMES });

    expect(candidates.map((candidate) => candidate.quizItemId)).toEqual([
      "q2",
      "q1",
      "q3",
    ]);
    expect(candidates.map((candidate) => candidate.share)).toEqual([75, 50, 40]);
  });

  it("breaks a share tie by the larger selecting count", () => {
    const items = [quizItem("q1", "t1"), quizItem("q2", "t2")];
    const responses = [
      ...picks("q1", ["b", "b", "a", "a"]), // 2 of 4 = 50%
      ...picks("q2", ["b", "b", "b", "a", "a", "a"]), // 3 of 6 = 50%
    ];

    const candidates = selectCandidates(items, responses, { topicNames: TOPIC_NAMES });

    expect(candidates.map((candidate) => candidate.quizItemId)).toEqual(["q2", "q1"]);
  });

  it("breaks a remaining tie by case-insensitive Topic name, then item id", () => {
    const items = [quizItem("q2", "zebra"), quizItem("q1", "alpha")];
    const responses = [...picks("q1", ["b", "b", "a", "a"]), ...picks("q2", ["b", "b", "a", "a"])];

    const names = new Map([
      ["zebra", "Zebra Topic"],
      ["alpha", "alpha topic"],
    ]);

    const candidates = selectCandidates(items, responses, { topicNames: names });
    expect(candidates.map((candidate) => candidate.topicId)).toEqual(["alpha", "zebra"]);
  });

  it("caps the Class_Session at three misconceptions", () => {
    const items = Array.from({ length: 6 }, (_, i) => quizItem(`q${i}`, `t${i}`));
    const responses = items.flatMap((item) => picks(item.quizItemId, ["b", "b", "b", "a"]));

    const candidates = selectCandidates(items, responses);

    expect(candidates).toHaveLength(MAX_CANDIDATES);
    expect(MAX_CANDIDATES).toBe(3);
  });

  it("keeps the three highest-ranked when more qualify", () => {
    const items = Array.from({ length: 5 }, (_, i) => quizItem(`q${i}`, `t${i}`));
    const shares = [
      ["b", "b", "a", "a"], // 50%
      ["b", "b", "b", "a"], // 75%
      ["b", "b", "a", "a", "a"], // 40%
      ["b", "b", "b", "b", "a"], // 80%
      ["b", "b", "b", "a", "a", "a"], // 50%
    ];
    const responses = items.flatMap((item, i) => picks(item.quizItemId, shares[i]));

    const candidates = selectCandidates(items, responses);

    expect(candidates.map((candidate) => candidate.share)).toEqual([80, 75, 50]);
  });
});

describe("Property 17: threshold correctness", () => {
  it("selects a Distractor exactly when it meets both thresholds", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("a", "b", "c", "d"), { minLength: 3, maxLength: 15 }),
        (chosen) => {
          const responses = picks("q1", chosen);
          const item = quizItem("q1");
          const tally = tallyQuizItem(item, responses);

          const qualifying = ["b", "c", "d"].filter((optionId) => {
            const count = tally.byOption.get(optionId) ?? 0;
            const share = Math.round((100 * count) / tally.itemResponses);
            return count >= MIN_SELECTION_COUNT && share >= MIN_SHARE_PERCENT;
          });

          const candidates = selectCandidates([item], responses);

          // At most one candidate per item, and one exists precisely when some
          // Distractor cleared both thresholds.
          expect(candidates.length).toBe(qualifying.length > 0 ? 1 : 0);

          for (const candidate of candidates) {
            expect(candidate.selCount).toBeGreaterThanOrEqual(MIN_SELECTION_COUNT);
            expect(candidate.share).toBeGreaterThanOrEqual(MIN_SHARE_PERCENT);
            expect(qualifying).toContain(candidate.optionId);
          }
        },
      ),
    );
  });
});

describe("Property 18: ranking and cap", () => {
  it("returns at most three, in non-increasing share order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(fc.constantFrom("a", "b", "c", "d"), { minLength: 3, maxLength: 10 }),
          { minLength: 1, maxLength: 8 },
        ),
        (perItem) => {
          const items = perItem.map((_, i) => quizItem(`q${i}`, `t${i % 3}`));
          const responses = perItem.flatMap((chosen, i) => picks(`q${i}`, chosen));

          const candidates = selectCandidates(items, responses, {
            topicNames: TOPIC_NAMES,
          });

          expect(candidates.length).toBeLessThanOrEqual(MAX_CANDIDATES);

          for (let i = 1; i < candidates.length; i += 1) {
            expect(candidates[i].share).toBeLessThanOrEqual(candidates[i - 1].share);
          }

          // No Quiz_Item appears twice.
          const ids = candidates.map((candidate) => candidate.quizItemId);
          expect(new Set(ids).size).toBe(ids.length);
        },
      ),
    );
  });

  it("retains the highest-ranked candidates that qualified", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(fc.constantFrom("a", "b", "c", "d"), { minLength: 4, maxLength: 8 }),
          { minLength: 4, maxLength: 8 },
        ),
        (perItem) => {
          const items = perItem.map((_, i) => quizItem(`q${i}`, `t${i % 3}`));
          const responses = perItem.flatMap((chosen, i) => picks(`q${i}`, chosen));

          const all = items.flatMap((item) =>
            selectCandidates([item], responses, { topicNames: TOPIC_NAMES }),
          );
          const kept = selectCandidates(items, responses, { topicNames: TOPIC_NAMES });

          if (all.length === 0) {
            expect(kept).toEqual([]);
            return;
          }

          const highestShare = Math.max(...all.map((candidate) => candidate.share));
          expect(kept[0].share).toBe(highestShare);
          expect(kept.length).toBe(Math.min(all.length, MAX_CANDIDATES));
        },
      ),
    );
  });
});

describe("Property 19: selection conservation", () => {
  it("sums option selections to the item's response count", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("a", "b", "c", "d"), { maxLength: 20 }),
        (chosen) => {
          const responses = picks("q1", chosen);
          const tally = tallyQuizItem(quizItem("q1"), responses);

          const summed = [...tally.byOption.values()].reduce(
            (total, count) => total + count,
            0,
          );

          expect(summed).toBe(tally.itemResponses);
          expect(tally.itemResponses).toBe(chosen.length);
        },
      ),
    );
  });

  it("keeps every share within 0 to 100", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("a", "b", "c", "d"), { minLength: 3, maxLength: 20 }),
        (chosen) => {
          for (const candidate of selectCandidates([quizItem("q1")], picks("q1", chosen))) {
            expect(candidate.share).toBeGreaterThanOrEqual(0);
            expect(candidate.share).toBeLessThanOrEqual(100);
            expect(candidate.selCount).toBeLessThanOrEqual(candidate.itemResponses);
          }
        },
      ),
    );
  });
});

describe("determinism", () => {
  it("is unchanged by a permutation of the responses", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(fc.constantFrom("a", "b", "c", "d"), { minLength: 3, maxLength: 8 }),
          { minLength: 1, maxLength: 6 },
        ),
        (perItem) => {
          const items = perItem.map((_, i) => quizItem(`q${i}`, `t${i % 3}`));
          const responses = perItem.flatMap((chosen, i) => picks(`q${i}`, chosen));

          const baseline = selectCandidates(items, responses, {
            topicNames: TOPIC_NAMES,
          });

          for (let attempt = 0; attempt < 20; attempt += 1) {
            const shuffled = [...responses];
            for (let i = shuffled.length - 1; i > 0; i -= 1) {
              const j = (i * 7 + attempt * 13 + 5) % (i + 1);
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            expect(
              selectCandidates(items, shuffled, { topicNames: TOPIC_NAMES }),
            ).toEqual(baseline);
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it("is unchanged by the order the Quiz_Items arrive in", () => {
    const items = [quizItem("q1", "t1"), quizItem("q2", "t2"), quizItem("q3", "t3")];
    const responses = [
      ...picks("q1", ["b", "b", "a", "a"]),
      ...picks("q2", ["b", "b", "b", "a"]),
      ...picks("q3", ["c", "c", "a", "a", "a"]),
    ];

    expect(selectCandidates([...items].reverse(), responses)).toEqual(
      selectCandidates(items, responses),
    );
  });

  it("identifies candidates without any generation step", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "lib/domain/misconception.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/(aws|repo)/);
    expect(source).not.toMatch(/from\s+["']@aws-sdk/);
    expect(source).not.toMatch(/\bawait import\b/);
  });
});
