"use client";

import { Badge, Card } from "@/components/ui/primitives";
import { button, colour, radius, space, type } from "@/lib/design/tokens";
import type { SourceRef } from "@/lib/types";

/**
 * One question.
 *
 * The card carries the question, four answers and nothing else. Correctness
 * only exists here after an answer is submitted, because the served item never
 * contains it.
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
  return <Badge>{DIFFICULTY_LABEL[level]}</Badge>;
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
    <Card style={{ padding: space.xxl }}>
      <h1
        style={{
          ...type.pageTitle,
          fontSize: "22px",
          margin: `0 0 ${space.xxl}`,
          maxWidth: "58ch",
        }}
      >
        {item.stem}
      </h1>

      <fieldset
        style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: space.md }}
      >
        <legend style={{ position: "absolute", left: "-9999px" }}>
          Answer options for question {index} of {length}
        </legend>

        {item.options.map((option) => {
          const isChosen = selected === option.id;
          const isCorrectOption = feedback?.correctOptionId === option.id;
          const isWrongChoice = answered && isChosen && !feedback.isCorrect;

          const accent = isCorrectOption
            ? colour.strong
            : isWrongChoice
              ? colour.weak
              : isChosen
                ? colour.primary
                : colour.border;

          const background = isCorrectOption
            ? colour.strongSoft
            : isWrongChoice
              ? colour.weakSoft
              : isChosen
                ? colour.primarySoft
                : colour.surface;

          const markColour = isCorrectOption
            ? colour.strongInk
            : isWrongChoice
              ? colour.weakInk
              : isChosen
                ? colour.primaryInk
                : colour.subtle;

          return (
            <label
              key={option.id}
              style={{
                position: "relative",
                display: "flex",
                gap: space.lg,
                alignItems: "flex-start",
                padding: space.lg,
                border: `1.5px solid ${accent}`,
                background,
                borderRadius: radius.lg,
                cursor: answered ? "default" : "pointer",
                transition: "border-color 120ms ease, background 120ms ease",
              }}
            >
              <input
                type="radio"
                name={`item-${item.id}`}
                value={option.id}
                checked={isChosen}
                disabled={answered || busy}
                onChange={() => onSelect(option.id)}
                style={{
                  position: "absolute",
                  opacity: 0,
                  width: "1px",
                  height: "1px",
                  margin: "-1px",
                }}
              />

              <span
                aria-hidden
                style={{
                  ...type.small,
                  fontWeight: 680,
                  minWidth: "26px",
                  height: "26px",
                  borderRadius: radius.pill,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: `1.5px solid ${accent}`,
                  color: markColour,
                  background: colour.surface,
                }}
              >
                {option.id.toUpperCase()}
              </span>

              <span style={{ ...type.body, paddingTop: "2px" }}>{option.text}</span>
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
            marginTop: space.xxl,
            opacity: selected === null || busy ? 0.45 : 1,
            cursor: selected === null || busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Checking…" : "Submit answer"}
        </button>
      ) : null}
    </Card>
  );
}
