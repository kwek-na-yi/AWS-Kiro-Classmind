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

export function learnerKey(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

export function readLearnerId(sessionId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(learnerKey(sessionId));
}

export function writeLearnerId(sessionId: string, learnerId: string): void {
  window.localStorage.setItem(learnerKey(sessionId), learnerId);
}

export interface LearnerIdentity {
  learnerId: string | null;
  /** False until local storage has been read, so the UI can avoid flashing. */
  ready: boolean;
}

/**
 * Subscribes to local storage. Only cross-tab writes raise `storage`, which is
 * enough here: this session's own writes happen on the join page, immediately
 * before navigating away.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
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

/** The header every learner-authenticated request carries. */
export function learnerHeaders(learnerId: string): HeadersInit {
  return { "content-type": "application/json", "x-learner-id": learnerId };
}
