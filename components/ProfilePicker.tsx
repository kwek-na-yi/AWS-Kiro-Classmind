"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Card } from "@/components/ui/primitives";
import { learnerFetch, useLearnerId } from "@/hooks/useLearnerId";
import {
  button,
  colour,
  eyebrow,
  radius,
  shadow,
  space,
  type,
} from "@/lib/design/tokens";
import {
  EXPLANATION_STYLES,
  UNDERSTANDING_LEVELS,
  type ExplanationStyle,
  type UnderstandingLevel,
} from "@/lib/types";

/**
 * How the recap gets written.
 *
 * Two questions in the Learner's own words, answered by choosing a card. The
 * cards are real radio groups underneath — arrow keys, tab order and
 * screen-reader semantics are the native ones, and the input is only visually
 * hidden, never removed.
 */

const CONFIDENCE: Record<UnderstandingLevel, { label: string; detail: string }> = {
  No_Understanding: {
    label: "New to it",
    detail: "Define the terms and start from the beginning",
  },
  Basic_Understanding: {
    label: "Basic understanding",
    detail: "I know the names — show me how they connect",
  },
  Strong_Understanding: {
    label: "Confident",
    detail: "Skip ahead to edge cases and conditions",
  },
};

const STYLE: Record<ExplanationStyle, { label: string; detail: string }> = {
  Concise: { label: "Concise", detail: "The short version" },
  Examples: { label: "Examples", detail: "Worked cases" },
  Step_By_Step: { label: "Step-by-step", detail: "Ordered steps" },
  Visual_Structured: { label: "Visual", detail: "Tables and diagrams" },
  Detailed: { label: "Detailed", detail: "The full explanation" },
};

/** The order the styles are offered in, which reads better than the enum order. */
const STYLE_ORDER: ExplanationStyle[] = [
  "Concise",
  "Examples",
  "Step_By_Step",
  "Visual_Structured",
  "Detailed",
];

function OptionCard({
  name,
  value,
  checked,
  onChange,
  label,
  detail,
  compact,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  label: string;
  detail: string;
  compact?: boolean;
}) {
  return (
    <label
      style={{
        position: "relative",
        display: "block",
        padding: compact ? space.lg : space.xl,
        border: `1.5px solid ${checked ? colour.primary : colour.border}`,
        background: checked ? colour.primarySoft : colour.surface,
        borderRadius: radius.lg,
        boxShadow: checked ? shadow.raised : shadow.card,
        cursor: "pointer",
        transition: "border-color 120ms ease, background 120ms ease",
      }}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        style={{
          position: "absolute",
          opacity: 0,
          width: "1px",
          height: "1px",
          margin: "-1px",
        }}
      />

      <span
        style={{
          ...type.cardTitle,
          display: "block",
          color: checked ? colour.primaryInk : colour.text,
          marginBottom: "3px",
        }}
      >
        {label}
      </span>
      <span style={{ ...type.small, color: colour.muted, display: "block" }}>
        {detail}
      </span>
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
      const response = await learnerFetch(
        sessionId,
        learnerId,
        `/api/sessions/${sessionId}/profile`,
        {
          method: "PUT",
          body: JSON.stringify({ understandingLevel: level, explanationStyle: style }),
        },
      );

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
      <p style={{ ...type.body, color: colour.muted, margin: 0 }}>
        Join the class from the home page to set up your recap.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: space.lg }}>
      <Card>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend style={{ padding: 0, marginBottom: space.lg }}>
            <span style={eyebrow}>Question 1</span>
            <span style={{ ...type.sectionTitle, display: "block" }}>
              How confident are you with this topic?
            </span>
          </legend>

          <div
            className="cm-grid-3"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: space.md,
            }}
          >
            {UNDERSTANDING_LEVELS.map((value) => (
              <OptionCard
                key={value}
                name="understandingLevel"
                value={value}
                checked={level === value}
                onChange={(next) => setLevel(next as UnderstandingLevel)}
                label={CONFIDENCE[value].label}
                detail={CONFIDENCE[value].detail}
              />
            ))}
          </div>
        </fieldset>
      </Card>

      <Card>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend style={{ padding: 0, marginBottom: space.lg }}>
            <span style={eyebrow}>Question 2</span>
            <span style={{ ...type.sectionTitle, display: "block" }}>
              How should we explain it?
            </span>
          </legend>

          <div
            className="cm-grid-5"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: space.sm,
            }}
          >
            {STYLE_ORDER.filter((value) => EXPLANATION_STYLES.includes(value)).map(
              (value) => (
                <OptionCard
                  key={value}
                  name="explanationStyle"
                  value={value}
                  checked={style === value}
                  onChange={(next) => setStyle(next as ExplanationStyle)}
                  label={STYLE[value].label}
                  detail={STYLE[value].detail}
                  compact
                />
              ),
            )}
          </div>
        </fieldset>
      </Card>

      {error ? (
        <p role="alert" style={{ ...type.small, color: colour.weakInk, margin: 0 }}>
          {error}
        </p>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: space.lg }}>
        <button
          type="button"
          onClick={save}
          disabled={!complete || busy}
          style={{
            ...button.primary,
            opacity: complete && !busy ? 1 : 0.45,
            cursor: complete && !busy ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Writing your recap…" : "Create My Recap"}
        </button>

        {!complete ? (
          <span style={{ ...type.small, color: colour.subtle }}>
            Choose one from each question
          </span>
        ) : null}
      </div>
    </div>
  );
}
