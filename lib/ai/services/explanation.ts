import "server-only";

import { randomUUID } from "node:crypto";

import { getAIProvider } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai/provider";
import { resolveRefs } from "@/lib/ai/resolve";
import { logFallback } from "@/lib/aws/logger";
import {
  claimValidation,
  findExplanationById,
  listThread,
  putExplanation,
  resolveValidation,
} from "@/lib/repo/explanation";
import { listSourceUnits, listTopics } from "@/lib/repo/material";
import type { PeerExplanation } from "@/lib/types";

/**
 * Peer_Explanation submission and validation.
 *
 * Submission and assessment are separate steps on purpose. The write persists
 * the explanation as `Pending` and returns immediately, so a Learner is never
 * left waiting on generation; the assessment then runs as its own request and
 * writes the outcome.
 *
 * An explanation is retained whatever the outcome. Validation decides how it is
 * *labelled*, never whether it is kept, and a failed assessment leaves it
 * `Pending` rather than quietly marking it supported.
 */

const TASK = "assess";
/** How long an assessment may sit unclaimed before a reader retries it. */
const STALE_AFTER_MS = 5000;

export interface SubmitInput {
  sessionId: string;
  materialVersion: number;
  topicId: string;
  learnerId: string;
  displayName: string;
  text: string;
  now?: () => string;
}

/**
 * Persists a Peer_Explanation in its terminal-safe `Pending` state.
 *
 * The text has already been validated for length by the handler; this only
 * writes it.
 */
export async function submitExplanation(
  input: SubmitInput,
): Promise<PeerExplanation> {
  const explanation: PeerExplanation = {
    explanationId: randomUUID().replace(/-/g, ""),
    topicId: input.topicId,
    learnerId: input.learnerId,
    displayName: input.displayName,
    text: input.text,
    status: "Pending",
    attempts: 0,
    submittedAt: (input.now ?? (() => new Date().toISOString()))(),
  };

  await putExplanation(input.sessionId, explanation);

  return explanation;
}

export interface ValidateInput {
  sessionId: string;
  materialVersion: number;
  explanationId: string;
  provider?: AIProvider;
  requestId?: string;
}

export interface ValidateResult {
  explanation: PeerExplanation;
  /** True when this call performed the assessment rather than finding it done. */
  assessed: boolean;
  degraded: string[];
}

/**
 * Assesses one Peer_Explanation against the Source_Text and records the verdict.
 *
 * The claim is conditional on `attempts` still being zero, so two readers
 * arriving together cannot both pay for the same assessment — the loser simply
 * returns what is already stored.
 */
export async function validateExplanation(
  input: ValidateInput,
): Promise<ValidateResult | null> {
  const existing = await findExplanationById(input.sessionId, input.explanationId);
  if (!existing) return null;

  // Already assessed: nothing to redo.
  if (existing.status !== "Pending") {
    return { explanation: existing, assessed: false, degraded: [] };
  }

  const key = {
    topicId: existing.topicId,
    submittedAt: existing.submittedAt,
    explanationId: existing.explanationId,
  };

  const claimed = await claimValidation(input.sessionId, key);
  if (!claimed) {
    // Another request holds the claim. Report the current state rather than
    // assessing the same text twice.
    return { explanation: existing, assessed: false, degraded: [] };
  }

  const [units, topics] = await Promise.all([
    listSourceUnits(input.sessionId, input.materialVersion),
    listTopics(input.sessionId, input.materialVersion),
  ]);

  const provider = input.provider ?? getAIProvider();

  const result = await provider.validatePeerExplanation({
    context: {
      sessionId: input.sessionId,
      materialVersion: input.materialVersion,
      requestId: input.requestId,
    },
    corpus: { units, topics },
    explanation: { topicId: existing.topicId, text: existing.text },
  });

  if (!result.ok) {
    logFallback({
      task: TASK,
      classSessionId: input.sessionId,
      materialVersion: input.materialVersion,
      reason: result.reason,
      attempts: 1,
      requestId: input.requestId ?? "unknown",
    });

    // The status stays Pending, which the UI renders as "checking" rather than
    // as any kind of verdict.
    return { explanation: existing, assessed: false, degraded: [TASK] };
  }

  const assessment = result.value;
  const { refs } = resolveRefs(assessment.unitIdxs, units);

  // `Validated` requires a citation that actually resolves. Without one the
  // claim is unverifiable, so it is recorded as unsupported instead.
  const status =
    assessment.status === "Validated" && refs.length === 0
      ? "Unsupported"
      : assessment.status;

  const reason =
    status === "Validated"
      ? undefined
      : (assessment.reason ??
        "The lecture material does not support this explanation.");

  await resolveValidation(input.sessionId, key, {
    status,
    sourceRef: status === "Validated" ? refs[0] : undefined,
    reason,
  });

  return {
    explanation: {
      ...existing,
      status,
      sourceRef: status === "Validated" ? refs[0] : undefined,
      reason,
      attempts: existing.attempts + 1,
    },
    assessed: true,
    degraded: [],
  };
}

/**
 * A Study_Thread, healing any explanation left stranded as `Pending`.
 *
 * If a submission's assessment never ran — the tab closed, the request was
 * dropped — the next reader completes it. That keeps a stranded explanation
 * from sitting unlabelled forever without needing a background worker.
 */
export async function getThread(input: {
  sessionId: string;
  materialVersion: number;
  topicId: string;
  provider?: AIProvider;
  requestId?: string;
  now?: () => number;
}): Promise<{ explanations: PeerExplanation[]; degraded: string[] }> {
  const explanations = await listThread(input.sessionId, input.topicId);
  const now = (input.now ?? (() => Date.now()))();
  const degraded = new Set<string>();

  const stranded = explanations.filter(
    (explanation) =>
      explanation.status === "Pending" &&
      explanation.attempts === 0 &&
      now - Date.parse(explanation.submittedAt) > STALE_AFTER_MS,
  );

  if (stranded.length === 0) return { explanations, degraded: [] };

  const healed = new Map<string, PeerExplanation>();

  for (const explanation of stranded) {
    const result = await validateExplanation({
      sessionId: input.sessionId,
      materialVersion: input.materialVersion,
      explanationId: explanation.explanationId,
      provider: input.provider,
      requestId: input.requestId,
    });

    if (!result) continue;

    healed.set(explanation.explanationId, result.explanation);
    for (const task of result.degraded) degraded.add(task);
  }

  return {
    explanations: explanations.map(
      (explanation) => healed.get(explanation.explanationId) ?? explanation,
    ),
    degraded: [...degraded],
  };
}
