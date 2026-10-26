"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";

import type { ClassTopicView } from "@/components/ClassMap";
import MisconceptionCard, {
  type MisconceptionView,
} from "@/components/MisconceptionCard";
import StudyThread, { type ExplanationView } from "@/components/StudyThread";
import {
  Card,
  CenteredState,
  Loading,
  Notice,
  PageHeader,
  SectionHeading,
} from "@/components/ui/primitives";
import { learnerFetch, useLearnerId } from "@/hooks/useLearnerId";
import {
  button,
  colour,
  masteryTone,
  radius,
  space,
  type,
} from "@/lib/design/tokens";

/**
 * Study Together — fixing one idea as a class.
 *
 * Not a chat room. The page states where the class stands on this Topic, names
 * the misconception behind it, then shows how classmates have explained it —
 * each one checked against the lecture material before it is recommended.
 */

interface InsightResponse {
  topics: ClassTopicView[];
  misconceptions: MisconceptionView[];
  anonymityThreshold: number;
  weakestTopicId: string | null;
  respondingLearners: number;
}

interface ThreadResponse {
  topicId: string;
  topicName: string;
  explanations: ExplanationView[];
  recommendedCount: number;
  counts: Record<string, number>;
  degraded: string[];
}

export default function StudyTogetherPage({
  params,
}: {
  params: Promise<{ sessionId: string; topicId: string }>;
}) {
  const { sessionId, topicId } = use(params);
  const { learnerId, ready } = useLearnerId(sessionId);

  const [insight, setInsight] = useState<InsightResponse | null>(null);
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadThread = useCallback(async () => {
    if (!learnerId) return;

    const response = await learnerFetch(
      sessionId,
      learnerId,
      `/api/sessions/${sessionId}/threads/${topicId}`,
    );

    const body = await response.json();

    if (!response.ok) {
      setError(body?.error?.message ?? "This study thread could not be loaded.");
      return;
    }

    setThread(body as ThreadResponse);
  }, [learnerId, sessionId, topicId]);

  useEffect(() => {
    if (!ready || !learnerId) return;

    let cancelled = false;

    void (async () => {
      try {
        const [insightResponse] = await Promise.all([
          learnerFetch(sessionId, learnerId, `/api/sessions/${sessionId}/insight`),
          loadThread(),
        ]);

        if (cancelled) return;

        if (insightResponse.ok) {
          setInsight((await insightResponse.json()) as InsightResponse);
        }
      } catch {
        if (!cancelled) setError("Could not reach ClassMind.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, learnerId, sessionId, loadThread]);

  if (ready && !learnerId) {
    return (
      <CenteredState>
        <Notice
          tone="primary"
          title="Join the class first"
          action={
            <Link href="/" style={button.primary}>
              Go to join page
            </Link>
          }
        >
          The study space is shared with the learners in a class.
        </Notice>
      </CenteredState>
    );
  }

  if (loading) {
    return <Loading label="Opening the study space…" lines={4} />;
  }

  if (error) {
    return (
      <CenteredState>
        <Notice
          tone="weak"
          title="This topic is unavailable"
          action={
            <Link href={`/class/${sessionId}/insight`} style={button.primary}>
              Back to Class Insight
            </Link>
          }
        >
          {error}
        </Notice>
      </CenteredState>
    );
  }

  const topic = insight?.topics.find((entry) => entry.topicId === topicId);
  const misconception = insight?.misconceptions.find(
    (entry) => entry.topicId === topicId,
  );
  const topicName = thread?.topicName ?? topic?.topicName ?? "This topic";

  const published = topic?.status === "published";
  const mastery = topic?.classMastery ?? 0;
  const tone = masteryTone(mastery);

  return (
    <div style={{ display: "grid", gap: space.xxl }}>
      {/* The way back sits above the title, where a reader looks for it, rather
          than orphaned between the header and the first section. */}
      <Link
        href={`/class/${sessionId}/insight`}
        style={{
          ...type.small,
          color: colour.primaryInk,
          textDecoration: "none",
          marginBottom: `-${space.lg}`,
        }}
      >
        ← Back to Class Insight
      </Link>

      <PageHeader
        eyebrow="Study together"
        title={topicName}
        description="How can we fix this concept together? Every explanation below is checked against the lecture material."
        aside={
          published ? (
            <div
              style={{
                textAlign: "center",
                background: tone.soft,
                border: `1px solid ${tone.border}`,
                borderRadius: radius.md,
                padding: `${space.md} ${space.xl}`,
                whiteSpace: "nowrap",
              }}
            >
              <div style={{ ...type.metric, fontSize: "26px", color: tone.ink }}>
                {mastery}%
              </div>
              <div style={{ ...type.small, color: colour.muted }}>class understanding</div>
            </div>
          ) : undefined
        }
      />

      {!published ? (
        <Notice tone="attention" title="Not enough responses on this topic yet">
          Class results appear once {insight?.anonymityThreshold ?? 3} different
          learners have answered a question on it. You can still read and contribute
          explanations below.
        </Notice>
      ) : null}

      {misconception ? (
        <section>
          <SectionHeading eyebrow="Why it is difficult" title="The common misconception" />
          <MisconceptionCard misconception={misconception} />
        </section>
      ) : (
        <Card>
          <p style={{ ...type.body, color: colour.muted, margin: 0 }}>
            No single shared misconception has been detected for this topic — answers
            were spread rather than concentrated on one wrong idea.
          </p>
        </Card>
      )}

      <StudyThread
        sessionId={sessionId}
        topicId={topicId}
        learnerId={learnerId}
        explanations={thread?.explanations ?? []}
        onSubmitted={() => void loadThread()}
      />
    </div>
  );
}
