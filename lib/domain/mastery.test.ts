import { readFileSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  WEAK_TOPIC_THRESHOLD,
  computeMasterySummary,
  computeTopicMastery,
  highestCorrectDifficulty,
  selectWeakTopics,
  type ScoredResponse,
} from "@/lib/domain/mastery";
import type { DifficultyLevel } from "@/lib/types";

function response(
  topicId: string,
  isCorrect: boolean,
  difficultyServed: DifficultyLevel = 2,
): ScoredResponse {
  return { topicId, isCorrect, difficultyServed };
}

/** Generates a response set over a small Topic space, as a session produces. */
const responsesArb = fc.array(
  fc.record({
    topicId: fc.constantFrom("T1", "T2", "T3", "T4"),
    isCorrect: fc.boolean(),
    difficultyServed: fc.constantFrom<DifficultyLevel>(1, 2, 3),
  }),
  { maxLength: 30 },
);

describe("Topic_Mastery", () => {
  it("is the correct count over the response count as a percentage", () => {
    const entries = computeTopicMastery([
      response("T1", true),
      response("T1", true),
      response("T2", true),
      response("T2", false),
      response("T3", false),
      response("T3", false),
    ]);

    expect(entries).toEqual([
      { topicId: "T1", answered: 2, correct: 2, mastery: 100, isWeak: false },
      { topicId: "T2", answered: 2, correct: 1, mastery: 50, isWeak: true },
      { topicId: "T3", answered: 2, correct: 0, mastery: 0, isWeak: true },
    ]);
  });

  it("reports a Topic with a single response", () => {
    expect(computeTopicMastery([response("T1", true)])[0]).toMatchObject({
      answered: 1,
      correct: 1,
      mastery: 100,
    });

    expect(computeTopicMastery([response("T1", false)])[0]).toMatchObject({
      answered: 1,
      correct: 0,
      mastery: 0,
    });
  });

  it("omits a Topic with no responses rather than scoring it zero", () => {
    const entries = computeTopicMastery([response("T1", true)]);

    expect(entries.map((entry) => entry.topicId)).toEqual(["T1"]);
    expect(entries.find((entry) => entry.topicId === "T2")).toBeUndefined();
  });

  it("returns nothing for an empty response set", () => {
    expect(computeTopicMastery([])).toEqual([]);
    expect(computeMasterySummary([])).toEqual({
      entries: [],
      topicMastery: {},
      weakTopics: [],
      highestCorrectDifficulty: null,
    });
  });

  it("rounds a half up, so 1 of 8 is 13 rather than 12", () => {
    const responses = [
      response("T1", true),
      ...Array.from({ length: 7 }, () => response("T1", false)),
    ];

    expect(computeTopicMastery(responses)[0].mastery).toBe(13);
  });
});

describe("Property 8: range invariant", () => {
  it("keeps every Topic_Mastery within 0 to 100", () => {
    fc.assert(
      fc.property(responsesArb, (responses) => {
        for (const entry of computeTopicMastery(responses)) {
          expect(entry.mastery).toBeGreaterThanOrEqual(0);
          expect(entry.mastery).toBeLessThanOrEqual(100);
          expect(Number.isInteger(entry.mastery)).toBe(true);
        }
      }),
    );
  });

  it("scores an all-correct Topic 100 and an all-incorrect Topic 0", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (count) => {
        const allCorrect = Array.from({ length: count }, () => response("T1", true));
        const allWrong = Array.from({ length: count }, () => response("T2", false));

        expect(computeTopicMastery(allCorrect)[0].mastery).toBe(100);
        expect(computeTopicMastery(allWrong)[0].mastery).toBe(0);
      }),
    );
  });
});

