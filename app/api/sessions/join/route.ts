import { validateDisplayName, validateJoinCode } from "@/lib/domain/validate-input";
import { newLearnerId } from "@/lib/http/auth";
import { AppError } from "@/lib/http/errors";
import { pipeline, readJson } from "@/lib/http/pipeline";
import { getMaterial, listTopics } from "@/lib/repo/material";
import { registerLearner, resolveJoinCode } from "@/lib/repo/session";

/**
 * `POST /api/sessions/join`
 *
 * Admits a Learner on a Join_Code and a Display_Name. No password, no email, no
 * identity provider: the response carries a fresh opaque Learner_Id that only
 * means anything inside this Class_Session.
 */
export async function POST(request: Request) {
  return pipeline(request)
    .parse(() => readJson(request))
    .validate((body) => {
      const joinCode = validateJoinCode(body.joinCode);
      if (!joinCode.ok) {
        throw new AppError(joinCode.code, joinCode.message, joinCode.field);
      }

      const displayName = validateDisplayName(body.displayName);
      if (!displayName.ok) {
        throw new AppError(displayName.code, displayName.message, displayName.field);
      }

      return { joinCode: joinCode.value, displayName: displayName.value };
    })
    .read(async (input) => {
      const session = await resolveJoinCode(input.joinCode);

      if (!session) {
        throw new AppError(
          "SESSION_NOT_FOUND",
          `The class code ${input.joinCode} was not recognised.`,
          "joinCode",
        );
      }

      const [material, topics] = await Promise.all([
        getMaterial(session.sessionId, session.materialVersion),
        listTopics(session.sessionId, session.materialVersion),
      ]);

      return { session, material, topics, displayName: input.displayName };
    })
    .write(async (state) => {
      const learner = await registerLearner(state.session.sessionId, {
        learnerId: newLearnerId(),
        displayName: state.displayName,
      });

      return { ...state, learner };
    })
    .project((state) => ({
      sessionId: state.session.sessionId,
      learnerId: state.learner.learnerId,
      name: state.session.name,
      displayName: state.learner.displayName,
      material: state.material
        ? {
            filename: state.material.filename,
            status: state.material.status,
            poolStatus: state.material.poolStatus,
          }
        : null,
      topics: state.topics.map((topic) => ({
        topicId: topic.topicId,
        name: topic.name,
      })),
    }));
}
