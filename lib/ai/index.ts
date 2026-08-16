import "server-only";

import { DemoAIProvider } from "@/lib/ai/demo/provider";
import type { AIProvider } from "@/lib/ai/provider";

/**
 * Provider resolution.
 *
 * One place decides which provider the application uses, so adding a hosted
 * provider later is a change here and nowhere else — no route, repository or
 * domain module names a provider.
 *
 * Today there is one: the deterministic demo provider, which needs no API key,
 * no credential and no network. When a hosted provider is chosen it registers
 * here, and the demo provider stays as the Fallback_Mode path — which is where
 * a deterministic, always-available generator is most useful anyway.
 */

let provider: AIProvider | undefined;

export function getAIProvider(): AIProvider {
  provider ??= new DemoAIProvider();
  return provider;
}

/** Overrides the active provider. Intended for tests and for future wiring. */
export function setAIProvider(next: AIProvider): void {
  provider = next;
}

export function resetAIProvider(): void {
  provider = undefined;
}

export type { AIProvider } from "@/lib/ai/provider";
