import "server-only";

import { randomUUID } from "node:crypto";

import {
  DEMO_SESSION_ID,
  resetUploadClass,
  seedDemoClass,
  UPLOAD_SESSION_ID,
} from "@/lib/demo/seed";
import { getSession } from "@/lib/repo/session";
import {
  deleteAll,
  getItem,
  isConditionalCheckFailure,
  putItem,
  updateItem,
} from "@/lib/repo/table";
import { isLocalTarget, usesPostgres } from "@/lib/target";

/**
 * First-run setup.
 *
 * A fresh clone has no data file, and a fresh hosted database has empty tables.
 * Rather than requiring a seed command first, the first request that needs a
 * class builds the two demo classes — CM2026 and the empty UPLOAD class —
 * through the same seeding code `npm run seed` uses. The same happens after the
 * local data file is deleted, which is the simplest way to reset locally.
 *
 * On the `local` and `postgres` targets only. A DynamoDB deployment is
 * provisioned and seeded explicitly by its own scripts.
 *
 * Several server instances can cold-start at once on a serverless host, so
 * seeding runs under a lock item claimed with a conditional write: one instance
 * seeds, the others wait for it to finish. A lock left by a crashed instance
 * expires.
 */

const IN_FLIGHT = Symbol.for("classmind.demoBootstrap");
const LOCK = { PK: "BOOTSTRAP", SK: "LOCK" };
const LOCK_TTL_MS = 120_000;
const WAIT_MS = 60_000;
const POLL_MS = 500;

type Scope = Record<symbol, Promise<void> | undefined>;

async function demoIsComplete(): Promise<boolean> {
  const [demo, upload] = await Promise.all([
    getSession(DEMO_SESSION_ID),
    getSession(UPLOAD_SESSION_ID),
  ]);
  return demo !== null && upload !== null;
}

/** Claims the lock, taking it over if its holder's lease has expired. */
async function claim(token: string): Promise<boolean> {
  const lease = { token, expiresAt: Date.now() + LOCK_TTL_MS };

  try {
    await putItem({ ...LOCK, ...lease }, { exists: false });
    return true;
  } catch (error) {
    if (!isConditionalCheckFailure(error)) throw error;
  }

  const held = await getItem<{ token: string; expiresAt: number }>(LOCK.PK, LOCK.SK);
  if (!held || held.expiresAt > Date.now()) return false;

  try {
    await updateItem(LOCK, { set: lease }, { equals: { token: held.token } });
    return true;
  } catch (error) {
    if (isConditionalCheckFailure(error)) return false;
    throw error;
  }
}

async function seedWhatIsMissing(): Promise<void> {
  if (await demoIsComplete()) return;

  const token = randomUUID();
  const deadline = Date.now() + WAIT_MS;

  while (!(await claim(token))) {
    // Another instance is seeding. Wait for it rather than seeding twice.
    if (await demoIsComplete()) return;
    if (Date.now() > deadline) {
      throw new Error("The demo classes are still being prepared. Try again in a moment.");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  try {
    const [demo, upload] = await Promise.all([
      getSession(DEMO_SESSION_ID),
      getSession(UPLOAD_SESSION_ID),
    ]);
    if (!demo) await seedDemoClass();
    if (!upload) await resetUploadClass();
  } finally {
    await deleteAll([LOCK]);
  }
}

/**
 * Ensures the demo classes exist. Concurrent callers in one process share one
 * attempt; callers in other processes coordinate through the lock item.
 */
export function ensureDemoData(): Promise<void> {
  if (!isLocalTarget() && !usesPostgres()) return Promise.resolve();

  const scope = globalThis as unknown as Scope;
  const inFlight = scope[IN_FLIGHT];
  if (inFlight) return inFlight;

  const attempt = seedWhatIsMissing().finally(() => {
    scope[IN_FLIGHT] = undefined;
  });
  scope[IN_FLIGHT] = attempt;
  return attempt;
}
