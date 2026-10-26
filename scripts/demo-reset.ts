/**
 * Returns the demo to its initial state.
 *
 * CM2026 is dropped and rebuilt from the synthetic lecture (six synthetic
 * learners, their quiz answers and a validated study thread); UPLOAD is emptied.
 * Every learner who joined, every answer and every upload is discarded.
 *
 * Usage:  npm run demo:reset
 *
 * Safe to run while `npm run dev` is up: the local store notices the file
 * changed and reloads it. Browsers that had joined before the reset rejoin
 * automatically on their next request.
 */

import { DEMO_JOIN_CODE, resetDemo, UPLOAD_JOIN_CODE } from "@/lib/demo/seed";
import { describeTarget } from "@/lib/target";

async function main(): Promise<void> {
  console.log(`Target: ${describeTarget()}`);

  await resetDemo({ log: (line) => console.log(line) });

  console.log(`\nDemo reset. Join with ${DEMO_JOIN_CODE}, or ${UPLOAD_JOIN_CODE} to upload your own lecture.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
