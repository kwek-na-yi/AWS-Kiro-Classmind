"use client";

import { useState } from "react";

import { IconTogether } from "@/components/ui/icons";
import { Badge, Card, Notice } from "@/components/ui/primitives";
import { learnerFetch } from "@/hooks/useLearnerId";
import {
  button,
  colour,
  eyebrow,
  radius,
  space,
  type,
} from "@/lib/design/tokens";
import type { SourceRef, ValidationStatus } from "@/lib/types";

/**
 * The Study_Thread: how classmates are explaining this idea.
 *
 * Every explanation is shown, whatever its status, because a wrong explanation
 * that has been *marked* wrong teaches something. What differs is prominence:
 * a checked-and-supported explanation is presented as study material, and the
 * rest are presented as attempts with their verdict attached.
 *
 * No explanation carries a name. The thread is about the idea.
 */

export interface ExplanationView {
  id: string;
  text: string;
  status: ValidationStatus;
  sourceRef: SourceRef | null;
  reason: string | null;
  isRecommended: boolean;
}

/**
 * How each Validation_Status is labelled.
 *
 * "Checked against the material" rather than a claim about intelligence: the
 * check is a deterministic comparison with the lecture text, and the label says
 * exactly that.
 */
const STATUS: Record<
  ValidationStatus,
  { label: string; tone: "strong" | "attention" | "weak" | "neutral"; note: string }
> = {
  Validated: {
    label: "Verified against the material",
    tone: "strong",
    note: "Every claim here was matched to the lecture material.",
  },
  Contradicted: {
    label: "Needs correction",
    tone: "weak",
    note: "This conflicts with what the lecture material says.",
  },
  Unsupported: {
    label: "Unsupported",
    tone: "attention",
    note: "The lecture material does not confirm this.",
  },
  Pending: {
    label: "Checking…",
    tone: "neutral",
    note: "This explanation is still being checked.",
  },
};

function ExplanationCard({
  explanation,
  featured,
}: {
  explanation: ExplanationView;
  featured?: boolean;
}) {
  const status = STATUS[explanation.status];

  return (
    <Card
      style={{
        borderColor: featured ? colour.strongBorder : colour.border,
        borderLeft: featured ? `4px solid ${colour.strong}` : undefined,
        background: featured ? colour.strongSoft : colour.surface,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: space.md,
          marginBottom: space.md,
        }}
      >
        <span style={{ ...type.small, color: colour.subtle }}>
          {featured ? "Recommended explanation" : "Explanation from a classmate"}
        </span>

        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <p
        style={{
          ...type.body,
          margin: 0,
          maxWidth: "72ch",
          fontSize: featured ? "15.5px" : undefined,
        }}
      >
        {explanation.text}
      </p>

      {explanation.sourceRef ? (
        <p style={{ ...type.small, color: colour.muted, margin: `${space.md} 0 0` }}>
          Matched to {explanation.sourceRef.value}
        </p>
      ) : null}

      {explanation.reason ? (
        <p
          style={{
            ...type.small,
            color: colour.muted,
            margin: `${space.md} 0 0`,
            paddingTop: space.md,
            borderTop: `1px solid ${colour.border}`,
          }}
        >
          {explanation.reason}
        </p>
      ) : null}
    </Card>
  );
}

