import { MATERIAL_MAX_BYTES } from "@/lib/domain/validate-input";
import { onServerlessHost } from "@/lib/target";

/**
 * Vercel Functions refuse request bodies above 4.5 MB before any code runs, so
 * a 20 MB upload there would fail as an opaque platform error. On a serverless
 * host the limit is stated, enforced and shown to the Learner as 4 MB instead.
 */
export const SERVERLESS_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** The largest lecture file this deployment accepts. */
export function uploadLimitBytes(): number {
  return onServerlessHost() ? SERVERLESS_MAX_UPLOAD_BYTES : MATERIAL_MAX_BYTES;
}
