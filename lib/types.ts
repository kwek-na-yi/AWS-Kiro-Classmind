/**
 * Shared domain types for ClassMind.
 *
 * This module is the single declaration of the glossary entities and the enum
 * sets from requirements.md. Domain functions (`lib/domain/`), repositories
 * (`lib/repo/`), generation tasks (`lib/bedrock/`) and Route Handlers all speak
 * these shapes, so no layer can drift on a field name or an allowed value.
 *
 * It contains types and closed value sets only — no I/O, no arithmetic, no
 * AWS import — so every other layer can depend on it without a cycle.
 *
 * Persisted entities are modelled as the *domain* objects repositories return,
 * not as raw DynamoDB items: the `PK`/`SK` strings live in `lib/repo/keys.ts`
 * and the client-facing shapes are produced by the pipeline's projection stage.
 */

// ---------------------------------------------------------------------------
// Enum sets
//
// Each set is declared once as a readonly tuple and its union type derived from
// it, so runtime membership validation (lib/domain/validate-input.ts) and the
// compile-time union can never disagree.
// ---------------------------------------------------------------------------

/** Requirements glossary: {No_Understanding, Basic_Understanding, Strong_Understanding}. */
export const UNDERSTANDING_LEVELS = [
  "No_Understanding",
  "Basic_Understanding",
  "Strong_Understanding",
] as const;

export type UnderstandingLevel = (typeof UNDERSTANDING_LEVELS)[number];

/** Requirements glossary: {Concise, Detailed, Examples, Step_By_Step, Visual_Structured}. */
export const EXPLANATION_STYLES = [
  "Concise",
  "Detailed",
  "Examples",
  "Step_By_Step",
  "Visual_Structured",
] as const;

export type ExplanationStyle = (typeof EXPLANATION_STYLES)[number];

/** 1 is foundational, 2 intermediate, 3 advanced. */
export type DifficultyLevel = 1 | 2 | 3;

export const DIFFICULTY_LEVELS: readonly DifficultyLevel[] = [1, 2, 3];

/** Requirements glossary: {Pending, Validated, Unsupported, Contradicted}. */
export const VALIDATION_STATUSES = [
  "Pending",
  "Validated",
  "Unsupported",
  "Contradicted",
] as const;

export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Source grounding
// ---------------------------------------------------------------------------

/**
 * A pointer into the Source_Text supporting a generated statement: a page for
 * PDF material, a section or a line range for TXT and Markdown material.
 * Values are display-ready, e.g. `p. 7`, `§ Backpropagation`, `lines 81–120`.
 */
export interface SourceRef {
  kind: "page" | "section" | "lines";
  value: string;
}

// ---------------------------------------------------------------------------
// Class_Session, Lecture_Material and the extracted structure
// ---------------------------------------------------------------------------

/** Named stages reported while a Lecture_Material is processed (Req 2.6). */
export type ProcessingStage =
  | "Storing material"
  | "Extracting text"
  | "Identifying topics"
  | "Generating quiz";

export type MaterialStatus = "processing" | "ready" | "unprocessable";

export type PoolStatus = "pending" | "ready" | "unavailable";

/** The accepted Lecture_Material file extensions (Req 2.2). */
export const MATERIAL_EXTENSIONS = ["pdf", "txt", "md", "markdown"] as const;

export type MaterialExtension = (typeof MATERIAL_EXTENSIONS)[number];

/**
 * The container that owns one Lecture_Material, one Quiz_Pool, every
 * Quiz_Session and all Study_Space content.
 *
 * `instructorTokenHash` is server-only: the Instructor token is returned once at
 * creation and stored only as a hash, and the projection stage strips this field
 * before any response leaves a handler (Req 16.5).
 */
export interface ClassSession {
  sessionId: string;
  name: string;
  joinCode: string;
  instructorTokenHash: string;
  materialVersion: number;
  isDemo: boolean;
  createdAt: string;
}

export interface LectureMaterial {
  sessionId: string;
  version: number;
  s3Key: string;
  filename: string;
  ext: MaterialExtension;
  bytes: number;
  status: MaterialStatus;
  stage: ProcessingStage;
  charCount: number;
  unitCount: number;
  poolStatus: PoolStatus;
}

/**
 * One numbered chunk of Source_Text. `index` is the stable citation target:
 * every generation task cites unit indexes and only `lib/bedrock/resolve.ts`
 * turns an index back into a `SourceRef`.
 */
export interface SourceUnit {
  materialVersion: number;
  index: number;
  text: string;
  ref: SourceRef;
}

/** A named subject area derived from the Source_Text (3–8 per Class_Session). */
export interface Topic {
  topicId: string;
  materialVersion: number;
  /** Zero-based position, giving the stable Topic ordering used everywhere. */
  order: number;
  name: string;
  unitIdxs: number[];
}

// ---------------------------------------------------------------------------
// Learner identity and profile
// ---------------------------------------------------------------------------

/** A Learner within one Class_Session. `learnerId` carries no personal data. */
export interface Learner {
  learnerId: string;
  displayName: string;
  isSeeded: boolean;
  createdAt: string;
}

/** The Understanding_Level and Explanation_Style pair for one Learner. */
export interface LearnerProfile {
  learnerId: string;
  understandingLevel: UnderstandingLevel;
  explanationStyle: ExplanationStyle;
}

// ---------------------------------------------------------------------------
// Recap
// ---------------------------------------------------------------------------

/**
 * The Visual_Structured artefact of a Recap_Section (Req 4.12, 4.13). `prose` is
 * the persisted prose form of the same content, rendered when Mermaid fails to
 * parse and always shown alongside a table or pipeline.
 */
