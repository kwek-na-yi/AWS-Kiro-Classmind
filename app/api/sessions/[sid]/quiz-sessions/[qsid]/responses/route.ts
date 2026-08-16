import { nextState, replay } from "@/lib/domain/difficulty";
import { computeMasterySummary } from "@/lib/domain/mastery";
import { requireLearner } from "@/lib/http/auth";
import { AppError } from "@/lib/http/errors";
import { pipeline, readJson, readParams } from "@/lib/http/pipeline";
import { findQuizItemById } from "@/lib/repo/pool";
import { getQuizSession, listSessionResponses, recordResponse } from "@/lib/repo/quiz";
import { putReport } from "@/lib/repo/report";
import { getSession } from "@/lib/repo/session";
import type { QuizResponse } from "@/lib/types";

/**
 * `POST /api/sessions/{sid}/quiz-sessions/{qsid}/responses`
 *
 * Records one answer and returns the feedback for it.
 *
 * The write is a single conditional transaction, so a double-click or a retried
 * submit keeps the first answer and returns the same state rather than scoring
 * the Learner twice. The sixth response closes the Quiz_Session and builds the
 * Understanding_Report from the persisted responses — all integer arithmetic in
 * `lib/domain`, with no generation involved.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sid: string; qsid: string }> },
) {
  return pipeline(request)
    .parse(async () => ({
      params: await readParams(context),
      body: await readJson(request),
    }))
    .authorise(async (input) => ({
      ...input,
      learnerId: await requireLearner(request, input.params.sid),
    }))
    .read(async (input) => {
      const quizSession = await getQuizSession(
        input.params.sid,
        input.learnerId,
        input.params.qsid,
      );

      if (!quizSession) {
        throw new AppError(
          "NOT_YOUR_REPORT",
          "This quiz session belongs to another learner.",
        );
      }

      const session = await getSession(input.params.sid);
      if (!session) {
        throw new AppError("SESSION_NOT_FOUND", "This class session was not found.");
      }

      const quizItemId = String(input.body.quizItemId ?? "");
      const optionId = String(input.body.optionId ?? "");

      const item = await findQuizItemById(
        input.params.sid,
        session.materialVersion,
        quizItemId,
      );

      if (!item) {
        throw new AppError("SESSION_NOT_FOUND", "That question is not in this quiz.");
      }

      const chosen = item.options.find((option) => option.optionId === optionId);
      if (!chosen) {
        throw new AppError("SESSION_NOT_FOUND", "That answer option is not on this question.");
      }

      const responses = await listSessionResponses(input.params.sid, input.params.qsid);

      return { ...input, session, quizSession, item, chosen, responses };
    })
    .compute((state) => {
      const engine = replay(state.responses);
      const advanced = nextState(engine, state.chosen.isCorrect);
      const seq = state.responses.length + 1;

      return {
        ...state,
        seq,
        advanced,
        closes: seq >= state.quizSession.length,
      };
    })
    .write(async (state) => {
      const response: QuizResponse = {
        quizSessionId: state.params.qsid,
        seq: state.seq,
        learnerId: state.learnerId,
        quizItemId: state.item.quizItemId,
        topicId: state.item.topicId,
        optionId: state.chosen.optionId,
        isCorrect: state.chosen.isCorrect,
        difficultyServed: state.item.difficulty,
        submittedAt: new Date().toISOString(),
      };

      const written = await recordResponse(state.params.sid, {
        response,
        next: {
          currentDifficulty: state.advanced.difficulty,
          runKind: state.advanced.run.kind,
          runLen: state.advanced.run.len,
        },
        close: state.closes,
      });

      // First write wins: a duplicate submission for the same Quiz_Item keeps
      // the answer already recorded.
      if (!written) {
        const responses = await listSessionResponses(state.params.sid, state.params.qsid);
        return { ...state, duplicate: true, allResponses: responses };
      }

      const allResponses = [...state.responses, response];

      if (state.closes) {
        const summary = computeMasterySummary(allResponses);

        await putReport(state.params.sid, {
          learnerId: state.learnerId,
          quizSessionId: state.params.qsid,
          topicMastery: summary.topicMastery,
          weakTopics: summary.weakTopics,
          highestCorrectDifficulty: summary.highestCorrectDifficulty,
          guidance: [],
          // No generation is attempted for guidance in this build, so the
          // report is honest about carrying numbers and links only.
          guidanceMode: "omitted",
        });
      }

      return { ...state, duplicate: false, allResponses };
    })
    .project((state) => {
      const correct = state.item.options.find((option) => option.isCorrect);

      return {
        isCorrect: state.chosen.isCorrect,
        correctOptionId: correct?.optionId ?? null,
        correctOptionText: correct?.text ?? null,
        sourceRef: state.item.sourceRef,
        nextDifficulty: state.advanced.difficulty,
        index: state.allResponses.length,
        length: state.quizSession.length,
        closed: state.allResponses.length >= state.quizSession.length,
        duplicate: state.duplicate,
      };
    });
}
