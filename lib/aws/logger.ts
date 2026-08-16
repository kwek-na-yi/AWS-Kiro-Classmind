import "server-only";

/**
 * The structured logger.
 *
 * Records are single-line JSON written with `console.error`, which the hosting
 * runtime forwards to CloudWatch Logs without an SDK call — no client, no IAM
 * statement, no failure mode of its own. One line per event so the demo team
 * can filter on a single field.
 *
 * Nothing here logs learner text, Display_Names or Source_Text: a log record
 * carries identifiers and reasons only.
 */

/**
 * Why a generation task failed. Declared by the AI layer, which owns the closed
 * set, and re-exported here because this is where it is written to the log.
 * Type-only, so the logger takes on no runtime dependency on that layer.
 */
import type { GenerationFailureReason } from "@/lib/ai/provider";

export type { GenerationFailureReason };

export interface FallbackRecord {
  /** The generation task that degraded, e.g. `recap`, `topics`, `pool`. */
  task: string;
  classSessionId: string;
  reason: GenerationFailureReason;
  attempts: number;
  requestId: string;
  materialVersion?: number;
}

export interface ErrorRecord {
  /** A short, stable name for what failed, e.g. `unhandled_error`. */
  event?: string;
  requestId: string;
  /** The thrown value. Only its name and message are recorded. */
  error: unknown;
  /** Any additional non-sensitive identifiers worth having in the log line. */
  context?: Record<string, string | number | boolean | undefined>;
}

function write(record: Record<string, unknown>): void {
  // One call, one line. `console.error` rather than `console.log` so the record
  // lands on the error stream in every hosting runtime.
  console.error(JSON.stringify(record));
}

/**
 * Records entry into Fallback_Mode for one generation task: which task, which
 * Class_Session, why, after how many attempts, and under which request id.
 */
export function logFallback(record: FallbackRecord): void {
  write({
    level: "error",
    event: "fallback_mode",
    task: record.task,
    classSessionId: record.classSessionId,
    materialVersion: record.materialVersion,
    reason: record.reason,
    attempts: record.attempts,
    requestId: record.requestId,
    ts: new Date().toISOString(),
  });
}

/** Records an unexpected failure. The message reaches the log, never the client. */
export function logError(record: ErrorRecord): void {
  const { error } = record;
  const isError = error instanceof Error;

  write({
    level: "error",
    event: record.event ?? "unhandled_error",
    requestId: record.requestId,
    errorName: isError ? error.name : typeof error,
    errorMessage: isError ? error.message : String(error),
    stack: isError ? error.stack : undefined,
    ...record.context,
    ts: new Date().toISOString(),
  });
}
