import type {
  DifficultyLevel,
  ExplanationStyle,
  SourceUnit,
  Topic,
  UnderstandingLevel,
} from "@/lib/types";

/**
 * The generation provider contract.
 *
 * Everything that produces natural language sits behind this interface, so the
 * rest of the system — routes, repositories, domain arithmetic — never learns
 * which provider is in use. Swapping in a hosted model later means writing one
 * new class, not editing a route.
 *
 * Three properties make that swap safe rather than merely possible:
 *
 * 1. **Citations are unit indexes, never references.** A provider returns
 *    integers; the server resolves each one against the persisted source units
 *    and rejects anything out of range. A provider therefore cannot fabricate a
 *    citation, whatever it is — a model, a template engine, or a bug.
 * 2. **The shapes are the schemas already declared in the design.** These types
 *    mirror the recap, pool, clarification and assessment schemas field for
 *    field, so a hosted provider validating its JSON against those schemas
 *    produces exactly these objects.
 * 3. **Failure is a value, not an exception.** Every method resolves to a
 *    discriminated result, so a caller must handle degradation explicitly and
 *    Fallback_Mode stays a first-class path rather than a catch block.
 *
 * What is deliberately *not* here: scoring, mastery, class aggregation,
 * misconception candidate selection, difficulty transitions and item selection.
 * Those are deterministic arithmetic and live in `lib/domain/`, where no
 * provider can influence them.
 */

/**
 * Why a generation attempt failed, drawn from a closed set so one log field can
 * be filtered. Provider-agnostic: these are the failure modes of any generation
 * call, hosted or local.
 */
export type GenerationFailureReason =
  | "timeout"
  | "throttled"
  | "access_denied"
  | "transport"
  | "schema_invalid_after_repair"
  | "unresolvable_citation"
  | "provider_unavailable";

export type GenerationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: GenerationFailureReason };

export function generated<T>(value: T): GenerationResult<T> {
  return { ok: true, value };
}

export function failed<T>(reason: GenerationFailureReason): GenerationResult<T> {
  return { ok: false, reason };
}

// ---------------------------------------------------------------------------
// Shared inputs
// ---------------------------------------------------------------------------

/** Which Class_Session and material version a request belongs to. */
export interface GenerationContext {
  sessionId: string;
  materialVersion: number;
  /** Correlates a failure with its log record. */
  requestId?: string;
}

/**
 * The whole of what a provider may draw on.
 *
 * Every request carries the source units, and a provider must derive its output
 * only from them. This is the structural half of the grounding rule: nothing
 * else is passed in, so there is nothing else to answer from.
 */
export interface SourceCorpus {
  units: readonly SourceUnit[];
  topics: readonly Topic[];
}

// ---------------------------------------------------------------------------
// Recap
// ---------------------------------------------------------------------------

export interface LearnerProfileInput {
  understandingLevel: UnderstandingLevel;
  explanationStyle: ExplanationStyle;
}

export interface RecapRequest {
  context: GenerationContext;
  corpus: SourceCorpus;
  profile: LearnerProfileInput;
}

/** The structured artefact accompanying a Visual_Structured section. */
export interface ArtefactOutput {
  kind: "none" | "table" | "pipeline" | "mermaid";
  content: string;
}

export interface RecapSectionOutput {
  topicId: string;
  /** False when the source does not cover the Topic — reported, never filled in. */
  covered: boolean;
  body: string;
  /** The prose form of the same content; required whenever an artefact is present. */
  proseBody: string;
  artefact: ArtefactOutput;
  /** Citations, as source unit indexes for the server to resolve. */
  unitIdxs: number[];
}

export interface RecapOutput {
  /** 3–7 single-sentence Key_Takeaways. */
  takeaways: string[];
  /** One section per Topic, in Topic order. */
  sections: RecapSectionOutput[];
}

// ---------------------------------------------------------------------------
// Quiz_Pool
// ---------------------------------------------------------------------------

export interface QuizPoolRequest {
  context: GenerationContext;
  corpus: SourceCorpus;
  /** Levels to generate for; omit for all three. Used by level-scoped retries. */
  difficulties?: readonly DifficultyLevel[];
  /** How many items to aim for per level. */
  itemsPerDifficulty?: number;
}

/**
 * A candidate Answer_Option.
 *
 * There is no option id: ids are assigned when the Quiz_Item is persisted, so a
 * provider cannot influence the identifiers the rest of the system keys on.
 */
export interface QuizOptionOutput {
  text: string;
  isCorrect: boolean;
  /** Names the mistaken belief a Distractor represents; null on the correct option. */
  misconceptionLabel: string | null;
}

export interface QuizItemOutput {
  topicId: string;
  difficulty: DifficultyLevel;
  stem: string;
  /** Exactly four, exactly one correct — enforced by the server's validator. */
  options: QuizOptionOutput[];
  unitIdx: number;
}

export interface QuizPoolOutput {
  items: QuizItemOutput[];
}

// ---------------------------------------------------------------------------
// Misconception clarification
// ---------------------------------------------------------------------------

/** The Quiz_Item and Distractor a clarification is requested for. */
export interface MisconceptionInput {
  quizItemId: string;
  topicId: string;
  stem: string;
  correctOptionText: string;
  distractorText: string;
  misconceptionLabel: string;
  unitIdx: number;
}

export interface ClarificationRequest {
  context: GenerationContext;
  corpus: SourceCorpus;
  misconception: MisconceptionInput;
}

export interface ClarificationOutput {
  /** States the correct position; at most 400 characters. */
  clarification: string;
  unitIdx: number;
}

// ---------------------------------------------------------------------------
// Peer_Explanation assessment
// ---------------------------------------------------------------------------

export interface PeerExplanationInput {
  topicId: string;
  /** Learner-supplied text. Untrusted: it is data to be assessed, never instruction. */
  text: string;
}

export interface AssessmentRequest {
  context: GenerationContext;
  corpus: SourceCorpus;
  explanation: PeerExplanationInput;
}

/**
 * The assessment outcome.
 *
 * `Pending` is absent by design: it is a persistence state meaning "not yet
 * assessed", so a provider returning it would be meaningless. Precedence when a
 * text both conflicts and overreaches is Contradicted > Unsupported > Validated.
 */
export interface AssessmentOutput {
  status: "Validated" | "Unsupported" | "Contradicted";
  /** Supporting units; at least one is required for `Validated`. */
  unitIdxs: number[];
  /** 1–300 characters for `Unsupported` and `Contradicted`; null for `Validated`. */
  reason: string | null;
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

/**
 * How a provider produces its output.
 *
 * `deterministic` means the output is derived from the source text by fixed
 * rules; `generative` means a language model produced it. The distinction is
 * carried so the interface can state plainly what is behind it, and so nothing
 * built on it can describe rule-based extraction as machine learning.
 */
export type ProviderKind = "deterministic" | "generative";

export interface AIProvider {
  /** Stable identifier, e.g. `demo`. Appears in logs. */
  readonly id: string;
  /** Human-readable description, suitable for display. */
  readonly label: string;
  readonly kind: ProviderKind;

  generateRecap(request: RecapRequest): Promise<GenerationResult<RecapOutput>>;

  generateQuizPool(
    request: QuizPoolRequest,
  ): Promise<GenerationResult<QuizPoolOutput>>;

  clarifyMisconception(
    request: ClarificationRequest,
  ): Promise<GenerationResult<ClarificationOutput>>;

  validatePeerExplanation(
    request: AssessmentRequest,
  ): Promise<GenerationResult<AssessmentOutput>>;
}
