"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import RecapSectionPanel, { type RecapSectionView } from "@/components/RecapSection";
import { learnerHeaders, useLearnerId } from "@/hooks/useLearnerId";
import { button, colour, panel, radius, space, type } from "@/lib/design/tokens";

/**
 * Recap — Key_Takeaways followed by one collapsible panel per Topic.
 *
 * The Recap is fetched rather than server-rendered because it is keyed on the
 * Learner's own profile, and the Learner_Id lives in local storage. A retained
 * Recap comes back in one round trip with no generation.
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

type State =
  | { status: "loading" }
  | { status: "ready"; recap: RecapResponse }
  | { status: "error"; code: string; message: string };

export default function RecapPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const { learnerId, ready } = useLearnerId(sessionId);

  const [state, setState] = useState<State>({ status: "loading" });

  // The view opens in its loading state, so the fetch never needs to set state
  // synchronously — every update below happens after an await, and is dropped if
  // the Learner navigates away first.
  useEffect(() => {
    if (!ready || !learnerId) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/recap`, {
          headers: learnerHeaders(learnerId),
        });

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

  if (ready && !learnerId) {
    return (
      <section style={panel}>
        <h1 style={{ ...type.title, marginTop: 0 }}>Join the class first</h1>
        <p style={{ ...type.body, color: colour.muted }}>
          Your recap is personal to you, so you need to join the class before it can
          be prepared.
        </p>
        <Link href="/" style={{ ...button.primary, textDecoration: "none" }}>
          Go to join page
        </Link>
      </section>
    );
  }

  if (state.status === "loading") {
    return (
      <p style={{ ...type.body, color: colour.muted }}>Preparing your recap…</p>
    );
  }

  if (state.status === "error") {
    const needsProfile = state.code === "PROFILE_REQUIRED";

    return (
      <section style={panel} role="alert">
        <h1 style={{ ...type.title, marginTop: 0 }}>
          {needsProfile ? "Choose how you learn" : "The recap is unavailable"}
        </h1>
        <p style={{ ...type.body, color: colour.muted }}>{state.message}</p>
        <Link
          href={`/class/${sessionId}/lecture`}
          style={{ ...button.primary, textDecoration: "none" }}
        >
          Go to Lecture
        </Link>
      </section>
    );
  }

  const { recap } = state;

  return (
    <div style={{ display: "grid", gap: space.lg }}>
      <header>
        <h1 style={{ ...type.display, margin: `0 0 ${space.xs}` }}>Your recap</h1>
        <p style={{ ...type.body, color: colour.muted, margin: 0 }}>
          Written for {recap.understandingLevel.replace(/_/g, " ").toLowerCase()} ·{" "}
          {recap.explanationStyle.replace(/_/g, " ").toLowerCase()} ·{" "}
          <Link href={`/class/${sessionId}/lecture`} style={{ color: colour.accent }}>
            change
          </Link>
        </p>
      </header>

      {recap.mode === "source_extract" ? (
        <p
          style={{
            ...type.small,
            margin: 0,
            padding: space.md,
            background: colour.warningSoft,
            color: colour.warning,
            borderRadius: radius.sm,
          }}
        >
          Showing extracts from the lecture material itself, because the personalised
          recap could not be prepared. Every extract below is quoted from the source.
        </p>
      ) : null}

      <section style={panel}>
        <h2 style={{ ...type.title, margin: `0 0 ${space.md}` }}>Key takeaways</h2>
        <ul style={{ ...type.body, margin: 0, paddingLeft: space.lg }}>
          {recap.takeaways.map((takeaway) => (
            <li key={takeaway} style={{ marginBottom: space.xs }}>
              {takeaway}
            </li>
          ))}
        </ul>
      </section>

      <div style={{ display: "grid", gap: space.sm }}>
        {recap.sections.map((section) => (
          <RecapSectionPanel key={section.topicId} section={section} />
        ))}
      </div>

      <div>
        <Link
          href={`/class/${sessionId}/quiz`}
          style={{ ...button.primary, textDecoration: "none" }}
        >
          Take the 6-question quiz
        </Link>
      </div>
    </div>
  );
}
