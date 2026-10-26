"use client";

import { Badge, Card } from "@/components/ui/primitives";
import { colour, eyebrow, radius, space, type } from "@/lib/design/tokens";
import type { SourceRef } from "@/lib/types";

/**
 * The shared misconception behind a weak Topic.
 *
 * This is the answer to "why?" — not that the class scored badly, but that a
 * particular wrong belief was chosen by a measurable share of them. The share
 * is a real count over real responses; when no Distractor clears the
 * thresholds, the caller shows the empty state instead of this card.
 */

export interface MisconceptionView {
  topicId: string;
  topicName: string;
  sharePercent: number;
  misconceptionLabel: string;
  clarification?: string;
  sourceRef?: SourceRef;
}

export default function MisconceptionCard({
  misconception,
  showTopic,
}: {
  misconception: MisconceptionView;
  showTopic?: boolean;
}) {
  return (
    <Card
      style={{
        background: colour.attentionSoft,
        borderColor: colour.attentionBorder,
        borderLeft: `4px solid ${colour.attention}`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: space.xl,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <span style={{ ...eyebrow, color: colour.attentionInk }}>
            Common misconception
          </span>

          {showTopic ? (
            <Badge tone="attention" style={{ marginBottom: space.sm }}>
              {misconception.topicName}
            </Badge>
          ) : null}

          <h3
            style={{
              ...type.sectionTitle,
              margin: `0 0 ${space.sm}`,
              maxWidth: "56ch",
            }}
          >
            {misconception.misconceptionLabel}
          </h3>

          <p style={{ ...type.body, color: colour.muted, margin: 0 }}>
            <strong style={{ color: colour.attentionInk }}>
              {misconception.sharePercent}% of answers
            </strong>{" "}
            to this question chose it.
          </p>
        </div>

        <div
          style={{
            textAlign: "center",
            background: colour.surface,
            border: `1px solid ${colour.attentionBorder}`,
            borderRadius: radius.md,
            padding: `${space.md} ${space.lg}`,
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ ...type.metric, fontSize: "26px", color: colour.attentionInk }}>
            {misconception.sharePercent}%
          </div>
          <div style={{ ...type.small, color: colour.muted }}>picked this</div>
        </div>
      </div>

      {misconception.clarification ? (
        <div
          style={{
            marginTop: space.lg,
            paddingTop: space.lg,
            borderTop: `1px solid ${colour.attentionBorder}`,
          }}
        >
          <span style={eyebrow}>What the material actually says</span>
          <p style={{ ...type.body, margin: 0, maxWidth: "70ch" }}>
            {misconception.clarification}
          </p>
          {misconception.sourceRef ? (
            <p style={{ ...type.small, color: colour.subtle, margin: `${space.sm} 0 0` }}>
              Source: {misconception.sourceRef.value}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
