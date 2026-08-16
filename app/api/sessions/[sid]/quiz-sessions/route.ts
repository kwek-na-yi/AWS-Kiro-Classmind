import { randomUUID } from "node:crypto";

import { generateAndPersistQuizPool } from "@/lib/ai/services/pool";
import { initialState } from "@/lib/domain/difficulty";
import { requireLearner } from "@/lib/http/auth";
import { AppError } from "@/lib/http/errors";
import { pipeline, readParams } from "@/lib/http/pipeline";
import { getMaterial } from "@/lib/repo/material";
import { listQuizItems } from "@/lib/repo/pool";
import { createQuizSession } from "@/lib/repo/quiz";
import { getSession } from "@/lib/repo/session";

/** Quiz_Items served in one Quiz_Session. */
export const QUIZ_SESSION_LENGTH = 6;

/**
 * `POST /api/sessions/{sid}/quiz-sessions`
 *
 * Opens a Quiz_Session at the starting difficulty. If the Quiz_Pool has not been
 * built yet this builds it first — generation is local and deterministic, so it
 * costs no network round trip and the Learner is not left waiting on a
 * background job that may never have run.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sid: string }> },
) {
  return pipeline(request)
    .parse(() => readParams(context))
    .authorise(async (params) => ({
      params,
      learnerId: await requireLearner(request, params.sid),
    }))
    .read(async (input) => {
      const session = await getSession(input.params.sid);
      if (!session) {
        throw new AppError("SESSION_NOT_FOUND", "This class session was not found.");
      }

      return { ...input, session };
    })
    .generate(async (state, ctx) => {
      const material = await getMaterial(
        state.session.sessionId,
        state.session.materialVersion,
      );

      if (material && material.poolStatus === "pending") {
        await generateAndPersistQuizPool({
          sessionId: state.session.sessionId,
          materialVersion: state.session.materialVersion,
          requestId: ctx.requestId,
        });
      }

      const pool = await listQuizItems(
        state.session.sessionId,
        state.session.materialVersion,
      );

      if (pool.length === 0) {
        throw new AppError(
          "POOL_UNAVAILABLE",
          "The quiz for this class could not be generated. The recap is still available.",
        );
      }

      return { ...state, poolSize: pool.length };
    })
    .write(async (state) =>
      createQuizSession(state.session.sessionId, {
        quizSessionId: randomUUID().replace(/-/g, ""),
        learnerId: state.learnerId,
        currentDifficulty: initialState().difficulty,
        length: Math.min(QUIZ_SESSION_LENGTH, state.poolSize),
      }),
    )
    .project(
      (quizSession) => ({
        quizSessionId: quizSession.quizSessionId,
        currentDifficulty: quizSession.currentDifficulty,
        length: quizSession.length,
      }),
      { status: 201 },
    );
}