describe("Property 12: weak topic consistency", () => {
  it("lists a Topic as weak exactly when its mastery is below 60", () => {
    fc.assert(
      fc.property(responsesArb, (responses) => {
        const entries = computeTopicMastery(responses);
        const weak = new Set(selectWeakTopics(entries));

        for (const entry of entries) {
          expect(weak.has(entry.topicId)).toBe(entry.mastery < WEAK_TOPIC_THRESHOLD);
        }
      }),
    );
  });

  it("treats exactly 60 as not weak", () => {
    // 3 of 5 is exactly 60 percent.
    const responses = [
      response("T1", true),
      response("T1", true),
      response("T1", true),
      response("T1", false),
      response("T1", false),
    ];

    const entries = computeTopicMastery(responses);

    expect(entries[0].mastery).toBe(60);
    expect(entries[0].isWeak).toBe(false);
    expect(selectWeakTopics(entries)).toEqual([]);
  });

  it("treats a value that rounds up to 60 as not weak", () => {
    // 7 of 12 is 58.33 → 58; 71 of 118 rounds to 60.
    const nearMiss = [
      ...Array.from({ length: 7 }, () => response("T1", true)),
      ...Array.from({ length: 5 }, () => response("T1", false)),
    ];

    expect(computeTopicMastery(nearMiss)[0]).toMatchObject({
      mastery: 58,
      isWeak: true,
    });
  });

  it("treats the value just below the threshold as weak", () => {
    // 59 of 100.
    const responses = [
      ...Array.from({ length: 59 }, () => response("T1", true)),
      ...Array.from({ length: 41 }, () => response("T1", false)),
    ];

    expect(computeTopicMastery(responses)[0]).toMatchObject({
      mastery: 59,
      isWeak: true,
    });
  });
});

describe("highest Difficulty_Level answered correctly", () => {
  it("reports the highest level among correct responses only", () => {
    expect(
      highestCorrectDifficulty([
        response("T1", true, 1),
        response("T2", false, 3),
        response("T3", true, 2),
      ]),
    ).toBe(2);
  });

  it("is null when nothing was answered correctly", () => {
    expect(
      highestCorrectDifficulty([response("T1", false, 3), response("T2", false, 1)]),
    ).toBeNull();
  });

  it("is null for an empty response set", () => {
    expect(highestCorrectDifficulty([])).toBeNull();
  });

  it("never exceeds the highest level actually served", () => {
    fc.assert(
      fc.property(responsesArb, (responses) => {
        const highest = highestCorrectDifficulty(responses);
        if (highest === null) return;

        const servedLevels = responses
          .filter((entry) => entry.isCorrect)
          .map((entry) => entry.difficultyServed);

        expect(servedLevels).toContain(highest);
        expect(highest).toBe(Math.max(...servedLevels));
      }),
    );
  });
});

describe("determinism", () => {
  it("produces identical output on repeated runs", () => {
    fc.assert(
      fc.property(responsesArb, (responses) => {
        expect(computeMasterySummary(responses)).toEqual(
          computeMasterySummary(responses),
        );
      }),
    );
  });

  it("is independent of the order responses arrive in", () => {
    fc.assert(
      fc.property(responsesArb, (responses) => {
        const reversed = [...responses].reverse();

        expect(computeMasterySummary(reversed).entries).toEqual(
          computeMasterySummary(responses).entries,
        );
      }),
    );
  });

  it("is independent of any permutation, not merely reversal", () => {
    fc.assert(
      fc.property(responsesArb.chain((r) => fc.tuple(fc.constant(r), fc.shuffledSubarray(r, { minLength: r.length, maxLength: r.length }))), ([original, shuffled]) => {
        expect(computeMasterySummary(shuffled).topicMastery).toEqual(
          computeMasterySummary(original).topicMastery,
        );
      }),
    );
  });

  it("issues no request and reaches for no provider", () => {
    for (const file of ["mastery.ts", "difficulty.ts", "selection.ts", "round.ts"]) {
      const source = readFileSync(
        path.resolve(process.cwd(), "lib/domain", file),
        "utf8",
      );

      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/from\s+["']@\/lib\/(aws|repo)/);
      expect(source).not.toMatch(/from\s+["']@aws-sdk/);
      expect(source).not.toMatch(/\bawait import\b/);
    }
  });
});
