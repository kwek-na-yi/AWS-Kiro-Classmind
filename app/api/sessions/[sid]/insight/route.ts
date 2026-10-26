import { getClassInsight } from "@/lib/ai/services/insight";
import { requireSessionMember } from "@/lib/http/auth";
import { AppError } from "@/lib/http/errors";
import { pipeline, readParams } from "@/lib/http/pipeline";
import { getSession } from "@/lib/repo/session";

/**
 * `GET /api/sessions/{sid}/insight`
 *
 * The Class_Understanding_Map and its shared misconceptions, computed at read
 * time from every persisted Quiz_Response.
 *
 * Readable by any Learner of the Class_Session or by the Instructor, because
 * nothing in the response is per-learner: it has already passed through the
 * anonymisation allow-list, so no Learner_Id, Display_Name, timestamp or
 * individual response can appear in any branch.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sid: string }> },
) {
  return pipeline(request)
    .parse(() => readParams(context))
    .authorise(async (params) => {
      await requireSessionMember(request, params.sid);
      return params;
    })
    .read(async (params) => {
      const session = await getSession(params.sid);

      if (!session) {
        throw new AppError("SESSION_NOT_FOUND", "This class session was not found.");
      }

      return session;
    })
    .compute(async (session, ctx) =>
      getClassInsight({
        sessionId: session.sessionId,
        materialVersion: session.materialVersion,
        requestId: ctx.requestId,
      }),
    )
    .project((insight) => ({
      topics: insight.topics,
      misconceptions: insight.misconceptions,
      anonymityThreshold: insight.anonymityThreshold,
      weakestTopicId: insight.weakestTopicId,
      respondingLearners: insight.respondingLearners,
      degraded: insight.degraded,
    }));
}
