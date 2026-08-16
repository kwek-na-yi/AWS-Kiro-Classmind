import type { DifficultyLevel, RunKind } from "@/lib/types";

/**
 * The adaptive quiz difficulty engine.
 *
 * Three pure functions implement the whole of it. `replay` folds `nextState`
 * over the persisted Quiz_Responses, and that fold is the **only** source of
 * truth for Current_Difficulty: the value stored on the Quiz_Session item is a
 * cache of it. A lost or duplicated update to that cache therefore cannot
 * desynchronise the engine — replaying the responses always recovers the true
 * state, which is what makes a Quiz_Session reproducible.
 *
 * This module performs no I/O and imports nothing but types.
 */

export const MIN_DIFFICULTY: DifficultyLevel = 1;
export const MAX_DIFFICULTY: DifficultyLevel = 3;
/** Every Quiz_Session opens at the intermediate level. */
export const INITIAL_DIFFICULTY: DifficultyLevel = 2;

/**
 * The current run of consecutive same-kind responses.
 *
 * The length only ever holds 0 or 1, because reaching 2 immediately moves the
 * difficulty and resets the run — the count never needs to go higher.
 */
export interface Run {
  kind: RunKind;
  len: 0 | 1;
}

export interface EngineState {
  difficulty: DifficultyLevel;
  run: Run;
}

/** Just enough of a Quiz_Response to fold over. */
export interface CorrectnessLike {
  isCorrect: boolean;
}

const NO_RUN: Run = { kind: "none", len: 0 };

function clamp(difficulty: number): DifficultyLevel {
  if (difficulty <= MIN_DIFFICULTY) return MIN_DIFFICULTY;
  if (difficulty >= MAX_DIFFICULTY) return MAX_DIFFICULTY;
  return difficulty as DifficultyLevel;
}

/** Current_Difficulty 2 with an empty run. */
export function initialState(): EngineState {
  return { difficulty: INITIAL_DIFFICULTY, run: { ...NO_RUN } };
}

/**
 * Applies one Quiz_Response.
 *
 * Two consecutive correct responses raise the level by one and reset the run;
 * two consecutive incorrect lower it by one and reset. A response of the other
 * kind breaks the run and starts a new one without moving the level, so the
 * level can only ever change by one step, and only on a completed pair.
 *
 * The level is clamped to 1–3, so a Learner answering correctly at level 3 stays
 * at level 3 with a cleared run rather than running off the top of the scale.
 */
export function nextState(state: EngineState, isCorrect: boolean): EngineState {
  const kind: RunKind = isCorrect ? "correct" : "incorrect";

  const completesPair = state.run.kind === kind && state.run.len === 1;

  if (completesPair) {
    return {
      difficulty: clamp(state.difficulty + (isCorrect ? 1 : -1)),
      run: { ...NO_RUN },
    };
  }

  return {
    difficulty: state.difficulty,
    run: { kind, len: 1 },
  };
}

/**
 * Folds the whole response history into the engine state.
 *
 * This is the authoritative Current_Difficulty. Callers read it rather than
 * trusting the cached value on the Quiz_Session item.
 */
export function replay(responses: readonly CorrectnessLike[]): EngineState {
  return responses.reduce<EngineState>(
    (state, response) => nextState(state, response.isCorrect),
    initialState(),
  );
}
