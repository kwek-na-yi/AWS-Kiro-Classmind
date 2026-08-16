"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { readLearnerId, writeLearnerId } from "@/hooks/useLearnerId";
import { button, colour, panel, space, type } from "@/lib/design/tokens";

/**
 * The entry point: join a class with a code and a name.
 *
 * The demo class code is pre-filled, so reaching the lecture is one field and
 * one click. Nothing is registered: joining mints an opaque id for this class
 * and nothing else about the Learner is stored.
 */

const DEMO_JOIN_CODE = "CM2026";

interface JoinResponse {
  sessionId: string;
  learnerId: string;
  name: string;
}

interface ErrorResponse {
  error: { code: string; message: string; field?: string };
}

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
        const body = (await response.json()) as ErrorResponse;
        setError(body.error?.message ?? "Could not join this class.");
        return;
      }

      const body = (await response.json()) as JoinResponse;

      // Reuse the Learner_Id already stored for this class if there is one, so
      // rejoining does not create a second Learner.
      const existing = readLearnerId(body.sessionId);
      writeLearnerId(body.sessionId, existing ?? body.learnerId);

      router.push(`/class/${body.sessionId}/lecture`);
    } catch {
      setError("Could not reach ClassMind. Check the server is running.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: "520px" }}>
      <h1 style={{ ...type.display, margin: `0 0 ${space.sm}` }}>Join your class</h1>
      <p style={{ ...type.body, color: colour.muted, margin: `0 0 ${space.lg}` }}>
        Enter the class code your instructor shared. No account is needed.
      </p>

      <form onSubmit={join} style={{ ...panel, display: "grid", gap: space.md }}>
        <label style={{ display: "grid", gap: space.xs }}>
          <span style={{ ...type.heading }}>Class code</span>
          <input
            name="joinCode"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            autoComplete="off"
            maxLength={6}
            style={{
              padding: "10px 12px",
              fontSize: "18px",
              letterSpacing: "2px",
              border: `1px solid ${colour.border}`,
              borderRadius: "6px",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: space.xs }}>
          <span style={{ ...type.heading }}>Your name</span>
          <input
            name="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Shown only in the study space"
            autoComplete="off"
            maxLength={30}
            style={{
              padding: "10px 12px",
              fontSize: "15px",
              border: `1px solid ${colour.border}`,
              borderRadius: "6px",
            }}
          />
        </label>

        {error ? (
          <p
            role="alert"
            style={{
              ...type.small,
              margin: 0,
              padding: space.sm,
              color: colour.negative,
              background: colour.negativeSoft,
              borderRadius: "6px",
            }}
          >
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={busy} style={button.primary}>
          {busy ? "Joining…" : "Join class"}
        </button>
      </form>
    </div>
  );
}
