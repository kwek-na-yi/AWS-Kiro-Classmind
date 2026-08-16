import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { initialState, nextState, type EngineState } from "@/lib/domain/difficulty";
import { computeMasterySummary, type ScoredResponse } from "@/lib/domain/mastery";
import { difficultyWalk, selectNextItem } from "@/lib/domain/selection";
import type { DifficultyLevel, QuizItem } from "@/lib/types";

/** A Quiz_Item carrying only the fields selection actually reads. */
function item(
  quizItemId: string,
  topicId: string,
  difficulty: DifficultyLevel,
): QuizItem {
  return {
    quizItemId,
    materialVersion: 1,
    topicId,
    difficulty,
    stem: `Stem for ${quizItemId}`,
    options: [],
    unitIdx: 0,
    sourceRef: { kind: "page", value: "p. 1" },
  };
}

/** The pool from the worked trace: three Topics, four items per level. */
const TOPIC_ORDER = ["T1", "T2", "T3"];

const TRACE_POOL: QuizItem[] = [
  item("q1-a", "T1", 1),
  item("q1-b", "T2", 1),
  item("q1-c", "T3", 1),
  item("q1-d", "T1", 1),
  item("q2-a", "T1", 2),
  item("q2-b", "T3", 2),
  item("q2-c", "T2", 2),
  item("q2-d", "T1", 2),
  item("q3-a", "T1", 3),
  item("q3-b", "T3", 3),
  item("q3-c", "T3", 3),
  item("q3-d", "T2", 3),
];

interface SessionRun {
  served: QuizItem[];
  responses: ScoredResponse[];
  state: EngineState;
}

/**
 * Drives the engine the way the response endpoint will: select, answer, fold,
 * repeat. Stops early only when the pool is exhausted.
 */
function runSession(
  pool: readonly QuizItem[],
  topicOrder: readonly string[],
  answerAt: (index: number) => boolean,
  length = 6,
): SessionRun {
  const served: QuizItem[] = [];
  const responses: ScoredResponse[] = [];
  let state = initialState();

  for (let index = 0; index < length; index += 1) {
    const next = selectNextItem(
      pool,
      served.map((entry) => entry.quizItemId),
      responses,
      topicOrder,
      state.difficulty,
    );

    if (next === null) break;

    const isCorrect = answerAt(index);
    served.push(next);
    responses.push({
      topicId: next.topicId,
      isCorrect,
      difficultyServed: next.difficulty,
    });
    state = nextState(state, isCorrect);
  }

  return { served, responses, state };
}

describe("difficultyWalk", () => {
  it("prefers the lower level when two are equally near", () => {
    expect(difficultyWalk(2)).toEqual([2, 1, 3]);
  });

  it("walks outwards from the ends", () => {
    expect(difficultyWalk(1)).toEqual([1, 2, 3]);
    expect(difficultyWalk(3)).toEqual([3, 2, 1]);
  });
});

describe("candidate constraints", () => {
  it("serves an unserved item at the current difficulty", () => {
    const chosen = selectNextItem(TRACE_POOL, [], [], TOPIC_ORDER, 2);
    expect(chosen?.difficulty).toBe(2);
  });

  it("never serves an item already served", () => {
    const servedIds = TRACE_POOL.filter((i) => i.difficulty === 2).map(
      (i) => i.quizItemId,
    );

    const chosen = selectNextItem(TRACE_POOL, servedIds, [], TOPIC_ORDER, 2);
    expect(servedIds).not.toContain(chosen?.quizItemId);
  });

  it("walks to the lower level first when the current one is exhausted", () => {
    const servedIds = TRACE_POOL.filter((i) => i.difficulty === 2).map(
      (i) => i.quizItemId,
    );

    const chosen = selectNextItem(TRACE_POOL, servedIds, [], TOPIC_ORDER, 2);
    expect(chosen?.difficulty).toBe(1);
  });

  it("walks to the far level when both nearer ones are exhausted", () => {
    const servedIds = TRACE_POOL.filter((i) => i.difficulty !== 3).map(
      (i) => i.quizItemId,
    );

    const chosen = selectNextItem(TRACE_POOL, servedIds, [], TOPIC_ORDER, 2);
    expect(chosen?.difficulty).toBe(3);
  });
});

describe("candidate ordering", () => {
  it("prefers the Topic with fewest responses so far in this session", () => {
    const responses: ScoredResponse[] = [
      { topicId: "T1", isCorrect: true, difficultyServed: 2 },
    ];

    const chosen = selectNextItem(TRACE_POOL, ["q2-a"], responses, TOPIC_ORDER, 2);
    expect(chosen?.topicId).not.toBe("T1");
  });

  it("breaks a coverage tie by Topic order index", () => {
    const chosen = selectNextItem(TRACE_POOL, [], [], TOPIC_ORDER, 2);
    expect(chosen?.topicId).toBe("T1");

    const reordered = selectNextItem(TRACE_POOL, [], [], ["T3", "T2", "T1"], 2);
    expect(reordered?.topicId).toBe("T3");
  });

  it("breaks a Topic tie by ascending Quiz_Item id", () => {
    // q2-a and q2-d are both T1 at level 2.
    const chosen = selectNextItem(TRACE_POOL, [], [], TOPIC_ORDER, 2);
    expect(chosen?.quizItemId).toBe("q2-a");
  });

  it("sorts a Topic missing from the ordering after every known Topic", () => {
    const pool = [item("qz", "unknown", 2), item("qa", "T3", 2)];

    const chosen = selectNextItem(pool, [], [], TOPIC_ORDER, 2);
    expect(chosen?.topicId).toBe("T3");
  });

  it("does not depend on the order the pool arrives in", () => {
    const reversed = [...TRACE_POOL].reverse();

    expect(selectNextItem(reversed, [], [], TOPIC_ORDER, 2)).toEqual(
      selectNextItem(TRACE_POOL, [], [], TOPIC_ORDER, 2),
    );
  });
});

