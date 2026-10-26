import { createHash, timingSafeEqual } from "node:crypto";

import { resetDemo } from "@/lib/demo/seed";
import { logError } from "@/lib/aws/logger";
import { clearRateLimits } from "@/lib/http/rate-limit";

/**
 * `GET|POST /api/admin/reset-demo`
 *
 * Returns the hosted demo to its initial state: CM2026 rebuilt from the
 * synthetic lecture, UPLOAD emptied, rate-limit counters cleared. Only those
 * two classes are touched — `resetDemo` drops their partitions and nothing
 * else — and the counters belong to the demo itself.
 *
 * Called daily by Vercel Cron (see `vercel.json`), which sends
 * `Authorization: Bearer $CRON_SECRET`. The same header lets an operator reset
 * by hand. With no CRON_SECRET configured the endpoint does not exist.
 */

export const runtime = "nodejs";
/** Seeding is a few hundred small writes; allow it time on a cold database. */
export const maxDuration = 60;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const presented = request.headers.get("authorization") ?? "";
  // Hashing first gives equal-length buffers, so the comparison is constant-time
  // whatever was presented.
  return timingSafeEqual(digest(presented), digest(`Bearer ${secret}`));
}

async function handle(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET?.trim()) {
    return Response.json({ error: { code: "SESSION_NOT_FOUND", message: "Not found." } }, { status: 404 });
  }

  if (!authorised(request)) {
    return Response.json(
      { error: { code: "INSTRUCTOR_TOKEN_REQUIRED", message: "Not authorised." } },
      { status: 401 },
    );
  }

  try {
    const summary = await resetDemo();
    await clearRateLimits();

    return Response.json({
      reset: true,
      topics: summary.topics,
      quizItems: summary.poolItems,
      seededLearners: summary.classActivity.learners,
      seededResponses: summary.classActivity.responses,
    });
  } catch (error) {
    const requestId = crypto.randomUUID();
    logError({ event: "demo_reset_failed", requestId, error });
    return Response.json(
      { error: { code: "INTERNAL", message: `Reset failed. Reference: ${requestId}` } },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
