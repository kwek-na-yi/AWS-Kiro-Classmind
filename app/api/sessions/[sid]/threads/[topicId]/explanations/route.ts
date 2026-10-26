import { submitExplanation } from "@/lib/ai/services/explanation";
import { validateExplanationText } from "@/lib/domain/validate-input";
import { requireLearner } from "@/lib/http/auth";
import { AppError } from "@/lib/http/errors";
import { pipeline, readJson, readParams } from "@/lib/http/pipeline";
import { enforceRateLimit, LIMITS } from "@/lib/http/rate-limit";
import { listTopics } from "@/lib/repo/material";
import { getLearner, getSession } from "@/lib/repo/session";

/**
 * `POST /api/sessions/{sid}/threads/{topicId}/explanations`
 *
 * Accepts a Peer_Explanation and returns immediately.
 *
 * The explanation is persisted as `Pending` before anything is assessed, so a
 * Learner's contribution is never lost waiting on generation. The client then
 * calls the validate endpoint, which performs the assessment in its own request
 * — and if that never happens, the next reader of the thread completes it.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sid: string; topicId: string }> },
) {
  return pipeline(request)
    .parse(async () => {
      await enforceRateLimit(request, LIMITS.explanation);
      return { params: await readParams(context), body: await readJson(request) };
    })
    .authorise(async (input) => ({
      ...input,
      learnerId: await requireLearner(request, input.params.sid),
    }))
    .validate((input) => {
      const text = validateExplanationText(input.body.text);

      if (!text.ok) {
        throw new AppError(text.code, text.message, text.field);
      }

      return { ...input, text: text.value };
    })
    .read(async (input) => {
      const session = await getSession(input.params.sid);

      if (!session) {
        throw new AppError("SESSION_NOT_FOUND", "This class session was not found.");
      }

      const topics = await listTopics(input.params.sid, session.materialVersion);

      if (!topics.some((topic) => topic.topicId === input.params.topicId)) {
        throw new AppError("SESSION_NOT_FOUND", "That topic is not in this class.");
      }

      const learner = await getLearner(input.params.sid, input.learnerId);

      return { ...input, session, displayName: learner?.displayName ?? "Anonymous" };
    })
    .write(async (state) =>
      submitExplanation({
        sessionId: state.params.sid,
        materialVersion: state.session.materialVersion,
        topicId: state.params.topicId,
        learnerId: state.learnerId,
        displayName: state.displayName,
        text: state.text,
      }),
    )
    .project(
      // The Display_Name is stored but never echoed: the thread is anonymous.
      (explanation) => ({
        id: explanation.explanationId,
        status: explanation.status,
        topicId: explanation.topicId,
      }),
      { status: 201 },
    );
}
