"use client";

import { useSyncExternalStore } from "react";

/**
 * The Learner_Id for one Class_Session, held in local storage.
 *
 * There is no account and no password: joining a class mints an opaque
 * identifier scoped to that session, and every later request carries it. A
 * Learner returning to a session they have already joined reuses the stored
 * value rather than becoming a second Learner.
 */

const KEY_PREFIX = "classmind:learner:";
const NAME_PREFIX = "classmind:name:";
const CODE_PREFIX = "classmind:joincode:";

export function learnerKey(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

/**
 * The Display_Name, kept alongside the id purely so the sidebar can greet the
 * Learner. It is the same name they typed on joining and is never sent anywhere
 * — the server already holds its own copy.
 */
export function readDisplayName(sessionId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`${NAME_PREFIX}${sessionId}`);
}

export function writeDisplayName(sessionId: string, displayName: string): void {
  window.localStorage.setItem(`${NAME_PREFIX}${sessionId}`, displayName);
  emit();
}

/**
 * The Join_Code this Learner came in on.
 *
 * Kept because a Learner_Id can stop being valid — reseeding the demo class
 * deletes its Learners while the Class_Session itself keeps its id — and the
 * code plus the name is everything needed to be admitted again without
 * bothering the Learner about it. See `recoverLearner`.
 */
export function readJoinCode(sessionId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`${CODE_PREFIX}${sessionId}`);
}

export function writeJoinCode(sessionId: string, joinCode: string): void {
  window.localStorage.setItem(`${CODE_PREFIX}${sessionId}`, joinCode);
}

export function readLearnerId(sessionId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(learnerKey(sessionId));
}

export function writeLearnerId(sessionId: string, learnerId: string): void {
  window.localStorage.setItem(learnerKey(sessionId), learnerId);
  emit();
}

/** Drops a Learner_Id the server no longer recognises. */
export function forgetLearner(sessionId: string): void {
  window.localStorage.removeItem(learnerKey(sessionId));
  emit();
}

export interface LearnerIdentity {
  learnerId: string | null;
  /** False until local storage has been read, so the UI can avoid flashing. */
  ready: boolean;
}

/**
 * Subscribes to local storage.
 *
 * `storage` only fires for *other* tabs, so this tab's own writes are announced
 * through a local set of listeners as well. That matters for recovery: when a
 * stale Learner_Id is replaced mid-view, the components holding the old value
 * have to see the new one, or every later request would rejoin all over again.
 */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Reads the stored Learner_Id.
 *
 * Local storage is an external store, so it is read through
 * `useSyncExternalStore` rather than copied into state by an effect: the server
 * snapshot is "nothing yet", the client snapshot is the stored value, and React
 * handles the transition without a cascading render.
 */
export function useLearnerId(sessionId: string): LearnerIdentity {
  const learnerId = useSyncExternalStore(
    subscribe,
    () => readLearnerId(sessionId),
    () => null,
  );

  // False while rendering on the server and during hydration, so a view can
  // wait rather than flashing "join first" at a Learner who has already joined.
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return { learnerId, ready };
}

/** The stored Display_Name, read the same way. */
export function useDisplayName(sessionId: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readDisplayName(sessionId),
    () => null,
  );
}

/**
 * The header every learner-authenticated request carries. Declared here as
 * well as in `lib/http/auth.ts` because that module is server-only and a Client
 * Component cannot import it — the two names are asserted equal by the route
 * tests, which exercise the server side with this value.
 */
export const LEARNER_HEADER = "x-learner-id";

/** The headers a learner-authenticated JSON request carries. */
export function learnerHeaders(learnerId: string): HeadersInit {
  return { "content-type": "application/json", [LEARNER_HEADER]: learnerId };
}

// ---------------------------------------------------------------------------
// Recovering from a Learner_Id the server no longer knows
// ---------------------------------------------------------------------------

/**
 * The code a route returns when the presented Learner_Id is not a member of the
 * Class_Session. Declared here rather than imported because `lib/http/errors.ts`
 * is server-only; the string is asserted by the route tests.
 */
const NOT_IN_SESSION = "LEARNER_NOT_IN_SESSION";

/**
 * One recovery per Class_Session at a time.
 *
 * Several requests usually fail together — a view loads its insight and its
 * thread in parallel — and each rejoining separately would register a Learner
 * per request. They share the first attempt instead.
 */
const recovering = new Map<string, Promise<string | null>>();

/**
 * Trades a dead Learner_Id for a live one by rejoining on the stored Join_Code.
 *
 * Rejoining is not a privilege escalation: the Join_Code is what admits anyone
 * to this class in the first place, and the Learner already used it once. It
 * returns null when there is nothing to rejoin with, or when the code now
 * resolves to a different Class_Session.
 */
export async function recoverLearner(sessionId: string): Promise<string | null> {
  const inFlight = recovering.get(sessionId);
  if (inFlight) return inFlight;

  const attempt = rejoin(sessionId);
  recovering.set(sessionId, attempt);

  try {
    return await attempt;
  } finally {
    recovering.delete(sessionId);
  }
}

async function rejoin(sessionId: string): Promise<string | null> {
  const joinCode = readJoinCode(sessionId);
  const displayName = readDisplayName(sessionId);

  if (!joinCode || !displayName) return null;

  try {
    const response = await fetch("/api/sessions/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ joinCode, displayName }),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as { sessionId: string; learnerId: string };
    if (body.sessionId !== sessionId) return null;

    writeLearnerId(sessionId, body.learnerId);
    return body.learnerId;
  } catch {
    return null;
  }
}

function send(
  input: string,
  learnerId: string,
  init: RequestInit | undefined,
): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: { ...(init?.headers as Record<string, string>), ...learnerHeaders(learnerId) },
  });
}

/**
 * A learner-authenticated request that heals a stale Learner_Id instead of
 * surfacing it.
 *
 * A Learner_Id can outlive the Learner it names: reseeding the demo class
 * deletes every Learner in it while the Class_Session keeps its id, so the value
 * in local storage is suddenly a member of nothing. That is not a state worth
 * explaining to whoever is looking at the screen, so the request rejoins on the
 * stored Join_Code and is sent again. Every other response, including every
 * other 403, is returned untouched for the caller to handle.
 */
export async function learnerFetch(
  sessionId: string,
  learnerId: string,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await send(input, learnerId, init);
  if (response.status !== 403) return response;

  // Read the code from a clone, so the body the caller gets is still unread if
  // this turns out to be a 403 for some other reason.
  let code: string | undefined;
  try {
    const body = (await response.clone().json()) as { error?: { code?: string } };
    code = body.error?.code;
  } catch {
    code = undefined;
  }

  if (code !== NOT_IN_SESSION) return response;

  const fresh = await recoverLearner(sessionId);
  if (fresh) return send(input, fresh, init);

  // Nothing to rejoin with, so the identity is genuinely gone. Drop it and go
  // back to the join page. The promise is left unsettled on purpose: the caller
  // stays in its loading state for the moment the navigation takes, rather than
  // rendering an error the Learner would only see flash past.
  forgetLearner(sessionId);
  window.location.replace("/");

  return new Promise<never>(() => {});
}
