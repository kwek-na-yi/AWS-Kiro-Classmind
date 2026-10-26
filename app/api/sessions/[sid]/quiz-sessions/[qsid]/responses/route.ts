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
      // Two rounds rather than four. This call sits between the Learner
      // pressing "submit" and seeing whether they were right, so every
      // sequential read that could have run alongside another is time they
      // spend watching a disabled button.
      const [quizSession, session, responses] = await Promise.all([
        getQuizSession(input.params.sid, input.learnerId, input.params.qsid),
        getSession(input.params.sid),
        listSessionResponses(input.params.sid, input.params.qsid),
      ]);

      if (!quizSession) {
        throw new AppError(
          "NOT_YOUR_REPORT",
          "This quiz session belongs to another learner.",
        );
      }

      if (!session) {
        throw new AppError("SESSION_NOT_FOUND", "This class session was not found.");
      }

      const quizItemId = String(input.body.quizItemId ?? "");
      const optionId = String(input.body.optionId ?? "");

      // Needs the material version, so it cannot join the round above.
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

      // An answer already recorded for this item stands, whatever was sent now.
      const prior = responses.find((response) => response.quizItemId === item.quizItemId);

      if (!prior) {
        // Only the questions this session actually served can be answered.
        // Otherwise a client could answer around the adaptive engine — the
        // difficulty fold assumes each response followed a served item.
        if (!quizSession.servedItemIds.includes(item.quizItemId)) {
          throw new AppError("SESSION_NOT_FOUND", "That question has not been served in this quiz.");
        }

        // A closed session takes no further answers: a seventh response would
        // otherwise be recorded and the report rebuilt from it.
        if (quizSession.status === "closed" || responses.length >= quizSession.length) {
          throw new AppError("QUIZ_CLOSED", "This quiz is already finished. Start a new one to try again.");
        }
      }

      return { ...input, session, quizSession, item, chosen, responses, prior };
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
      // A repeat of an answered question: nothing is written, and the feedback
      // below describes the answer that was recorded the first time.
      if (state.prior) {
        return { ...state, duplicate: true, recorded: state.prior, allResponses: state.responses };
      }

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

      // First write wins: a concurrent submission for the same Quiz_Item got
      // there first, and its answer is the one that stands.
      if (!written) {
        const responses = await listSessionResponses(state.params.sid, state.params.qsid);
        const recorded = responses.find((entry) => entry.quizItemId === state.item.quizItemId);

        // The write was refused for a different item taking this sequence
        // number at the same moment — nothing about this answer was recorded.
        if (!recorded) {
          throw new AppError(
            "ANSWER_CONFLICT",
            "Another answer was being recorded at the same time. Reload the quiz to continue.",
          );
        }

        return { ...state, duplicate: true, recorded, allResponses: responses };
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

      return { ...state, duplicate: false, recorded: response, allResponses };
    })
    .project((state) => {
      const correct = state.item.options.find((option) => option.isCorrect);

      return {
        // The recorded answer, not necessarily the one in this request: on a
        // duplicate they can differ, and the feedback must match the score.
        isCorrect: state.recorded.isCorrect,
        correctOptionId: correct?.optionId ?? null,
        correctOptionText: correct?.text ?? null,
        sourceRef: state.item.sourceRef,
        // A fold over what is persisted, so a duplicate reports the real state.
        nextDifficulty: replay(state.allResponses).difficulty,
        index: state.allResponses.length,
        length: state.quizSession.length,
        closed: state.allResponses.length >= state.quizSession.length,
        duplicate: state.duplicate,
      };
    });
}
