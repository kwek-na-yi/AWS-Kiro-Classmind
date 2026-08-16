"use client";

import Link from "next/link";

import { button, colour, panel, radius, space, type } from "@/lib/design/tokens";

/**
 * The Understanding_Report: per-Topic mastery, the weak Topics, and the highest
 * level answered correctly.
 *
 * These are this Learner's own numbers, computed from their own responses. No
 * class aggregate and no other Learner appears here.
 */

export interface ReportView {
  quizSessionId: string;
  topicMastery: { topicId: string; topicName: string; mastery: number }[];
  weakTopics: { topicId: string; topicName: string; recapAnchor: string }[];
  weakTopicThreshold: number;
  highestCorrectDifficulty: 1 | 2 | 3 | null;
  guidance: string[];
  guidanceMode: "generated" | "omitted";
}

const DIFFICULTY_LABEL: Record<1 | 2 | 3, string> = {
  1: "foundational",
  2: "intermediate",
  3: "advanced",
};

function MasteryBar({ value }: { value: number }) {
  const tone =
    value >= 75 ? colour.positive : value >= 60 ? colour.accent : colour.warning;

  return (
    <div
      style={{
        height: "8px",
        background: colour.canvas,
        borderRadius: radius.sm,
        overflow: "hidden",
        border: `1px solid ${colour.border}`,
      }}
    >
      <div style={{ width: `${value}%`, height: "100%", background: tone }} />
    </div>
  );
}

export default function UnderstandingReport({
  report,
  sessionId,
}: {
  report: ReportView;
  sessionId: string;
}) {
  return (
    <div style={{ display: "grid", gap: space.lg }}>
      <header>
        <h1 style={{ ...type.display, margin: `0 0 ${space.xs}` }}>Your understanding</h1>
        <p style={{ ...type.body, color: colour.muted, margin: 0 }}>
          {report.highestCorrectDifficulty
            ? `You answered correctly at ${DIFFICULTY_LABEL[report.highestCorrectDifficulty]} level.`
            : "No questions were answered correctly in this session."}
        </p>
      </header>

      <section style={panel}>
        <h2 style={{ ...type.title, margin: `0 0 ${space.md}` }}>Topic by topic</h2>

        <div style={{ display: "grid", gap: space.md }}>
          {report.topicMastery.map((topic) => (
            <div key={topic.topicId} style={{ display: "grid", gap: space.xs }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ ...type.body }}>{topic.topicName}</span>
                <span style={{ ...type.body, fontWeight: 600 }}>{topic.mastery}%</span>
              </div>
              <MasteryBar value={topic.mastery} />
            </div>
          ))}
        </div>
      </section>

      {report.weakTopics.length > 0 ? (
        <section style={panel}>
          <h2 style={{ ...type.title, margin: `0 0 ${space.sm}` }}>Worth another look</h2>
          <p style={{ ...type.body, color: colour.muted, margin: `0 0 ${space.md}` }}>
            Below {report.weakTopicThreshold}% on these topics.
          </p>

          <ul style={{ ...type.body, margin: 0, paddingLeft: space.lg }}>
            {report.weakTopics.map((topic) => (
              <li key={topic.topicId} style={{ marginBottom: space.xs }}>
                <Link
                  href={`/class/${sessionId}/recap${topic.recapAnchor}`}
                  style={{ color: colour.accent }}
                >
                  {topic.topicName}
                </Link>{" "}
                <span style={{ ...type.small, color: colour.muted }}>
                  — reread this section of your recap
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section style={panel}>
          <h2 style={{ ...type.title, margin: 0 }}>No weak topics in this session</h2>
        </section>
      )}

      <div style={{ display: "flex", gap: space.sm }}>
        <Link
          href={`/class/${sessionId}/recap`}
          style={{ ...button.secondary, textDecoration: "none" }}
        >
          Back to my recap
        </Link>
      </div>
    </div>
  );
}
