import { getOrGenerateRecap } from "@/lib/ai/services/recap";
import { requireLearner } from "@/lib/http/auth";
import { AppError } from "@/lib/http/errors";
import { pipeline, readParams } from "@/lib/http/pipeline";
import { getMaterial } from "@/lib/repo/material";
import { getProfile, getSession } from "@/lib/repo/session";

/**
 * `GET /api/sessions/{sid}/recap`
 *
 * Returns the Recap for the Learner's stored profile: retained when one exists,
 * generated and retained on a miss, and a labelled source extract when
 * generation degrades. The orchestration lives in the recap service — this
 * handler only authorises, reads the profile and projects the response.
 */
export async function GET(
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
      const [session, profile] = await Promise.all([
        getSession(input.params.sid),
        getProfile(input.params.sid, input.learnerId),
      ]);

      if (!session) {
        throw new AppError("SESSION_NOT_FOUND", "This class session was not found.");
      }

      if (!profile) {
        throw new AppError(
          "PROFILE_REQUIRED",
          "Choose an understanding level and an explanation style first.",
        );
      }

      // A class with no processed lecture has nothing to recap. Saying so beats
      // a fallback that claims to quote material that does not exist.
      const material = await getMaterial(session.sessionId, session.materialVersion);
      if (!material || material.status !== "ready") {
        throw new AppError(
          "MATERIAL_REQUIRED",
          "This class has no lecture material yet. Upload it on the Learn page and your recap will be built from it.",
        );
      }

      return { session, profile };
    })
    .generate(async (state, ctx) =>
      getOrGenerateRecap({
        sessionId: state.session.sessionId,
        materialVersion: state.session.materialVersion,
        profile: {
          understandingLevel: state.profile.understandingLevel,
          explanationStyle: state.profile.explanationStyle,
        },
        requestId: ctx.requestId,
      }),
    )
    .project((result) => ({
      mode: result.recap.mode,
      source: result.source,
      understandingLevel: result.recap.understandingLevel,
      explanationStyle: result.recap.explanationStyle,
      takeaways: result.recap.takeaways,
      sections: result.recap.sections.map((section) => ({
        topicId: section.topicId,
        topicName: section.topicName,
        body: section.body,
        sourceRefs: section.sourceRefs,
        unverified: section.unverified,
        uncovered: section.uncovered ?? false,
        artefact: section.artefact
          ? {
              kind: section.artefact.kind,
              content: section.artefact.content,
              prose: section.artefact.prose,
            }
          : null,
        styleWarning: section.styleWarning ?? null,
      })),
      degraded: result.degraded,
    }));
}
