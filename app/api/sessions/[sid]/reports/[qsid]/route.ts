import { WEAK_TOPIC_THRESHOLD } from "@/lib/domain/mastery";
import { requireLearner } from "@/lib/http/auth";
import { AppError } from "@/lib/http/errors";
import { pipeline, readParams } from "@/lib/http/pipeline";
import { listTopics } from "@/lib/repo/material";
import { getReport } from "@/lib/repo/report";
import { getSession } from "@/lib/repo/session";

/**
 * `GET /api/sessions/{sid}/reports/{qsid}`
 *
 * The Learner's own Understanding_Report — the only endpoint that returns
 * per-Learner numbers, and only to the Learner who owns them.
 *
 * Ownership is enforced by key construction: the Learner_Id is part of the
 * report's sort key, so a request carrying a different Learner_Id reads nothing
 * at all. The response carries this Learner's results only; no class aggregate,
 * no other Learner's data, and no Display_Name.
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
      const report = await getReport(
        input.params.sid,
        input.learnerId,
        input.params.qsid,
      );

      if (!report) {
        throw new AppError(
          "NOT_YOUR_REPORT",
          "No report was found for this learner and quiz session.",
        );
      }

      const session = await getSession(input.params.sid);
      const topics = session
        ? await listTopics(input.params.sid, session.materialVersion)
        : [];

      return { report, topics };
    })
    .project((state) => {
      const nameOf = (topicId: string) =>
        state.topics.find((topic) => topic.topicId === topicId)?.name ?? topicId;

      return {
        quizSessionId: state.report.quizSessionId,
        topicMastery: Object.entries(state.report.topicMastery)
          .map(([topicId, mastery]) => ({
            topicId,
            topicName: nameOf(topicId),
            mastery,
          }))
          .sort((a, b) => a.mastery - b.mastery || (a.topicId < b.topicId ? -1 : 1)),
        weakTopics: state.report.weakTopics.map((topicId) => ({
          topicId,
          topicName: nameOf(topicId),
          recapAnchor: `#topic-${topicId}`,
        })),
        weakTopicThreshold: WEAK_TOPIC_THRESHOLD,
        highestCorrectDifficulty: state.report.highestCorrectDifficulty,
        guidance: state.report.guidance,
        guidanceMode: state.report.guidanceMode,
      };
    });
}
