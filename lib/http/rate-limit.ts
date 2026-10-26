import "server-only";

import { createHash } from "node:crypto";

import { isPublicDemo } from "@/lib/demo/public";
import { AppError } from "@/lib/http/errors";
import { postgresStore } from "@/lib/store";
import { usesPostgres } from "@/lib/target";

/**
 * Fixed-window rate limits for the public demo.
 *
 * Only active in public-demo mode: locally there is one user and limits would
 * only obstruct testing. On the `postgres` target the counters live in the
 * database, so the limit holds across every serverless instance; otherwise they
 * are kept in process memory.
 *
 * Callers are identified by a truncated SHA-256 of their IP address, so no raw
 * address is stored.
 */

export interface Limit {
  /** Names the action, e.g. `join`. */
  name: string;
  /** Allowed hits per window. */
  max: number;
  windowSeconds: number;
  /** One shared budget for everyone, rather than one per caller. */
  global?: boolean;
}

/** The limits each action is subject to. */
export const LIMITS = {
  join: [{ name: "join", max: 30, windowSeconds: 600 }],
  quiz: [{ name: "quiz", max: 40, windowSeconds: 3600 }],
  explanation: [{ name: "explanation", max: 20, windowSeconds: 3600 }],
  upload: [
    { name: "upload", max: 5, windowSeconds: 3600 },
    // A ceiling on what the whole internet can add to the database per day.
    { name: "upload", max: 40, windowSeconds: 86_400, global: true },
  ],
} satisfies Record<string, Limit[]>;

const memory = new Map<string, { count: number; expiresAt: number }>();

function memoryHit(bucket: string, windowSeconds: number): number {
  const now = Date.now();
  const current = memory.get(bucket);
  if (!current || current.expiresAt <= now) {
    memory.set(bucket, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return 1;
  }
  current.count += 1;
  return current.count;
}

/** The caller's address as the platform reports it. */
export function clientAddress(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

function callerId(request: Request): string {
  return createHash("sha256").update(clientAddress(request)).digest("hex").slice(0, 24);
}

/** Counts this request against `limits`, throwing RATE_LIMITED when one is exceeded. */
export async function enforceRateLimit(request: Request, limits: readonly Limit[]): Promise<void> {
  if (!isPublicDemo()) return;

  const caller = callerId(request);

  for (const limit of limits) {
    const window = Math.floor(Date.now() / 1000 / limit.windowSeconds);
    const bucket = `${limit.name}:${limit.global ? "all" : caller}:${limit.windowSeconds}:${window}`;

    const count = usesPostgres()
      ? await (await postgresStore()).hit(bucket, limit.windowSeconds)
      : memoryHit(bucket, limit.windowSeconds);

    if (count > limit.max) {
      throw new AppError(
        "RATE_LIMITED",
        limit.global
          ? "The public demo has reached today's limit for this action. Please try again tomorrow."
          : "Too many requests from your connection. Please wait a few minutes and try again.",
      );
    }
  }
}

/** Test seam. */
export function resetMemoryRateLimits(): void {
  memory.clear();
}

/**
 * Forgets every counter. The demo reset calls this: a reset returns the demo to
 * a clean state, and the daily one also renews every visitor's budget.
 */
export async function clearRateLimits(): Promise<void> {
  memory.clear();
  if (usesPostgres()) await (await postgresStore()).clearRateLimits();
}
