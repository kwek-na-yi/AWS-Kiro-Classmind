"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import RecapSectionPanel, { type RecapSectionView } from "@/components/RecapSection";
import { IconArrowRight } from "@/components/ui/icons";
import {
  Card,
  CenteredState,
  Loading,
  Notice,
  NumberChip,
  PageHeader,
  SectionHeading,
} from "@/components/ui/primitives";
import { useLastQuizSession } from "@/hooks/useLastQuizSession";
import { learnerFetch, useLearnerId } from "@/hooks/useLearnerId";
import {
  button,
  colour,
  eyebrow,
  radius,
  space,
  type,
} from "@/lib/design/tokens";

/**
 * Recap — what you need to know, written for the profile you chose.
 *
 * Leads with the three ideas that matter most, then the Topics underneath as
 * cards that open. After a check, the Topics that did not hold up are lifted
 * into a Watch For card, so the second visit opens on the thing worth
 * rereading rather than on paragraph one.
 */

interface RecapResponse {
  mode: "generated" | "source_extract";
  source: "cache" | "generated" | "fallback";
  understandingLevel: string;
  explanationStyle: string;
  takeaways: string[];
  sections: RecapSectionView[];
  degraded: string[];
}

interface ReportResponse {
  weakTopics: { topicId: string; topicName: string }[];
}

type State =
  | { status: "loading" }
  | { status: "ready"; recap: RecapResponse }
  | { status: "error"; code: string; message: string };

const HERO_TAKEAWAYS = 3;

function readable(value: string): string {
  return value.replace(/_/g, " ").toLowerCase();
}

