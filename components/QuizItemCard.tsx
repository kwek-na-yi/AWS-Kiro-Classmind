"use client";

import { button, colour, panel, radius, space, type } from "@/lib/design/tokens";
import type { SourceRef } from "@/lib/types";

/**
 * One Quiz_Item: a keyboard-operable radio group of four Answer_Options, and the
 * feedback shown once it has been answered.
 *
 * The card never receives correctness information until the answer is submitted
 * — the served item carries option text only.
 */

export interface QuizOptionView {
  id: string;
  text: string;
}

export interface QuizItemView {
  id: string;
  stem: string;
  difficulty: 1 | 2 | 3;
  topicName: string;
  options: QuizOptionView[];
}

export interface FeedbackView {
  isCorrect: boolean;
  correctOptionId: string | null;
  correctOptionText: string | null;
  sourceRef: SourceRef;
  nextDifficulty: 1 | 2 | 3;
  closed: boolean;
}

const DIFFICULTY_LABEL: Record<1 | 2 | 3, string> = {
  1: "Foundational",
  2: "Intermediate",
  3: "Advanced",
};

export function DifficultyPill({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span
      style={{
        ...type.small,
        padding: `2px ${space.sm}`,
        borderRadius: radius.sm,
        background: colour.canvas,
        color: colour.muted,
        border: `1px solid ${colour.border}`,
      }}
    >
      {DIFFICULTY_LABEL[level]}
    </span>
  );
}

export default function QuizItemCard({
  item,
  index,
  length,
  selected,
  onSelect,
  onSubmit,
  feedback,
  busy,
}: {
  item: QuizItemView;
  index: number;
  length: number;
  selected: string | null;
  onSelect: (optionId: string) => void;
  onSubmit: () => void;
  feedback: FeedbackView | null;
  busy: boolean;
}) {
  const answered = feedback !== null;

  return (
    <section style={panel}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: space.md,
        }}
      >
        <span style={{ ...type.small, color: colour.muted }}>
          Question {index} of {length} · {item.topicName}
        </span>
        <DifficultyPill level={item.difficulty} />
      </div>

      <h2 style={{ ...type.title, margin: `0 0 ${space.lg}` }}>{item.stem}</h2>

      <fieldset
        style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: space.sm }}
      >
        <legend style={{ position: "absolute", left: "-9999px" }}>
          Answer options for question {index}
        </legend>

        {item.options.map((option) => {
          const isChosen = selected === option.id;
          const isCorrectOption = feedback?.correctOptionId === option.id;
          const isWrongChoice = answered && isChosen && !feedback.isCorrect;

          const border = isCorrectOption
            ? colour.positive
            : isWrongChoice
              ? colour.negative
              : isChosen
                ? colour.accent
                : colour.border;

          const background = isCorrectOption
            ? colour.positiveSoft
            : isWrongChoice
              ? colour.negativeSoft
              : isChosen
                ? colour.accentSoft
                : colour.surface;

          return (
            <label
              key={option.id}
              style={{
                display: "flex",
                gap: space.sm,
                alignItems: "flex-start",
                padding: space.md,
                border: `1px solid ${border}`,
                background,
                borderRadius: radius.sm,
                cursor: answered ? "default" : "pointer",
              }}
            >
              <input
                type="radio"
                name={`item-${item.id}`}
                value={option.id}
                checked={isChosen}
                disabled={answered || busy}
                onChange={() => onSelect(option.id)}
                style={{ marginTop: "3px" }}
              />
              <span style={{ ...type.body }}>{option.text}</span>
            </label>
          );
        })}
      </fieldset>

      {!answered ? (
        <button
          type="button"
          onClick={onSubmit}
          disabled={selected === null || busy}
          style={{
            ...button.primary,
            marginTop: space.lg,
            opacity: selected === null || busy ? 0.5 : 1,
          }}
        >
          {busy ? "Checking…" : "Submit answer"}
        </button>
      ) : null}
    </section>
  );
}
