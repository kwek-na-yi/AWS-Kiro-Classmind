import { describe, expect, it } from "vitest";

import { analyseGaps, type AnsweredQuestion } from "@/components/gap-analysis";

function answer(
  topicName: string,
  difficulty: 1 | 2 | 3,
  isCorrect: boolean,
): AnsweredQuestion {
  return { topicName, difficulty, isCorrect };
}

describe("classifying a weak topic", () => {
  it("calls a missed foundational question a concept gap", () => {
    const [gap] = analyseGaps([answer("Normalisation", 1, false)]);

    expect(gap.kind).toBe("conceptual");
    expect(gap.summary).toMatch(/foundational/i);
  });

  it("calls a held foundation with a missed harder question an application gap", () => {
    const [gap] = analyseGaps([
      answer("Indexing", 1, true),
      answer("Indexing", 3, false),
    ]);

    expect(gap.kind).toBe("application");
    expect(gap.summary).toMatch(/applying/i);
  });

  it("calls a total miss across levels mixed", () => {
    const [gap] = analyseGaps([
      answer("Joins", 1, false),
      answer("Joins", 3, false),
    ]);

    expect(gap.kind).toBe("mixed");
  });

  it("reports nothing for a topic answered correctly", () => {
    expect(analyseGaps([answer("Normalisation", 2, true)])).toEqual([]);
  });

  it("reports nothing for an empty session", () => {
    expect(analyseGaps([])).toEqual([]);
  });
});

describe("ordering", () => {
  it("puts the most-missed topic first", () => {
    const gaps = analyseGaps([
      answer("One miss", 2, false),
      answer("Two misses", 2, false),
      answer("Two misses", 3, false),
    ]);

    expect(gaps[0].topicName).toBe("Two misses");
    expect(gaps[0].missed).toBe(2);
  });

  it("is deterministic for ties", () => {
    const answers = [answer("Beta", 2, false), answer("Alpha", 2, false)];

    expect(analyseGaps(answers).map((gap) => gap.topicName)).toEqual(["Alpha", "Beta"]);
    expect(analyseGaps([...answers].reverse()).map((gap) => gap.topicName)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("counts answers and misses per topic", () => {
    const [gap] = analyseGaps([
      answer("Topic", 1, true),
      answer("Topic", 2, false),
      answer("Topic", 3, false),
    ]);

    expect(gap.answered).toBe(3);
    expect(gap.missed).toBe(2);
  });
});

describe("a topic where nothing held", () => {
  it("does not call a total miss above the foundational level mixed", () => {
    // The learner was only ever asked harder questions here and missed them.
    // "Some answers held and some did not" would be a false statement about
    // their own answers.
    const [gap] = analyseGaps([
      { topicName: "Indexing", difficulty: 2, isCorrect: false },
      { topicName: "Indexing", difficulty: 3, isCorrect: false },
    ]);

    expect(gap.kind).toBe("unclear");
    expect(gap.summary).not.toMatch(/some answers held/i);
    expect(gap.missed).toBe(2);
  });

  it("reads a single missed question as the one question it was", () => {
    const [gap] = analyseGaps([
      { topicName: "Denormalisation", difficulty: 2, isCorrect: false },
    ]);

    expect(gap.kind).toBe("unclear");
    expect(gap.summary).toMatch(/one question/i);
  });

  it("still calls a genuine mix mixed", () => {
    const [gap] = analyseGaps([
      { topicName: "Indexing", difficulty: 2, isCorrect: true },
      { topicName: "Indexing", difficulty: 3, isCorrect: false },
    ]);

    expect(gap.kind).toBe("mixed");
    expect(gap.summary).toMatch(/some answers held/i);
  });
});
