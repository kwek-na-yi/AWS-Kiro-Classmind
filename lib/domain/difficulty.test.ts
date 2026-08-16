import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  INITIAL_DIFFICULTY,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  initialState,
  nextState,
  replay,
  type EngineState,
} from "@/lib/domain/difficulty";

const answers = (flags: readonly boolean[]) =>
  flags.map((isCorrect) => ({ isCorrect }));

/** Arbitrary answer sequences of the lengths a Quiz_Session can reach and beyond. */
const sequence = fc.array(fc.boolean(), { minLength: 0, maxLength: 50 });

describe("initialState", () => {
  it("opens at difficulty 2 with an empty run", () => {
    expect(initialState()).toEqual({
      difficulty: 2,
      run: { kind: "none", len: 0 },
    });
    expect(INITIAL_DIFFICULTY).toBe(2);
  });

  it("returns a fresh object each time, so state cannot be shared", () => {
    const first = initialState();
    first.run.kind = "correct";

    expect(initialState().run.kind).toBe("none");
  });
});

describe("the transition table", () => {
  const at = (difficulty: 1 | 2 | 3, run: EngineState["run"]): EngineState => ({
    difficulty,
    run,
  });

  it("starts a run on the first response of a kind", () => {
    expect(nextState(at(2, { kind: "none", len: 0 }), true)).toEqual(
      at(2, { kind: "correct", len: 1 }),
    );
    expect(nextState(at(2, { kind: "none", len: 0 }), false)).toEqual(
      at(2, { kind: "incorrect", len: 1 }),
    );
  });

  it("raises by one and resets on two consecutive correct", () => {
    expect(nextState(at(2, { kind: "correct", len: 1 }), true)).toEqual(
      at(3, { kind: "none", len: 0 }),
    );
  });

  it("lowers by one and resets on two consecutive incorrect", () => {
    expect(nextState(at(2, { kind: "incorrect", len: 1 }), false)).toEqual(
      at(1, { kind: "none", len: 0 }),
    );
  });

  it("does not move when the run switches kind", () => {
    expect(nextState(at(2, { kind: "incorrect", len: 1 }), true)).toEqual(
      at(2, { kind: "correct", len: 1 }),
    );
    expect(nextState(at(2, { kind: "correct", len: 1 }), false)).toEqual(
      at(2, { kind: "incorrect", len: 1 }),
    );
  });

  it("clamps at the ceiling and still resets the run", () => {
    expect(nextState(at(3, { kind: "correct", len: 1 }), true)).toEqual(
      at(3, { kind: "none", len: 0 }),
    );
  });

  it("clamps at the floor and still resets the run", () => {
    expect(nextState(at(1, { kind: "incorrect", len: 1 }), false)).toEqual(
      at(1, { kind: "none", len: 0 }),
    );
  });
});

describe("repeated answers of one kind", () => {
  it("takes two correct answers per level, and no more than two levels", () => {
    const difficulties = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (count) => replay(answers(Array(count).fill(true))).difficulty,
    );

    expect(difficulties).toEqual([2, 3, 3, 3, 3, 3, 3, 3]);
  });

  it("takes two incorrect answers per level, and no lower than one", () => {
    const difficulties = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (count) => replay(answers(Array(count).fill(false))).difficulty,
    );

    expect(difficulties).toEqual([2, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("never moves when answers alternate", () => {
    const alternating = Array.from({ length: 20 }, (_, i) => i % 2 === 0);
    expect(replay(answers(alternating)).difficulty).toBe(2);
  });
});

describe("Property 1: bounded difficulty invariant", () => {
  it("keeps Current_Difficulty within 1 to 3 for every sequence", () => {
    fc.assert(
      fc.property(sequence, (flags) => {
        let state = initialState();

        for (const isCorrect of flags) {
          state = nextState(state, isCorrect);
          expect(state.difficulty).toBeGreaterThanOrEqual(MIN_DIFFICULTY);
          expect(state.difficulty).toBeLessThanOrEqual(MAX_DIFFICULTY);
        }
      }),
    );
  });
});

describe("Property 2: single-step invariant", () => {
  it("moves Current_Difficulty by at most one per response", () => {
    fc.assert(
      fc.property(sequence, (flags) => {
        let state = initialState();

        for (const isCorrect of flags) {
          const before = state.difficulty;
          state = nextState(state, isCorrect);
          expect(Math.abs(state.difficulty - before)).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it("only moves on a completed pair of the same kind", () => {
    fc.assert(
      fc.property(sequence, (flags) => {
        let state = initialState();

        for (const isCorrect of flags) {
          const before = state;
          const after = nextState(before, isCorrect);

          if (after.difficulty !== before.difficulty) {
            expect(before.run.len).toBe(1);
            expect(before.run.kind).toBe(isCorrect ? "correct" : "incorrect");
            expect(after.run).toEqual({ kind: "none", len: 0 });
          }

          state = after;
        }
      }),
    );
  });
});

describe("Property 3: monotone ascent", () => {
  it("never decreases under an all-correct sequence", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (length) => {
        let state = initialState();

        for (let i = 0; i < length; i += 1) {
          const before = state.difficulty;
          state = nextState(state, true);
          expect(state.difficulty).toBeGreaterThanOrEqual(before);
        }
      }),
    );
  });
});

describe("Property 4: monotone descent", () => {
  it("never increases under an all-incorrect sequence", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (length) => {
        let state = initialState();

        for (let i = 0; i < length; i += 1) {
          const before = state.difficulty;
          state = nextState(state, false);
          expect(state.difficulty).toBeLessThanOrEqual(before);
        }
      }),
    );
  });
});

describe("Property 5: determinism", () => {
  it("replays a sequence to the same state every time", () => {
    fc.assert(
      fc.property(sequence, (flags) => {
        expect(replay(answers(flags))).toEqual(replay(answers(flags)));
      }),
    );
  });

  it("is the fold of nextState, so a cached value is never needed", () => {
    fc.assert(
      fc.property(sequence, (flags) => {
        const folded = flags.reduce(
          (state, isCorrect) => nextState(state, isCorrect),
          initialState(),
        );

        expect(replay(answers(flags))).toEqual(folded);
      }),
    );
  });

  it("replays a prefix to the same state the full sequence passed through", () => {
    fc.assert(
      fc.property(sequence, (flags) => {
        let state = initialState();

        flags.forEach((isCorrect, index) => {
          state = nextState(state, isCorrect);
          expect(replay(answers(flags.slice(0, index + 1)))).toEqual(state);
        });
      }),
      { numRuns: 40 },
    );
  });

  it("returns the opening state for an empty history", () => {
    expect(replay([])).toEqual(initialState());
  });
});

describe("the worked six-response trace from the design", () => {
  it("follows the documented state at every step", () => {
    // correct, correct, incorrect, correct, incorrect, incorrect
    const trace = [true, true, false, true, false, false];

    const states: EngineState[] = [];
    let state = initialState();
    for (const isCorrect of trace) {
      state = nextState(state, isCorrect);
      states.push(state);
    }

    expect(states).toEqual([
      { difficulty: 2, run: { kind: "correct", len: 1 } },
      { difficulty: 3, run: { kind: "none", len: 0 } },
      { difficulty: 3, run: { kind: "incorrect", len: 1 } },
      { difficulty: 3, run: { kind: "correct", len: 1 } },
      { difficulty: 3, run: { kind: "incorrect", len: 1 } },
      { difficulty: 2, run: { kind: "none", len: 0 } },
    ]);
  });
});
