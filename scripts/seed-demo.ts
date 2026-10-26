/**
 * Seeds the demo Class_Session CM2026.
 *
 * Usage:  npm run seed -- [path-to-lecture-file]
 *
 * In the default local mode this needs nothing — no AWS, no Docker — and the
 * app also does it automatically on first run. With CLASSMIND_TARGET set to
 * `dynamodb-local` or `aws` it writes to that table instead (see
 * docs/aws-setup.md). All learners, answers and explanations it writes are
 * synthetic.
 */

import { DEMO_JOIN_CODE, seedDemoClass } from "@/lib/demo/seed";
import { describeTarget } from "@/lib/target";

async function main(): Promise<void> {
  console.log(`Target: ${describeTarget()}`);

  const summary = await seedDemoClass({
    lecturePath: process.argv[2],
    log: (line) => console.log(line),
  });

  console.log(`\nDone. ${summary.topics} topics, ${summary.poolItems} quiz items.`);
  console.log(`Join at http://localhost:3000 with code ${DEMO_JOIN_CODE}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
