"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { NumberChip } from "@/components/ui/primitives";
import {
  writeDisplayName,
  writeJoinCode,
  writeLearnerId,
} from "@/hooks/useLearnerId";
import {
  button,
  card,
  colour,
  eyebrow,
  radius,
  space,
  type,
} from "@/lib/design/tokens";

/**
 * The front door: what ClassMind is, and one card to get in.
 *
 * The demo class code is pre-filled, so a presenter is one field and one click
 * from the lecture. The three steps beside the card answer "what am I
 * studying?" before anyone has typed anything — that is this screen's only job.
 */

const DEMO_JOIN_CODE = "CM2026";

/** Inlined at build time; see `lib/demo/public.ts`. Not a secret. */
const PUBLIC_DEMO = process.env.NEXT_PUBLIC_CLASSMIND_PUBLIC_DEMO === "1";

interface JoinResponse {
  sessionId: string;
  learnerId: string;
  displayName: string;
}

const JOURNEY: [string, string][] = [
  ["Learn", "A recap rewritten for how much you already know"],
  ["Check", "Six questions that adapt as you answer"],
  ["Understand", "Exactly which ideas have not landed — and whether the class agrees"],
];

export default function JoinPage() {
  const router = useRouter();

  const [joinCode, setJoinCode] = useState(DEMO_JOIN_CODE);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/sessions/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ joinCode, displayName }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Could not join this class.");
        return;
      }

      const body = (await response.json()) as JoinResponse;

      // Always the Learner_Id from this response. Joining registers a Learner
      // server-side, so keeping a previously stored id in preference to it would
      // leave the browser holding an identity the class may no longer contain —
      // and rejoining, the one obvious way out of that, would never fix it.
      writeLearnerId(body.sessionId, body.learnerId);
      writeDisplayName(body.sessionId, body.displayName);

      // Remembered so a Learner_Id that stops being valid can be replaced
      // without asking for the code again. See `learnerFetch`.
      writeJoinCode(body.sessionId, joinCode.trim().toUpperCase());

      router.push(`/class/${body.sessionId}/lecture`);
    } catch {
      setError("Could not reach ClassMind. Check the server is running.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        padding: `${space.xxxl} ${space.xxl}`,
      }}
    >
      <div
        className="cm-hero"
        style={{
          maxWidth: "1080px",
          margin: "0 auto",
          width: "100%",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 400px",
          gap: space.xxxl,
          alignItems: "center",
        }}
      >
        <div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: space.sm,
              marginBottom: space.xl,
            }}
          >
            <span
              aria-hidden
              style={{
                width: "30px",
                height: "30px",
                borderRadius: radius.sm,
                background: colour.primary,
                color: "#FFFFFF",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "16px",
                fontWeight: 700,
              }}
            >
              C
            </span>
            <span style={{ ...type.sectionTitle }}>ClassMind</span>
          </span>

          {/* 22ch is the width of the longer of the two sentences, so the
              headline breaks where it is written to break — one idea per line —
              rather than mid-phrase. */}
          <h1 style={{ ...type.hero, margin: `0 0 ${space.lg}`, maxWidth: "22ch" }}>
            Understand yourself.{" "}
            <span style={{ color: colour.primary }}>Understand your class.</span>
          </h1>

          <p
            style={{
              ...type.body,
              fontSize: "16.5px",
              color: colour.muted,
              margin: `0 0 ${space.xxl}`,
              maxWidth: "48ch",
            }}
          >
            ClassMind turns one lecture into a personalised study session — then
            shows the whole class where understanding is breaking down, so you can
            fix it together.
          </p>

          <ol
            style={{
              display: "grid",
              gap: space.lg,
              listStyle: "none",
              margin: 0,
              padding: 0,
              maxWidth: "46ch",
            }}
          >
            {JOURNEY.map(([step, detail], index) => (
              <li key={step} style={{ display: "flex", gap: space.md, alignItems: "baseline" }}>
                <NumberChip value={index + 1} />
                <span>
                  <strong style={{ ...type.cardTitle }}>{step}</strong>
                  <span style={{ ...type.body, color: colour.muted }}> — {detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <form
          onSubmit={join}
          style={{ ...card, padding: space.xxl, display: "grid", gap: space.lg }}
        >
          <div>
            <span style={eyebrow}>Join a class</span>
            <h2 style={{ ...type.sectionTitle, margin: 0 }}>Enter your class code</h2>
            <p style={{ ...type.small, color: colour.muted, margin: `${space.xs} 0 0` }}>
              No account and no password. Your name is only used in the study space.
            </p>
            {PUBLIC_DEMO ? (
              <p
                data-testid="public-demo-notice"
                style={{ ...type.small, color: colour.muted, margin: `${space.sm} 0 0` }}
              >
                Public portfolio demo: the class and its classmates are sample data,
                what you enter is visible to other visitors, and everything is reset
                daily. Please don&rsquo;t enter personal information.
              </p>
            ) : null}
          </div>

          <label style={{ display: "grid", gap: space.sm }}>
            <span style={{ ...type.cardTitle }}>Class code</span>
            <input
              name="joinCode"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              autoComplete="off"
              maxLength={6}
              style={{
                padding: "14px",
                fontSize: "24px",
                fontWeight: 680,
                letterSpacing: "0.2em",
                textAlign: "center",
                color: colour.primaryInk,
                border: `1px solid ${colour.primaryBorder}`,
                borderRadius: radius.md,
                background: colour.primarySoft,
              }}
            />
          </label>

          <label style={{ display: "grid", gap: space.sm }}>
            <span style={{ ...type.cardTitle }}>Your name</span>
            <input
              name="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="e.g. Sam"
              autoComplete="off"
              maxLength={30}
              style={{
                padding: "12px 14px",
                fontSize: "15px",
                border: `1px solid ${colour.borderStrong}`,
                borderRadius: radius.md,
                background: colour.surface,
              }}
            />
          </label>

          {error ? (
            <p
              role="alert"
              style={{
                ...type.small,
                margin: 0,
                padding: space.md,
                color: colour.weakInk,
                background: colour.weakSoft,
                border: `1px solid ${colour.weakBorder}`,
                borderRadius: radius.md,
              }}
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            style={{
              ...button.primary,
              width: "100%",
              padding: "14px 20px",
              fontSize: "15px",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Joining…" : "Start learning"}
          </button>
        </form>
      </div>
    </div>
  );
}
