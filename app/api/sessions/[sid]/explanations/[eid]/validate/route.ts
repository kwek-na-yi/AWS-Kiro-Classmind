import { validateExplanation } from "@/lib/ai/services/explanation";
import { requireLearner } from "@/lib/http/auth";
import { AppError } from "@/lib/http/errors";
import { pipeline, readParams } from "@/lib/http/pipeline";
import { getSession } from "@/lib/repo/session";

/**
 * `POST /api/sessions/{sid}/explanations/{eid}/validate`
 *
 * Assesses a Peer_Explanation against the Source_Text and records the verdict.
 *
 * Any Learner of the Class_Session may trigger this, not just the author: the
 * point is that a stranded explanation gets assessed, and the call is guarded by
 * a conditional claim so it can only ever run once per explanation.
 *
 * When the assessment cannot be completed the status stays `Pending` and the
 * response says so — a failed check is never reported as a pass.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sid: string; eid: string }> },
) {
  return pipeline(request)
    .parse(() => readParams(context))
    .authorise(async (params) => {
      await requireLearner(request, params.sid);
      return params;
    })
    .read(async (params) => {
      const session = await getSession(params.sid);

      if (!session) {
        throw new AppError("SESSION_NOT_FOUND", "This class session was not found.");
      }

      return { params, session };
    })
    .generate(async (state, ctx) => {
      const result = await validateExplanation({
        sessionId: state.params.sid,
        materialVersion: state.session.materialVersion,
        explanationId: state.params.eid,
        requestId: ctx.requestId,
      });

      if (!result) {
        throw new AppError("SESSION_NOT_FOUND", "That explanation was not found.");
      }

      return result;
    })
    .project((result) => ({
      id: result.explanation.explanationId,
      status: result.explanation.status,
      sourceRef: result.explanation.sourceRef ?? null,
      reason: result.explanation.reason ?? null,
      // True when the check could not be completed, so the caller can say
      // "still checking" rather than implying a verdict.
      degraded: result.degraded,
    }));
}