describe("insufficient and exhausted pools", () => {
  it("returns null for an empty pool", () => {
    expect(selectNextItem([], [], [], TOPIC_ORDER, 2)).toBeNull();
  });

  it("returns null only once every item has been served", () => {
    const servedIds = TRACE_POOL.map((i) => i.quizItemId);
    expect(selectNextItem(TRACE_POOL, servedIds, [], TOPIC_ORDER, 2)).toBeNull();
  });

  it("serves what a short pool has and then stops", () => {
    const pool = [item("a", "T1", 1), item("b", "T2", 3), item("c", "T3", 2)];

    const run = runSession(pool, TOPIC_ORDER, () => true);

    expect(run.served).toHaveLength(3);
    expect(new Set(run.served.map((i) => i.quizItemId)).size).toBe(3);
  });

  it("serves from another level when the pool has none at the current one", () => {
    const pool = [item("only", "T1", 3)];

    const chosen = selectNextItem(pool, [], [], TOPIC_ORDER, 2);
    expect(chosen?.quizItemId).toBe("only");
  });
});

describe("Property 6: no repetition", () => {
  it("never serves an item twice while an unserved item exists", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        fc.integer({ min: 6, max: 24 }),
        (flags, poolSize) => {
          const pool = Array.from({ length: poolSize }, (_, i) =>
            item(`q${String(i).padStart(2, "0")}`, `T${(i % 3) + 1}`, ((i % 3) + 1) as DifficultyLevel),
          );

          const run = runSession(pool, TOPIC_ORDER, (index) => flags[index]);
          const ids = run.served.map((entry) => entry.quizItemId);

          expect(new Set(ids).size).toBe(ids.length);
        },
      ),
    );
  });

  it("holds even when one whole level is missing from the pool", () => {
    const pool = [
      item("a1", "T1", 1),
      item("a2", "T2", 1),
      item("a3", "T3", 1),
      item("c1", "T1", 3),
      item("c2", "T2", 3),
      item("c3", "T3", 3),
    ];

    const run = runSession(pool, TOPIC_ORDER, () => false);
    const ids = run.served.map((entry) => entry.quizItemId);

    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });
});

describe("Property 7: session length", () => {
  it("serves exactly six items from a pool of at least six", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        fc.integer({ min: 6, max: 30 }),
        (flags, poolSize) => {
          const pool = Array.from({ length: poolSize }, (_, i) =>
            item(`q${String(i).padStart(2, "0")}`, `T${(i % 4) + 1}`, ((i % 3) + 1) as DifficultyLevel),
          );

          const run = runSession(pool, ["T1", "T2", "T3", "T4"], (i) => flags[i]);

          expect(run.served).toHaveLength(6);
          expect(run.responses).toHaveLength(6);
        },
      ),
    );
  });
});

describe("Property 5: determinism of the served order", () => {
  it("serves the same items in the same order on a replay", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }), (flags) => {
        const first = runSession(TRACE_POOL, TOPIC_ORDER, (i) => flags[i]);
        const second = runSession(TRACE_POOL, TOPIC_ORDER, (i) => flags[i]);

        expect(second.served.map((i) => i.quizItemId)).toEqual(
          first.served.map((i) => i.quizItemId),
        );
        expect(second.state).toEqual(first.state);
      }),
    );
  });

  it("spreads items across Topics rather than dwelling on one", () => {
    const run = runSession(TRACE_POOL, TOPIC_ORDER, () => true);
    const topics = new Set(run.served.map((entry) => entry.topicId));

    expect(topics.size).toBeGreaterThanOrEqual(3);
  });
});

describe("the worked six-response trace from the design", () => {
  it("serves the documented items and produces the documented report", () => {
    // correct, correct, incorrect, correct, incorrect, incorrect
    const answers = [true, true, false, true, false, false];

    const run = runSession(TRACE_POOL, TOPIC_ORDER, (index) => answers[index]);

    expect(run.served.map((entry) => entry.quizItemId)).toEqual([
      "q2-a",
      "q2-c",
      "q3-b",
      "q3-a",
      "q3-d",
      "q3-c",
    ]);

    // The difficulties the items were served at, per the trace's fifth column.
    expect(run.served.map((entry) => entry.difficulty)).toEqual([2, 2, 3, 3, 3, 3]);
    expect(run.state.difficulty).toBe(2);

    const summary = computeMasterySummary(run.responses);

    expect(summary.topicMastery).toEqual({ T1: 100, T2: 50, T3: 0 });
    expect(summary.weakTopics).toEqual(["T2", "T3"]);
    expect(summary.highestCorrectDifficulty).toBe(3);
  });
});
