"use client";

import { DifficultyPill, type FeedbackView } from "@/components/QuizItemCard";
import { button, colour, radius, space, type } from "@/lib/design/tokens";

/**
 * Per-answer feedback: whether the answer was right, what the material actually
 * says, where to find it, and the level of the next question.
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
    ? { background: colour.positiveSoft, colour: colour.positive, label: "Correct" }
    : { background: colour.negativeSoft, colour: colour.negative, label: "Not quite" };

  return (
    <section
      aria-live="polite"
      style={{
        background: tone.background,
        border: `1px solid ${tone.colour}22`,
        borderRadius: radius.md,
        padding: space.lg,
        display: "grid",
        gap: space.md,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
        <strong style={{ ...type.heading, color: tone.colour }}>{tone.label}</strong>
        <span style={{ ...type.small, color: colour.muted }}>
          Source: {feedback.sourceRef.value}
        </span>
      </div>

      {!feedback.isCorrect && feedback.correctOptionText ? (
        <p style={{ ...type.body, margin: 0 }}>
          The lecture material says: {feedback.correctOptionText}
        </p>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: space.md }}>
        <button type="button" onClick={onContinue} disabled={busy} style={button.primary}>
          {feedback.closed ? "See my results" : "Next question"}
        </button>

        {!feedback.closed ? (
          <span style={{ ...type.small, color: colour.muted }}>
            Next question: <DifficultyPill level={feedback.nextDifficulty} />
          </span>
        ) : null}
      </div>
    </section>
  );
}
