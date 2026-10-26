import { getThread } from "@/lib/ai/services/explanation";
import { orderThread, recommended, statusCounts } from "@/lib/domain/gating";
import { requireLearner } from "@/lib/http/auth";
import { AppError } from "@/lib/http/errors";
import { pipeline, readParams } from "@/lib/http/pipeline";
import { listTopics } from "@/lib/repo/material";
import { getSession } from "@/lib/repo/session";
import type { PeerExplanation } from "@/lib/types";

/**
 * `GET /api/sessions/{sid}/threads/{topicId}`
 *
 * One Study_Thread: every Peer_Explanation for a Topic, with the recommended
 * ones marked.
 *
 * The projection is the important part. A Peer_Explanation is stored with the
 * Learner_Id that wrote it and the Display_Name they chose, and neither leaves
 * this handler — explanations are presented anonymously, so the class discusses
 * the idea rather than who said it.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sid: string; topicId: string }> },
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

      const topics = await listTopics(params.sid, session.materialVersion);
      const topic = topics.find((entry) => entry.topicId === params.topicId);

      if (!topic) {
        throw new AppError("SESSION_NOT_FOUND", "That topic is not in this class.");
      }

      return { params, session, topic };
    })
    .compute(async (state, ctx) => {
      const thread = await getThread({
        sessionId: state.params.sid,
        materialVersion: state.session.materialVersion,
        topicId: state.params.topicId,
        requestId: ctx.requestId,
      });

      return { ...state, thread };
    })
    .project((state) => {
      const { explanations, degraded } = state.thread;

      const recommendedIds = new Set(
        recommended(explanations).map((entry) => entry.explanationId),
      );

      const present = (explanation: PeerExplanation) => ({
        id: explanation.explanationId,
        text: explanation.text,
        status: explanation.status,
        sourceRef: explanation.sourceRef ?? null,
        reason: explanation.reason ?? null,
        isRecommended: recommendedIds.has(explanation.explanationId),
      });

      return {
        topicId: state.topic.topicId,
        topicName: state.topic.name,
        explanations: orderThread(explanations).map(present),
        recommendedCount: recommendedIds.size,
        counts: statusCounts(explanations),
        degraded,
      };
    });
}