export interface StructuredArtefact {
  kind: "table" | "pipeline" | "mermaid";
  content: string;
  prose: string;
}

/** One Topic-scoped part of a Recap. */
export interface RecapSection {
  topicId: string;
  topicName: string;
  body: string;
  sourceRefs: SourceRef[];
  /** True when no Source_Reference resolved; the section is kept and badged (Req 4.15). */
  unverified: boolean;
  /** Present only for the Visual_Structured Explanation_Style. */
  artefact?: StructuredArtefact;
  /** True when the Source_Text does not cover the Topic, rather than filling it in (Req 4.14). */
  uncovered?: boolean;
  /** A failed style post-check downgrades to a warning instead of discarding (Req 4.8–4.12). */
  styleWarning?: string;
}

/**
 * A structured summary generated for one Learner_Profile. `mode` is
 * `source_extract` when the Recap is the Fallback_Mode response built from
 * verbatim source units rather than a generated Recap (Req 12.3, 12.12).
 */
export interface Recap {
  sessionId: string;
  materialVersion: number;
  understandingLevel: UnderstandingLevel;
  explanationStyle: ExplanationStyle;
  mode: "generated" | "source_extract";
  takeaways: string[];
  sections: RecapSection[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Quiz_Pool and Quiz_Session
// ---------------------------------------------------------------------------

/**
 * One selectable answer. An incorrect Answer_Option is a Distractor and carries
 * a Misconception_Label naming the mistaken belief it represents.
 *
 * `isCorrect` and `misconceptionLabel` are server-only: the next-item response
 * projects options down to `optionId` and `text` (Req 6.3).
 */
export interface AnswerOption {
  optionId: string;
  text: string;
  isCorrect: boolean;
  /** Required on every Distractor, absent on the correct Answer_Option. */
  misconceptionLabel?: string;
}

/**
 * A multiple-choice question. Exactly 4 Answer_Options with exactly 1 correct
 * option is a retention condition enforced by the pool validator, not by this
 * type — a candidate item is parsed before it is known to be well-formed.
 */
export interface QuizItem {
  quizItemId: string;
  materialVersion: number;
  topicId: string;
  difficulty: DifficultyLevel;
  stem: string;
  options: AnswerOption[];
  unitIdx: number;
  sourceRef: SourceRef;
}

/** The kind of the current consecutive-response run (design.md Section 12). */
export type RunKind = "none" | "correct" | "incorrect";

export type QuizSessionStatus = "in_progress" | "closed";

/**
 * One Learner's pass through a fixed number of Quiz_Items.
 *
 * `currentDifficulty`, `runKind` and `runLen` are a cache of the fold over the
 * persisted Quiz_Responses; `replay` in `lib/domain/difficulty.ts` remains the
 * only source of truth (Req 6.8).
 */
export interface QuizSession {
  quizSessionId: string;
  learnerId: string;
  currentDifficulty: DifficultyLevel;
  runKind: RunKind;
  runLen: 0 | 1;
  servedItemIds: string[];
  answeredItemIds: string[];
  status: QuizSessionStatus;
  length: number;
  startedAt: string;
}

/** One Learner's answer to one Quiz_Item within a Quiz_Session. */
export interface QuizResponse {
  quizSessionId: string;
  /** Submission order within the Quiz_Session, starting at 1. */
  seq: number;
  learnerId: string;
  quizItemId: string;
  topicId: string;
  optionId: string;
  isCorrect: boolean;
  difficultyServed: DifficultyLevel;
  submittedAt: string;
}

// ---------------------------------------------------------------------------
// Understanding_Report
// ---------------------------------------------------------------------------

/**
 * The per-Learner result produced when a Quiz_Session closes.
 *
 * `topicMastery` maps a `topicId` to a Topic_Mastery percentage rounded half-up
 * to the nearest integer; `weakTopics` holds the topicIds below 60 percent.
 * `guidanceMode` is `unavailable` when next-step guidance entered Fallback_Mode,
 * in which case the computed numbers are still returned (Req 12.6).
 */
export interface UnderstandingReport {
  learnerId: string;
  quizSessionId: string;
  topicMastery: Record<string, number>;
  weakTopics: string[];
  /** Null when no Quiz_Response was correct. */
  highestCorrectDifficulty: DifficultyLevel | null;
  guidance: string[];
  guidanceMode: "generated" | "unavailable";
}

// ---------------------------------------------------------------------------
// Study_Space and misconceptions
// ---------------------------------------------------------------------------

/**
 * A Learner contribution to a Study_Thread. Every Peer_Explanation is retained
 * whatever its Validation_Status (Req 11.10); only `Validated` ones may appear
 * in Recommended_Explanations (Req 11.7).
 */
export interface PeerExplanation {
  explanationId: string;
  topicId: string;
  learnerId: string;
  displayName: string;
  text: string;
  status: ValidationStatus;
  /** Persisted when the status is `Validated` (Req 11.5). */
  sourceRef?: SourceRef;
  /** 1–300 characters, persisted when the status is `Unsupported` or `Contradicted` (Req 11.6). */
  reason?: string;
  attempts: number;
  submittedAt: string;
}

/**
 * A frequently selected Distractor that qualifies as a shared misconception,
 * produced by the pure selection step before any clarification is generated.
 */
export interface MisconceptionCandidate {
  quizItemId: string;
  topicId: string;
  optionId: string;
  misconceptionLabel: string;
  /** Quiz_Responses selecting this Distractor. */
  selCount: number;
  /** Quiz_Responses for the Quiz_Item, the denominator of `share`. */
  itemResponses: number;
  /** `round_half_up(100 × selCount / itemResponses)`. */
  share: number;
}
