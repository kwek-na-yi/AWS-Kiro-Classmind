/**
 * Public-demo mode.
 *
 * A hosted portfolio demo is used by strangers at the same time, so a few
 * protections apply there that would only get in the way locally: request rate
 * limits, a read-only demo lecture (uploads go to the shared UPLOAD class, never
 * over CM2026), and a notice that data is shared and reset daily.
 *
 * Switched on with `NEXT_PUBLIC_CLASSMIND_PUBLIC_DEMO=1`. The `NEXT_PUBLIC_`
 * prefix is deliberate: this is a non-secret flag the join page also reads to
 * show the notice. It carries no credential.
 */
export function isPublicDemo(): boolean {
  return process.env.NEXT_PUBLIC_CLASSMIND_PUBLIC_DEMO === "1";
}
