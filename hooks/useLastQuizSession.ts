"use client";

import { useSyncExternalStore } from "react";

/**
 * The most recent Quiz_Session this Learner completed in a class.
 *
 * Remembered in local storage purely so views can look up a report the Learner
 * already has: the Recap uses it to mark the Topics that came out weak last
 * time. It holds no result data itself — only the id needed to ask the existing
 * report endpoint, which still checks ownership.
 */

const KEY_PREFIX = "classmind:lastquiz:";

function key(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

export function readLastQuizSession(sessionId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key(sessionId));
}

export function writeLastQuizSession(sessionId: string, quizSessionId: string): void {
  window.localStorage.setItem(key(sessionId), quizSessionId);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Reads the stored id without copying it into state via an effect. */
export function useLastQuizSession(sessionId: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readLastQuizSession(sessionId),
    () => null,
  );
}
