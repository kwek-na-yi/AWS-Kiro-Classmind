import { replay } from "@/lib/domain/difficulty";
import { selectNextItem } from "@/lib/domain/selection";
import { requireLearner } from "@/lib/http/auth";
import { AppError } from "@/lib/http/errors";
import { pipeline, readParams } from "@/lib/http/pipeline";
import { listTopics } from "@/lib/repo/material";
import { listQuizItems } from "@/lib/repo/pool";
import {
  getQuizSession,
  listSessionResponses,
  markItemServed,
} from "@/lib/repo/quiz";
import { getSession } from "@/lib/repo/session";

/**
 * `GET /api/sessions/{sid}/quiz-sessions/{qsid}/next`
 *
 * Serves the next Quiz_Item. Which item that is comes entirely from the
 * deterministic engine: the difficulty is a fold over the persisted responses
 * and the item is the first in a fixed total order, so a replay of the same
 * Quiz_Session serves the same items in the same sequence.
 *
 * The projection carries the stem and the option text only — no correctness
 * flag and no Misconception_Label ever reaches the browser.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sid: string; qsid: string }> },
) {
  return pipeline(request)
    .parse(() => readParams(context))
    .authorise(async (params) => ({
      params,
      learnerId: await requireLearner(request, params.sid),
    }))
    .read(async (input) => {
      // The Learner_Id is part of the Quiz_Session key, so another Learner's
      // session simply is not found rather than being found and refused.
      const quizSession = await getQuizSession(
        input.params.sid,
        input.learnerId,
        input.params.qsid,
      );

      if (!quizSession) {
        throw new AppError("NOT_YOUR_REPORT", "This quiz session belongs to another learner.");
      }

      const session = await getSession(input.params.sid);
      if (!session) {
        throw new AppError("SESSION_NOT_FOUND", "This class session was not found.");
      }

      const [responses, pool, topics] = await Promise.all([
        listSessionResponses(input.params.sid, input.params.qsid),
        listQuizItems(input.params.sid, session.materialVersion),
        listTopics(input.params.sid, session.materialVersion),
      ]);

      return { ...input, quizSession, responses, pool, topics };
    })
    .compute((state) => {
      if (
        state.quizSession.status === "closed" ||
        state.responses.length >= state.quizSession.length
      ) {
        return { ...state, item: null };
      }

      const engine = replay(state.responses);

      const item = selectNextItem(
        state.pool,
        state.quizSession.servedItemIds,
        state.responses,
        [...state.topics]
          .sort((a, b) => a.order - b.order)
          .map((topic) => topic.topicId),
        engine.difficulty,
      );

      return { ...state, item };
    })
    .write(async (state) => {
      if (state.item) {
        await markItemServed(
          state.params.sid,
          state.learnerId,
          state.params.qsid,
          state.item.quizItemId,
        );
      }

      return state;
    })
    .project((state) => {
      if (!state.item) {
        return { done: true, index: state.responses.length, length: state.quizSession.length };
      }

      const topicName =
        state.topics.find((topic) => topic.topicId === state.item?.topicId)?.name ??
        state.item.topicId;

      return {
        done: false,
        index: state.responses.length + 1,
        length: state.quizSession.length,
        item: {
          id: state.item.quizItemId,
          stem: state.item.stem,
          difficulty: state.item.difficulty,
          topicName,
          options: state.item.options.map((option) => ({
            id: option.optionId,
            text: option.text,
          })),
        },
      };
    });
}
