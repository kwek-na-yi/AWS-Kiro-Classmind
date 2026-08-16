import { validateProfile } from "@/lib/domain/validate-input";
import { requireLearner } from "@/lib/http/auth";
import { AppError } from "@/lib/http/errors";
import { pipeline, readJson, readParams } from "@/lib/http/pipeline";
import { putProfile } from "@/lib/repo/session";

/**
 * `PUT /api/sessions/{sid}/profile`
 *
 * Persists the Learner_Profile — one Understanding_Level and one
 * Explanation_Style — which the Recap is then generated for.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ sid: string }> },
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
    .validate((input) => {
      const profile = validateProfile(
        input.body.understandingLevel,
        input.body.explanationStyle,
      );

      if (!profile.ok) {
        throw new AppError(profile.code, profile.message, profile.field);
      }

      return { ...input, profile: profile.value };
    })
    .write(async (input) =>
      putProfile(input.params.sid, {
        learnerId: input.learnerId,
        ...input.profile,
      }),
    )
    .project((profile) => ({
      understandingLevel: profile.understandingLevel,
      explanationStyle: profile.explanationStyle,
    }));
}