export default function StudyThread({
  sessionId,
  topicId,
  learnerId,
  explanations,
  onSubmitted,
}: {
  sessionId: string;
  topicId: string;
  learnerId: string | null;
  explanations: ExplanationView[];
  onSubmitted: () => void;
}) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "saving" | "checking" | "done">("idle");
  const [outcome, setOutcome] = useState<ValidationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stillChecking, setStillChecking] = useState(false);

  const featured = explanations.find((entry) => entry.isRecommended);
  const others = explanations.filter((entry) => entry !== featured);

  const length = text.trim().length;
  const canSubmit = length >= 20 && length <= 1500 && learnerId !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !learnerId) return;

    setError(null);
    setOutcome(null);
    setStillChecking(false);
    setPhase("saving");

    try {
      const created = await learnerFetch(
        sessionId,
        learnerId,
        `/api/sessions/${sessionId}/threads/${topicId}/explanations`,
        { method: "POST", body: JSON.stringify({ text: text.trim() }) },
      );

      const createdBody = await created.json();

      if (!created.ok) {
        setError(createdBody?.error?.message ?? "Your explanation could not be saved.");
        setPhase("idle");
        return;
      }

      // Saved as Pending. The check runs as its own request, so a slow or failed
      // assessment can never lose the contribution.
      setPhase("checking");

      const checked = await learnerFetch(
        sessionId,
        learnerId,
        `/api/sessions/${sessionId}/explanations/${createdBody.id}/validate`,
        { method: "POST" },
      );

      const checkedBody = await checked.json();

      if (checked.ok) {
        setOutcome(checkedBody.status as ValidationStatus);
        setStillChecking(
          checkedBody.status === "Pending" ||
            (Array.isArray(checkedBody.degraded) && checkedBody.degraded.length > 0),
        );
      } else {
        // The explanation is stored either way; only the verdict is missing.
        setStillChecking(true);
      }

      setPhase("done");
      setText("");
      onSubmitted();
    } catch {
      setError("Could not reach ClassMind.");
      setPhase("idle");
    }
  }

  return (
    <div style={{ display: "grid", gap: space.xl }}>
      <section>
        <span
          style={{ ...eyebrow, display: "flex", alignItems: "center", gap: space.sm }}
        >
          <IconTogether size={14} />
          How students are explaining it
        </span>

        {explanations.length === 0 ? (
          <Notice tone="neutral" title="No explanations yet">
            Be the first to explain this in your own words. Every explanation is
            checked against the lecture material before it is recommended to anyone.
          </Notice>
        ) : (
          <div style={{ display: "grid", gap: space.md, marginTop: space.sm }}>
            {featured ? (
              <ExplanationCard explanation={featured} featured />
            ) : (
              <Notice tone="attention" title="No verified explanation yet">
                None of the explanations below have been matched to the lecture
                material, so none is recommended as study material yet.
              </Notice>
            )}

            {others.map((explanation) => (
              <ExplanationCard key={explanation.id} explanation={explanation} />
            ))}
          </div>
        )}
      </section>

      <Card style={{ background: colour.primarySoft, borderColor: colour.primaryBorder }}>
        <form onSubmit={submit}>
          <span style={eyebrow}>Contribute</span>
          <h3 style={{ ...type.sectionTitle, margin: `0 0 ${space.xs}` }}>
            Explain it in your own words
          </h3>
          <p style={{ ...type.body, color: colour.muted, margin: `0 0 ${space.lg}` }}>
            Your explanation is checked against the lecture material before anyone
            sees it recommended. It is shown to the class without your name.
          </p>

          <textarea
            aria-label="Your explanation"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            maxLength={1500}
            placeholder="In your own words, what is actually going on here?"
            disabled={phase === "saving" || phase === "checking" || !learnerId}
            style={{
              width: "100%",
              padding: space.lg,
              border: `1px solid ${colour.primaryBorder}`,
              borderRadius: radius.md,
              background: colour.surface,
              resize: "vertical",
              ...type.body,
            }}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: space.lg,
              marginTop: space.md,
              flexWrap: "wrap",
            }}
          >
            <span style={{ ...type.small, color: colour.muted }}>
              {length < 20
                ? `${20 - length} more characters needed`
                : `${length} / 1500 characters`}
            </span>

            <button
              type="submit"
              disabled={!canSubmit || phase === "saving" || phase === "checking"}
              style={{
                ...button.primary,
                opacity: canSubmit && phase === "idle" ? 1 : 0.5,
                cursor: canSubmit && phase === "idle" ? "pointer" : "not-allowed",
              }}
            >
              {phase === "saving"
                ? "Saving…"
                : phase === "checking"
                  ? "Checking explanation…"
                  : "Submit explanation"}
            </button>
          </div>

          {error ? (
            <p role="alert" style={{ ...type.small, color: colour.weakInk, margin: `${space.md} 0 0` }}>
              {error}
            </p>
          ) : null}

          {phase === "done" ? (
            <div style={{ marginTop: space.lg }} aria-live="polite">
              {stillChecking ? (
                <Notice tone="neutral" title="Saved — still being checked">
                  Your explanation was saved but the check has not finished. It will
                  be labelled once it has, and it stays out of the recommended list
                  until then.
                </Notice>
              ) : outcome ? (
                <Notice
                  tone={STATUS[outcome].tone}
                  title={`Saved — ${STATUS[outcome].label.toLowerCase()}`}
                >
                  {STATUS[outcome].note}
                </Notice>
              ) : null}
            </div>
          ) : null}

          {!learnerId ? (
            <p style={{ ...type.small, color: colour.muted, margin: `${space.md} 0 0` }}>
              Join the class to contribute an explanation.
            </p>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
