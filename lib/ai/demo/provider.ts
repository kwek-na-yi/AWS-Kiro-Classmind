import { assessExplanation, buildClarification } from "@/lib/ai/demo/assess";
import { indexCorpus } from "@/lib/ai/demo/corpus";
import { buildQuizPool } from "@/lib/ai/demo/quiz";
import { buildRecap } from "@/lib/ai/demo/recap";
import {
  failed,
  generated,
  type AIProvider,
  type AssessmentOutput,
  type AssessmentRequest,
  type ClarificationOutput,
  type ClarificationRequest,
  type GenerationResult,
  type QuizPoolOutput,
  type QuizPoolRequest,
  type RecapOutput,
  type RecapRequest,
} from "@/lib/ai/provider";

/**
 * The deterministic demo provider.
 *
 * **This is not machine learning.** It performs no inference and calls no
 * service. Every Recap sentence, every Quiz_Item option and every clarification
 * is text selected from the uploaded lecture material by fixed rules, and the
 * only words the provider contributes are structural framing — a section
 * lead-in, a question stem, a table header. Nothing it emits is a claim about
 * the subject that the source does not already make.
 *
 * That constraint is what makes it a legitimate MVP provider rather than a
 * placeholder. It cannot hallucinate, because it can only quote; it cannot
 * fabricate a citation, because it returns unit indexes the server resolves; and
 * it produces byte-identical output for identical input, so a demo rehearses
 * exactly as it will run.
 *
 * What it cannot do is understand. It matches words, not meaning — see the
 * limitations noted on the assessment path.
 */
export class DemoAIProvider implements AIProvider {
  readonly id = "demo";
  readonly label = "Deterministic source extraction (no model)";
  readonly kind = "deterministic" as const;

  async generateRecap(
    request: RecapRequest,
  ): Promise<GenerationResult<RecapOutput>> {
    const corpus = indexCorpus(request.corpus);

    // Nothing to quote and nothing to cite: the caller treats this exactly as it
    // treats a failed generation, and the material is already unprocessable.
    if (!corpus.usable || corpus.topics.length === 0) {
      return failed("unresolvable_citation");
    }

    return generated(buildRecap(corpus, request.profile));
  }

  async generateQuizPool(
    request: QuizPoolRequest,
  ): Promise<GenerationResult<QuizPoolOutput>> {
    const corpus = indexCorpus(request.corpus);

    if (!corpus.usable || corpus.topics.length === 0) {
      return failed("unresolvable_citation");
    }

    const pool = buildQuizPool(corpus, {
      difficulties: request.difficulties,
      itemsPerDifficulty: request.itemsPerDifficulty,
    });

    // An empty pool is a failure, not an empty success: the caller must be able
    // to mark `poolStatus: unavailable` rather than persist nothing silently.
    if (pool.items.length === 0) return failed("unresolvable_citation");

    return generated(pool);
  }

  async clarifyMisconception(
    request: ClarificationRequest,
  ): Promise<GenerationResult<ClarificationOutput>> {
    const corpus = indexCorpus(request.corpus);
    const clarification = buildClarification(corpus, request.misconception);

    if (!clarification) return failed("unresolvable_citation");

    return generated(clarification);
  }

  async validatePeerExplanation(
    request: AssessmentRequest,
  ): Promise<GenerationResult<AssessmentOutput>> {
    const corpus = indexCorpus(request.corpus);
    const assessment = assessExplanation(corpus, request.explanation);

    // With no source to check against, the Validation_Status stays Pending —
    // which is what a failed result means to the caller.
    if (!assessment) return failed("unresolvable_citation");

    return generated(assessment);
  }
}
