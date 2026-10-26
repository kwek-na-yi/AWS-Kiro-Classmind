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
      // Two rounds of reads rather than four. A Learner waits on this call
      // between every question, and each sequential DynamoDB call is a real
      // network hop — chaining reads that do not depend on one another added a
      // visible pause to every question.
      //
      // The Learner_Id is part of the Quiz_Session key, so another Learner's
      // session simply is not found rather than being found and refused.
      const [quizSession, session, responses] = await Promise.all([
        getQuizSession(input.params.sid, input.learnerId, input.params.qsid),
        getSession(input.params.sid),
        listSessionResponses(input.params.sid, input.params.qsid),
      ]);

      if (!quizSession) {
        throw new AppError("NOT_YOUR_REPORT", "This quiz session belongs to another learner.");
      }

      if (!session) {
        throw new AppError("SESSION_NOT_FOUND", "This class session was not found.");
      }

      // These two need the material version, so they are the second round.
      const [pool, topics] = await Promise.all([
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
        return { ...state, item: null, alreadyServed: false };
      }

      // A question already served but not yet answered is served again rather
      // than skipped. Without this, asking for "next" twice — a retry, a
      // remount — would discard the pending question, let a Learner skip one
      // they did not like, and burn through the pool.
      const answered = new Set(state.responses.map((response) => response.quizItemId));
      const pendingId = state.quizSession.servedItemIds.find((id) => !answered.has(id));
      const pending = pendingId
        ? state.pool.find((candidate) => candidate.quizItemId === pendingId)
        : undefined;

      if (pending) return { ...state, item: pending, alreadyServed: true };

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

      return { ...state, item, alreadyServed: false };
    })
    .write(async (state) => {
      if (state.item && !state.alreadyServed) {
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
