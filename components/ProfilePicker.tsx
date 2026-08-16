"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { learnerHeaders, useLearnerId } from "@/hooks/useLearnerId";
import { button, colour, radius, space, type } from "@/lib/design/tokens";
import {
  EXPLANATION_STYLES,
  UNDERSTANDING_LEVELS,
  type ExplanationStyle,
  type UnderstandingLevel,
} from "@/lib/types";

/**
 * The Learner_Profile picker: three understanding levels and five explanation
 * styles, presented as two keyboard-operable radio groups.
 *
 * Both choices are required before a Recap can be requested, so the button
 * stays disabled until each group has a selection — one click then persists the
 * profile and opens the Recap.
 */

const LEVEL_LABELS: Record<UnderstandingLevel, { label: string; hint: string }> = {
  No_Understanding: {
    label: "No understanding",
    hint: "Start from scratch, with every term defined",
  },
  Basic_Understanding: {
    label: "Basic understanding",
    hint: "I know the topic names, show me how they connect",
  },
  Strong_Understanding: {
    label: "Strong understanding",
    hint: "Skip the basics, give me the edge cases",
  },
};

const STYLE_LABELS: Record<ExplanationStyle, string> = {
  Concise: "Concise",
  Detailed: "Detailed",
  Examples: "Examples",
  Step_By_Step: "Step by step",
  Visual_Structured: "Visual / diagrams",
};

function Choice({
  name,
  value,
  checked,
  onChange,
  label,
  hint,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label
      style={{
        display: "block",
        padding: `${space.sm} ${space.md}`,
        border: `1px solid ${checked ? colour.accent : colour.border}`,
        background: checked ? colour.accentSoft : colour.surface,
        borderRadius: radius.sm,
        cursor: "pointer",
      }}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        style={{ marginRight: space.sm }}
      />
      <span style={{ ...type.body, fontWeight: checked ? 600 : 400 }}>{label}</span>
      {hint ? (
        <span style={{ ...type.small, color: colour.muted, display: "block", marginLeft: "24px" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export default function ProfilePicker({
  sessionId,
  initialLevel,
  initialStyle,
}: {
  sessionId: string;
  initialLevel?: UnderstandingLevel;
  initialStyle?: ExplanationStyle;
}) {
  const router = useRouter();
  const { learnerId, ready } = useLearnerId(sessionId);

  const [level, setLevel] = useState<UnderstandingLevel | null>(initialLevel ?? null);
  const [style, setStyle] = useState<ExplanationStyle | null>(initialStyle ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const complete = level !== null && style !== null;

  async function save() {
    if (!complete || !learnerId) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/sessions/${sessionId}/profile`, {
        method: "PUT",
        headers: learnerHeaders(learnerId),
        body: JSON.stringify({ understandingLevel: level, explanationStyle: style }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Could not save your choices.");
        return;
      }

      router.push(`/class/${sessionId}/recap`);
    } catch {
      setError("Could not reach ClassMind.");
    } finally {
      setBusy(false);
    }
  }

  if (ready && !learnerId) {
    return (
      <p style={{ ...type.body, color: colour.muted }}>
        Join the class from the home page to choose how your recap is written.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: space.lg }}>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend style={{ ...type.heading, marginBottom: space.sm }}>
          How well do you know this material?
        </legend>
        <div style={{ display: "grid", gap: space.sm }}>
          {UNDERSTANDING_LEVELS.map((value) => (
            <Choice
              key={value}
              name="understandingLevel"
              value={value}
              checked={level === value}
              onChange={(next) => setLevel(next as UnderstandingLevel)}
              label={LEVEL_LABELS[value].label}
              hint={LEVEL_LABELS[value].hint}
            />
          ))}
        </div>
      </fieldset>

      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend style={{ ...type.heading, marginBottom: space.sm }}>
          How would you like it explained?
        </legend>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: space.sm,
          }}
        >
          {EXPLANATION_STYLES.map((value) => (
            <Choice
              key={value}
              name="explanationStyle"
              value={value}
              checked={style === value}
              onChange={(next) => setStyle(next as ExplanationStyle)}
              label={STYLE_LABELS[value]}
            />
          ))}
        </div>
      </fieldset>

      {error ? (
        <p role="alert" style={{ ...type.small, color: colour.negative, margin: 0 }}>
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="button"
          onClick={save}
          disabled={!complete || busy}
          style={{
            ...button.primary,
            opacity: complete && !busy ? 1 : 0.5,
            cursor: complete && !busy ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Preparing your recap…" : "Show my recap"}
        </button>
      </div>
    </div>
  );
}
