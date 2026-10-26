"use client";

import { DifficultyPill, type FeedbackView } from "@/components/QuizItemCard";
import { IconArrowRight } from "@/components/ui/icons";
import { button, colour, radius, space, type } from "@/lib/design/tokens";

/**
 * What the material actually says, shown the moment an answer is submitted.
 *
 * The verdict is stated in words as well as colour, the source is named so the
 * Learner can go and read it, and the next question's level is shown — which is
 * where the quiz makes its adaptivity visible.
 */
export default function ResponseFeedback({
  feedback,
  onContinue,
  busy,
}: {
  feedback: FeedbackView;
  onContinue: () => void;
  busy: boolean;
}) {
  const tone = feedback.isCorrect
    ? {
        background: colour.strongSoft,
        border: colour.strongBorder,
        ink: colour.strongInk,
        label: "Correct",
      }
    : {
        background: colour.weakSoft,
        border: colour.weakBorder,
        ink: colour.weakInk,
        label: "Not quite",
      };

  return (
    <section
      aria-live="polite"
      style={{
        background: tone.background,
        border: `1px solid ${tone.border}`,
        borderLeft: `4px solid ${tone.ink}`,
        borderRadius: radius.lg,
        padding: space.xl,
        display: "grid",
        gap: space.md,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: space.md }}>
        <strong style={{ ...type.sectionTitle, color: tone.ink }}>{tone.label}</strong>
        <span style={{ ...type.small, color: colour.muted }}>
          Source: {feedback.sourceRef.value}
        </span>
      </div>

      {!feedback.isCorrect && feedback.correctOptionText ? (
        <p style={{ ...type.body, margin: 0, maxWidth: "72ch" }}>
          <span style={{ color: colour.muted }}>The material says: </span>
          {feedback.correctOptionText}
        </p>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: space.lg,
          marginTop: space.xs,
        }}
      >
        <button
          type="button"
          onClick={onContinue}
          disabled={busy}
          style={{
            ...button.primary,
            display: "inline-flex",
            alignItems: "center",
            gap: space.sm,
          }}
        >
          {feedback.closed ? "See what I understand" : "Next question"}
          <IconArrowRight size={16} />
        </button>

        {!feedback.closed ? (
          <span
            style={{
              ...type.small,
              color: colour.muted,
              display: "inline-flex",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            Next up <DifficultyPill level={feedback.nextDifficulty} />
          </span>
        ) : null}
      </div>
    </section>
  );
}