export default function RecapPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const { learnerId, ready } = useLearnerId(sessionId);
  const lastQuizSessionId = useLastQuizSession(sessionId);

  const [state, setState] = useState<State>({ status: "loading" });
  const [weakTopicIds, setWeakTopicIds] = useState<string[]>([]);

  useEffect(() => {
    if (!ready || !learnerId) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await learnerFetch(
          sessionId,
          learnerId,
          `/api/sessions/${sessionId}/recap`,
        );

        const body = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setState({
            status: "error",
            code: body?.error?.code ?? "INTERNAL",
            message: body?.error?.message ?? "The recap could not be loaded.",
          });
          return;
        }

        setState({ status: "ready", recap: body as RecapResponse });
      } catch {
        if (!cancelled) {
          setState({
            status: "error",
            code: "INTERNAL",
            message: "Could not reach ClassMind.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, learnerId, sessionId]);

  // Where the Learner has already been checked, mark what they got wrong. This
  // reads their own report through the existing endpoint; no report simply
  // means no marks.
  useEffect(() => {
    if (!ready || !learnerId || !lastQuizSessionId) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await learnerFetch(
          sessionId,
          learnerId,
          `/api/sessions/${sessionId}/reports/${lastQuizSessionId}`,
        );

        if (!response.ok) return;

        const body = (await response.json()) as ReportResponse;
        if (cancelled) return;

        setWeakTopicIds(body.weakTopics.map((topic) => topic.topicId));
      } catch {
        // A missing report is not an error worth showing on the recap.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, learnerId, sessionId, lastQuizSessionId]);

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
          Your recap is written for you, so you need to join before it can be prepared.
        </Notice>
      </CenteredState>
    );
  }

  if (state.status === "loading") {
    return <Loading label="Writing your recap…" lines={5} />;
  }

  if (state.status === "error") {
    const needsProfile = state.code === "PROFILE_REQUIRED";
    const needsMaterial = state.code === "MATERIAL_REQUIRED";

    return (
      <CenteredState>
        <Notice
          tone={needsProfile ? "primary" : needsMaterial ? "attention" : "weak"}
          title={
            needsProfile
              ? "Tell us how you learn first"
              : needsMaterial
                ? "No lecture material yet"
                : "The recap is unavailable"
          }
          action={
            <Link href={`/class/${sessionId}/lecture`} style={button.primary}>
              {needsMaterial ? "Upload lecture material" : "Set up my recap"}
            </Link>
          }
        >
          {state.message}
        </Notice>
      </CenteredState>
    );
  }

  const { recap } = state;
  const hero = recap.takeaways.slice(0, HERO_TAKEAWAYS);
  const rest = recap.takeaways.slice(HERO_TAKEAWAYS);
  const weak = new Set(weakTopicIds);
  const weakSections = recap.sections.filter((section) => weak.has(section.topicId));

  return (
    <div style={{ display: "grid", gap: space.xxl }}>
      <PageHeader
        eyebrow="Your recap"
        title={`${hero.length} things you need to know`}
        description={`Written for ${readable(recap.understandingLevel)} · ${readable(recap.explanationStyle)}`}
        aside={
          <Link
            href={`/class/${sessionId}/lecture`}
            style={{ ...button.secondary, whiteSpace: "nowrap" }}
          >
            Change how this reads
          </Link>
        }
      />

      {recap.mode === "source_extract" ? (
        <Notice tone="attention" title="Showing the source material itself">
          The personalised recap could not be prepared, so everything below is quoted
          directly from your instructor&rsquo;s material.
        </Notice>
      ) : null}

      <section
        className="cm-grid-3"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(hero.length, 1)}, 1fr)`,
          gap: space.lg,
        }}
      >
        {hero.map((takeaway, index) => (
          <Card
            key={takeaway}
            style={{ borderTop: `3px solid ${colour.primary}`, paddingTop: space.lg }}
          >
            <NumberChip value={index + 1} />
            <p style={{ ...type.body, margin: `${space.md} 0 0`, fontWeight: 500 }}>
              {takeaway}
            </p>
          </Card>
        ))}
      </section>

      {weakSections.length > 0 ? (
        <Card
          style={{
            background: colour.attentionSoft,
            borderColor: colour.attentionBorder,
            borderLeft: `4px solid ${colour.attention}`,
          }}
        >
          <span style={{ ...eyebrow, color: colour.attentionInk }}>Watch for</span>
          <h2 style={{ ...type.sectionTitle, margin: `0 0 ${space.sm}` }}>
            These are the ideas you are most likely to misunderstand
          </h2>
          <p style={{ ...type.body, color: colour.muted, margin: `0 0 ${space.lg}` }}>
            They did not hold up when you were last checked. Each one is marked below.
          </p>

          <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap" }}>
            {weakSections.map((section) => (
              <Link
                key={section.topicId}
                href={`#topic-${section.topicId}`}
                style={{
                  ...type.small,
                  fontWeight: 580,
                  color: colour.attentionInk,
                  background: colour.surface,
                  border: `1px solid ${colour.attentionBorder}`,
                  borderRadius: radius.pill,
                  padding: `5px ${space.lg}`,
                  textDecoration: "none",
                }}
              >
                {section.topicName}
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <section>
        <SectionHeading eyebrow="In depth" title="The ideas in this lecture" />

        <div style={{ display: "grid", gap: space.md }}>
          {recap.sections.map((section, index) => (
            <RecapSectionPanel
              key={section.topicId}
              section={section}
              index={index}
              defaultOpen={weak.size > 0 ? weak.has(section.topicId) : index === 0}
              needsAttention={weak.has(section.topicId)}
            />
          ))}
        </div>
      </section>

      {rest.length > 0 ? (
        <Card>
          <span style={eyebrow}>Also worth remembering</span>
          <ul
            style={{
              ...type.body,
              margin: 0,
              paddingLeft: space.xl,
              color: colour.muted,
            }}
          >
            {rest.map((takeaway) => (
              <li key={takeaway} style={{ marginBottom: space.xs }}>
                {takeaway}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        style={{
          background: colour.primarySoft,
          borderColor: colour.primaryBorder,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.xl,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ ...type.sectionTitle, margin: `0 0 ${space.xs}` }}>
            Do you actually understand it?
          </h2>
          <p style={{ ...type.body, color: colour.muted, margin: 0 }}>
            Six questions that get harder as you get them right. About two minutes.
          </p>
        </div>

        <Link
          href={`/class/${sessionId}/quiz`}
          style={{
            ...button.primary,
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: space.sm,
          }}
        >
          Check my understanding
          <IconArrowRight size={16} />
        </Link>
      </Card>
    </div>
  );
}
