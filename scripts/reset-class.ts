/**
 * Empties a Class_Session and leaves it ready to receive an upload.
 *
 * The demo has two classes and they are reset in different ways. CM2026 is
 * rebuilt by `seed-demo.ts`. The upload class is the opposite: it must start
 * with *nothing* in it, so a visitor can drop a file in and watch a class being
 * built from scratch. Everything in the Class_Session goes — material, Topics,
 * Quiz_Items, Recaps, Learners, responses, reports, Peer_Explanations and the
 * uploaded files — and the session is written back with its Join_Code reserved.
 *
 * Usage:
 *   npm run reset:class                          the demo upload class
 *   npm run reset:class -- --drop upload-check   remove a class entirely
 *   npm run reset:class -- <sid> <CODE> "<name>"
 */

import {
  dropClass,
  resetEmptyClass,
  UPLOAD_JOIN_CODE,
  UPLOAD_SESSION_ID,
  UPLOAD_SESSION_NAME,
} from "@/lib/demo/seed";
import { describeTarget } from "@/lib/target";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const drop = args.includes("--drop");
  const positional = args.filter((arg) => arg !== "--drop");

  const sessionId = positional[0] ?? UPLOAD_SESSION_ID;
  const joinCode = (positional[1] ?? UPLOAD_JOIN_CODE).toUpperCase();
  const name = positional[2] ?? UPLOAD_SESSION_NAME;

  console.log(`Target: ${describeTarget()}`);

  if (drop) {
    const removed = await dropClass(sessionId);
    console.log(`Dropped ${sessionId} (${removed} item(s))`);
    return;
  }

  const removed = await resetEmptyClass({ sessionId, joinCode, name });

  console.log(`Cleared ${removed} item(s) from ${sessionId}`);
  console.log(`\n${name}`);
  console.log(`  session   ${sessionId}`);
  console.log(`  join code ${joinCode}`);
  console.log(`  material  none — ready for an upload`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
