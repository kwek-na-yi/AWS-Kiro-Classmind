"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import ClassMap, { type ClassTopicView } from "@/components/ClassMap";
import MisconceptionCard, {
  type MisconceptionView,
} from "@/components/MisconceptionCard";
import { IconArrowRight } from "@/components/ui/icons";
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
  eyebrow,
  masteryTone,
  radius,
  space,
  type,
} from "@/lib/design/tokens";

/**
 * Class Insight — what the class as a whole does not understand.
 *
 * The page tells one story in order: here is the topic the class is weakest on,
 * here is the specific wrong belief behind it, and here is how the rest of the
 * material stands. Everything shown is an aggregate; the endpoint has already
 * stripped every identifier.
 */

interface InsightResponse {
  topics: ClassTopicView[];
  misconceptions: MisconceptionView[];
  anonymityThreshold: number;
  weakestTopicId: string | null;
  respondingLearners: number;
  degraded: string[];
}

type State =
  | { status: "loading" }
  | { status: "ready"; insight: InsightResponse }
  | { status: "error"; message: string };

export default function ClassInsightPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const { learnerId, ready } = useLearnerId(sessionId);

  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!ready || !learnerId) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await learnerFetch(
          sessionId,
          learnerId,
          `/api/sessions/${sessionId}/insight`,
        );

        const body = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setState({
            status: "error",
            message: body?.error?.message ?? "Class insight could not be loaded.",
          });
          return;
        }

        setState({ status: "ready", insight: body as InsightResponse });
      } catch {
        if (!cancelled) {
          setState({ status: "error", message: "Could not reach ClassMind." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, learnerId, sessionId]);

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
          Class insight is shared with the learners in a class.
        </Notice>
      </CenteredState>
    );
  }

  if (state.status === "loading") {
    return <Loading label="Reading the class…" lines={4} />;
  }

  if (state.status === "error") {
    return (
      <CenteredState>
        <Notice tone="weak" title="Class insight is unavailable">
          {state.message}
        </Notice>
      </CenteredState>
    );
  }

  const { insight } = state;

  const published = insight.topics.filter((topic) => topic.status === "published");
  const weakest =
    published.find((topic) => topic.topicId === insight.weakestTopicId) ?? published[0];

  const weakestMisconception = weakest
    ? insight.misconceptions.find((entry) => entry.topicId === weakest.topicId)
    : undefined;

  const tone = weakest ? masteryTone(weakest.classMastery ?? 0) : undefined;

  return (
    <div style={{ display: "grid", gap: space.xxl }}>
      <PageHeader
        eyebrow="Class Insight"
        title={weakest ? "Your class is struggling with…" : "What does your class understand?"}
        description={`Aggregated across ${insight.respondingLearners} ${
          insight.respondingLearners === 1 ? "learner" : "learners"
        }. No names, no individual answers.`}
      />

      {/* Nothing published yet: the threshold is doing its job, and saying so
          is better than showing an empty chart. */}
      {published.length === 0 ? (
        <Notice tone="attention" title="Not enough responses yet">
          A topic appears here once {insight.anonymityThreshold} different learners
          have answered a question on it. That threshold is what keeps class results
          from identifying anyone.
        </Notice>
      ) : null}

      {weakest && tone ? (
        <Card style={{ padding: space.xxl, borderLeft: `4px solid ${tone.colour}` }}>
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
              <h2 style={{ ...type.hero, fontSize: "32px", margin: `0 0 ${space.md}` }}>
                {weakest.topicName}
              </h2>

              <p style={{ ...type.body, color: colour.muted, margin: 0 }}>
                This is the weakest topic across the class — the one worth spending
                the next few minutes on together.
              </p>

              <div style={{ marginTop: space.xl, display: "flex", gap: space.md }}>
                <Link
                  href={`/class/${sessionId}/insight/${weakest.topicId}`}
                  style={{
                    ...button.primary,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: space.sm,
                  }}
                >
                  Study this together
                  <IconArrowRight size={16} />
                </Link>

                <Link
                  href={`/class/${sessionId}/recap#topic-${weakest.topicId}`}
                  style={button.secondary}
                >
                  Reread my recap
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
                minWidth: "170px",
              }}
            >
              <div style={{ ...type.metric, fontSize: "46px", color: tone.ink }}>
                {weakest.classMastery}%
              </div>
              <div style={{ ...type.small, color: colour.muted, marginTop: space.xs }}>
                class understanding
              </div>
              <div
                style={{
                  ...type.small,
                  fontWeight: 620,
                  color: tone.ink,
                  marginTop: space.sm,
                }}
              >
                {tone.label}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {weakest ? (
        <section>
          <SectionHeading eyebrow="Why?" title="What is going wrong" />

          {weakestMisconception ? (
            <MisconceptionCard misconception={weakestMisconception} />
          ) : (
            <Notice tone="neutral" title="No single shared misconception detected">
              Answers on this topic were spread across different options rather than
              concentrating on one wrong idea, so there is no common misconception to
              report yet. That can change as more of the class answers.
            </Notice>
          )}
        </section>
      ) : null}

      {insight.misconceptions.length > 1 ? (
        <section>
          <SectionHeading
            eyebrow="Elsewhere"
            title="Other misconceptions in this class"
            description="Ranked by how many answers chose them."
          />

          <div style={{ display: "grid", gap: space.md }}>
            {insight.misconceptions
              .filter((entry) => entry.topicId !== weakest?.topicId)
              .map((entry) => (
                <MisconceptionCard
                  key={`${entry.topicId}-${entry.misconceptionLabel}`}
                  misconception={entry}
                  showTopic
                />
              ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionHeading
          eyebrow="The whole class"
          title="Class understanding by topic"
          description="Weakest first. Select a topic to study it together."
        />

        <ClassMap
          topics={insight.topics}
          sessionId={sessionId}
          weakestTopicId={insight.weakestTopicId}
        />
      </section>

      {insight.degraded.length > 0 ? (
        <p style={{ ...eyebrow, color: colour.subtle }}>
          Some explanatory text could not be prepared for this view.
        </p>
      ) : null}
    </div>
  );
}
