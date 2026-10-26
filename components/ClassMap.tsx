"use client";

import Link from "next/link";

import { IconArrowRight } from "@/components/ui/icons";
import { Badge, Card, MasteryBar } from "@/components/ui/primitives";
import {
  colour,
  masteryTone,
  radius,
  space,
  type,
} from "@/lib/design/tokens";

/**
 * The Class_Understanding_Map.
 *
 * One row per Topic, weakest first, each carrying its percentage and band as
 * text so nothing depends on colour perception. A Topic below the
 * Anonymity_Threshold shows no number at all — the absence is the point, and
 * saying "not enough responses yet" is more honest than a greyed-out figure.
 */

export interface ClassTopicView {
  topicId: string;
  topicName: string;
  status: "published" | "insufficient-data";
  classMastery?: number;
  band?: string;
  bandLabel?: string;
  respondingLearners?: number;
}

export function ClassTopicRow({
  topic,
  sessionId,
  emphasis,
}: {
  topic: ClassTopicView;
  sessionId: string;
  emphasis?: boolean;
}) {
  if (topic.status === "insufficient-data") {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: space.lg,
          padding: `${space.md} 0`,
        }}
      >
        <span style={{ ...type.body, color: colour.muted }}>{topic.topicName}</span>
        <Badge>Not enough responses yet</Badge>
      </div>
    );
  }

  const mastery = topic.classMastery ?? 0;
  const tone = masteryTone(mastery);

  return (
    <Link
      href={`/class/${sessionId}/insight/${topic.topicId}`}
      style={{
        display: "grid",
        gap: space.sm,
        padding: emphasis ? space.lg : `${space.md} ${space.md}`,
        margin: emphasis ? 0 : `0 -${space.md}`,
        borderRadius: radius.md,
        textDecoration: "none",
        color: "inherit",
        background: emphasis ? tone.soft : "transparent",
        border: emphasis ? `1px solid ${tone.border}` : "1px solid transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: space.lg,
        }}
      >
        <span
          style={{
            ...type.body,
            fontWeight: emphasis ? 620 : 400,
            display: "flex",
            alignItems: "center",
            gap: space.sm,
          }}
        >
          {topic.topicName}
          <IconArrowRight size={14} />
        </span>

        <span
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: space.sm,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ ...type.body, fontWeight: 660, color: tone.ink }}>
            {mastery}%
          </span>
          <span style={{ ...type.small, color: colour.muted }}>{tone.label}</span>
        </span>
      </div>

      <MasteryBar value={mastery} tone={tone} />

      {topic.respondingLearners !== undefined ? (
        <span style={{ ...type.small, color: colour.subtle }}>
          {topic.respondingLearners} learners answered
        </span>
      ) : null}
    </Link>
  );
}

export default function ClassMap({
  topics,
  sessionId,
  weakestTopicId,
}: {
  topics: ClassTopicView[];
  sessionId: string;
  weakestTopicId?: string | null;
}) {
  return (
    <Card>
      <div style={{ display: "grid", gap: space.md }}>
        {topics.map((topic) => (
          <ClassTopicRow
            key={topic.topicId}
            topic={topic}
            sessionId={sessionId}
            emphasis={topic.topicId === weakestTopicId}
          />
        ))}
      </div>

      <p
        style={{
          ...type.small,
          color: colour.subtle,
          margin: `${space.xl} 0 0`,
          paddingTop: space.lg,
          borderTop: `1px solid ${colour.border}`,
        }}
      >
        These are class totals only. No individual learner, name or answer appears
        here, and a topic stays hidden until enough classmates have answered it.
      </p>
    </Card>
  );
}
