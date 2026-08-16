import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { AppError } from "@/lib/http/errors";
import { assertLearnerInSession, getSession } from "@/lib/repo/session";

/**
 * The lightweight identity model.
 *
 * There is no password, no email and no identity provider. A Learner presents an
 * opaque `x-learner-id` that only means anything inside one Class_Session; an
 * Instructor presents an `x-instructor-token` that is compared against a hash.
 * That is the whole of authentication in this product.
 */

export const LEARNER_HEADER = "x-learner-id";
export const INSTRUCTOR_HEADER = "x-instructor-token";

// ---------------------------------------------------------------------------
// Minting and hashing
// ---------------------------------------------------------------------------

/**
 * A random 128-bit Learner_Id.
 *
 * It carries no personal data and is not derived from the Display_Name, so it
 * cannot identify a person outside the Class_Session it was issued for.
 */
export function newLearnerId(): string {
  return randomBytes(16).toString("hex");
}

/** A random 256-bit Instructor token, returned to the Instructor exactly once. */
export function newInstructorToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The stored form of an Instructor token.
 *
 * SHA-256 with no salt is deliberate and sufficient here: the input is 256 bits
 * of machine-generated randomness, so there is no dictionary to attack and no
 * password reuse to protect. Salting would only defeat rainbow tables, which
 * cannot exist for this input.
 */
export function hashInstructorToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of a presented token against a stored hash.
 *
 * Both sides are hashed first, so the compared buffers are always 32 bytes and
 * the comparison time reveals nothing about how much of the token matched.
 */
export function verifyInstructorToken(token: string, storedHash: string): boolean {
  const presented = Buffer.from(hashInstructorToken(token), "hex");

  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }

  if (stored.length !== presented.length) return false;

  return timingSafeEqual(presented, stored);
}

// ---------------------------------------------------------------------------
// Request authorisation
// ---------------------------------------------------------------------------

function header(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.trim();
  return value ? value : null;
}

/**
 * Requires a Learner who belongs to this Class_Session, returning the
 * Learner_Id.
 *
 * Membership is the existence of `LEARNER#<lid>` inside the session's partition,
 * so a Learner_Id issued for another Class_Session simply is not found.
 */
export async function requireLearner(
  request: Request,
  sessionId: string,
): Promise<string> {
  const learnerId = header(request, LEARNER_HEADER);

  if (!learnerId) {
    throw new AppError(
      "LEARNER_NOT_IN_SESSION",
      "Join the class before making this request.",
    );
  }

  const isMember = await assertLearnerInSession(sessionId, learnerId);
  if (!isMember) {
    throw new AppError(
      "LEARNER_NOT_IN_SESSION",
      "This learner is not part of this class session.",
    );
  }

  return learnerId;
}

/** Requires a valid Instructor token for this Class_Session. */
export async function requireInstructor(
  request: Request,
  sessionId: string,
): Promise<void> {
  const token = header(request, INSTRUCTOR_HEADER);

  const denied = new AppError(
    "INSTRUCTOR_TOKEN_REQUIRED",
    "A valid instructor token is required for this action.",
  );

  if (!token) throw denied;

  const session = await getSession(sessionId);
  if (!session) throw denied;

  if (!verifyInstructorToken(token, session.instructorTokenHash)) throw denied;
}

/**
 * Requires the caller to be the owning Learner of a learner-scoped resource.
 *
 * A mismatch is a 403 whose body carries no part of the resource, so a wrong
 * Learner_Id cannot be used to probe another Learner's results.
 */
export function requireOwner(callerLearnerId: string, ownerLearnerId: string): void {
  if (callerLearnerId !== ownerLearnerId) {
    throw new AppError("NOT_YOUR_REPORT", "This result belongs to another learner.");
  }
}

/**
 * Requires either a Learner of the Class_Session or its Instructor — the rule
 * for class-level reads, which return no per-learner data to either caller.
 */
export async function requireSessionMember(
  request: Request,
  sessionId: string,
): Promise<{ learnerId: string | null; isInstructor: boolean }> {
  if (header(request, INSTRUCTOR_HEADER)) {
    await requireInstructor(request, sessionId);
    return { learnerId: null, isInstructor: true };
  }

  const learnerId = await requireLearner(request, sessionId);
  return { learnerId, isInstructor: false };
}
