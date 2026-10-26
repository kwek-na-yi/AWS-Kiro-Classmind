"use client";

import Link from "next/link";

import {
  GAP_LABEL,
  analyseGaps,
  type AnsweredQuestion,
} from "@/components/gap-analysis";
import { IconArrowRight } from "@/components/ui/icons";
import {
  Badge,
  Card,
  MasteryRow,
  PageHeader,
  SectionHeading,
} from "@/components/ui/primitives";
import {
  button,
  colour,
  eyebrow,
  masteryTone,
  radius,
  space,
  type,
} from "@/lib/design/tokens";

/**
 * What you understand — and what you do not.
 *
 * The page leads with the weakest Topic and the kind of gap it is, because that
 * is the one thing worth acting on. The full breakdown sits underneath as
 * evidence, and the class comparison is previewed but never claimed: it opens
 * only when enough classmates have finished for the aggregate to stay anonymous.
 *
 * Every number here is this Learner's own, computed server-side by the
 * deterministic engine. Nothing about anyone else's results reaches this view.
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

/** The anonymity floor the Class_Understanding_Map publishes above. */
const ANONYMITY_THRESHOLD = 3;

export default function UnderstandingReport({
  report,
  sessionId,
  answers = [],
}: {
  report: ReportView;
  sessionId: string;
  /** This session's answers, used to characterise each gap. */
  answers?: AnsweredQuestion[];
}) {
  const gaps = analyseGaps(answers);
  const gapByTopic = new Map(gaps.map((gap) => [gap.topicName, gap]));

  const sorted = [...report.topicMastery].sort((a, b) => a.mastery - b.mastery);
  const weakest = sorted[0];
  const weakestGap = weakest ? gapByTopic.get(weakest.topicName) : undefined;
  const isWeak = weakest ? weakest.mastery < report.weakTopicThreshold : false;
  const tone = weakest ? masteryTone(weakest.mastery) : undefined;

  const strongCount = report.topicMastery.filter((topic) => topic.mastery >= 75).length;

  return (
    <div style={{ display: "grid", gap: space.xxl }}>
      <PageHeader
        eyebrow="Your understanding"
        title={
          isWeak && weakest ? "Start with your weakest topic" : "You are on top of this"
        }
        description={`${strongCount} of ${report.topicMastery.length} topics strong${
          report.highestCorrectDifficulty
            ? ` · answered correctly at ${DIFFICULTY_LABEL[report.highestCorrectDifficulty]} level`
            : ""
        }`}
      />

      {isWeak && weakest && tone ? (
        <Card
          style={{
            padding: space.xxl,
            borderLeft: `4px solid ${tone.colour}`,
          }}
        >
          <div
            className="cm-split"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: space.xxl,
              alignItems: "start",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: space.sm,
                  marginBottom: space.md,
                }}
              >
                <Badge tone="attention">
                  {weakestGap ? GAP_LABEL[weakestGap.kind] : "Weakest topic"}
                </Badge>
              </div>

              <h2 style={{ ...type.pageTitle, margin: `0 0 ${space.sm}` }}>
                {weakest.topicName}
              </h2>

              <p
                style={{
                  ...type.body,
                  color: colour.muted,
                  margin: 0,
                  maxWidth: "58ch",
                }}
              >
                {weakestGap
                  ? weakestGap.summary
                  : `This came out lowest of your topics at ${weakest.mastery}%.`}
              </p>

              <div style={{ marginTop: space.xl, display: "flex", gap: space.md }}>
                <Link
                  href={`/class/${sessionId}/recap#topic-${weakest.topicId}`}
                  style={button.primary}
                >
                  Reread this topic
                </Link>
                <Link href={`/class/${sessionId}/quiz`} style={button.secondary}>
                  Try another six
                </Link>
              </div>
            </div>

            <div
              style={{
                textAlign: "center",
                background: tone.soft,
                border: `1px solid ${tone.border}`,
                borderRadius: radius.lg,
                padding: `${space.xl} ${space.xxl}`,
                minWidth: "150px",
              }}
            >
              <div style={{ ...type.metric, fontSize: "42px", color: tone.ink }}>
                {weakest.mastery}%
              </div>
              <div
                style={{
                  ...type.small,
                  fontWeight: 580,
                  color: tone.ink,
                  marginTop: space.xs,
                }}
              >
                {tone.label}
              </div>
              {weakestGap ? (
                <div style={{ ...type.small, color: colour.muted, marginTop: space.sm }}>
                  {weakestGap.missed} of {weakestGap.answered} missed
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <section>
        <SectionHeading
          eyebrow="Evidence"
          title="Topic by topic"
          description={`Below ${report.weakTopicThreshold}% counts as needing attention. Topics you were not asked about are not shown.`}
        />

        <Card>
          <div style={{ display: "grid", gap: space.xl }}>
            {sorted.map((topic) => {
              const gap = gapByTopic.get(topic.topicName);

              return (
                <MasteryRow
                  key={topic.topicId}
                  label={topic.topicName}
                  value={topic.mastery}
                  note={gap ? GAP_LABEL[gap.kind] : undefined}
                  href={`/class/${sessionId}/recap#topic-${topic.topicId}`}
                />
              );
            })}
          </div>
        </Card>
      </section>

      {/* Your result, then the class result: the handover into the part of the
          product that only makes sense once you know your own gaps. */}
      <Card
        style={{
          padding: space.xxl,
          background: colour.primarySoft,
          borderColor: colour.primaryBorder,
        }}
      >
        <div
          className="cm-split"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: space.xxl,
            alignItems: "center",
          }}
        >
          <div>
            <span style={eyebrow}>Next</span>
            <h2 style={{ ...type.sectionTitle, margin: `0 0 ${space.sm}` }}>
              Is it just you, or the whole class?
            </h2>
            <p
              style={{
                ...type.body,
                color: colour.muted,
                margin: 0,
                maxWidth: "56ch",
              }}
            >
              See where the class as a whole is struggling — aggregated across
              everyone who has answered, with no names and no individual results.
              Topics stay hidden until {ANONYMITY_THRESHOLD} learners have answered
              them.
            </p>
          </div>

          <Link
            href={`/class/${sessionId}/insight`}
            style={{
              ...button.primary,
              display: "inline-flex",
              alignItems: "center",
              gap: space.sm,
              whiteSpace: "nowrap",
            }}
          >
            See how your class is doing
            <IconArrowRight size={16} />
          </Link>
        </div>
      </Card>

      <div>
        <Link href={`/class/${sessionId}/recap`} style={button.secondary}>
          Back to my recap
        </Link>
      </div>
    </div>
  );
}
