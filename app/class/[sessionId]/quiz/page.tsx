"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";

import QuizItemCard, {
  type FeedbackView,
  type QuizItemView,
} from "@/components/QuizItemCard";
import ResponseFeedback from "@/components/ResponseFeedback";
import UnderstandingReport, { type ReportView } from "@/components/UnderstandingReport";
import { learnerHeaders, useLearnerId } from "@/hooks/useLearnerId";
import { button, colour, panel, space, type } from "@/lib/design/tokens";

/**
 * Quiz — a six-question adaptive session, one question on screen at a time.
 *
 * The client holds no engine logic: it asks for the next item, submits an
 * answer, and renders what comes back. Which item is served and how the
 * difficulty moves are decided server-side by the deterministic engine.
 */

type Phase =
  | { name: "loading" }
  | { name: "question"; item: QuizItemView; index: number; length: number }
  | { name: "feedback"; item: QuizItemView; index: number; length: number; feedback: FeedbackView }
  | { name: "report"; report: ReportView }
  | { name: "error"; code: string; message: string };

export default function QuizPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const { learnerId, ready } = useLearnerId(sessionId);

  const [quizSessionId, setQuizSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const fail = (body: unknown, fallback: string) => {
    const error = (body as { error?: { code?: string; message?: string } })?.error;
    setPhase({
      name: "error",
      code: error?.code ?? "INTERNAL",
      message: error?.message ?? fallback,
    });
  };

  const loadNext = useCallback(
    async (quizId: string) => {
      if (!learnerId) return;

      const response = await fetch(
        `/api/sessions/${sessionId}/quiz-sessions/${quizId}/next`,
        { headers: learnerHeaders(learnerId) },
      );
      const body = await response.json();

      if (!response.ok) {
        fail(body, "The next question could not be loaded.");
        return;
      }

      if (body.done) {
        const reportResponse = await fetch(
          `/api/sessions/${sessionId}/reports/${quizId}`,
          { headers: learnerHeaders(learnerId) },
        );
        const reportBody = await reportResponse.json();

        if (!reportResponse.ok) {
          fail(reportBody, "Your results could not be loaded.");
          return;
        }

        setPhase({ name: "report", report: reportBody as ReportView });
        return;
      }

      setSelected(null);
      setPhase({
        name: "question",
        item: body.item as QuizItemView,
        index: body.index as number,
        length: body.length as number,
      });
    },
    [learnerId, sessionId],
  );

  // The view opens in its loading state and the session is started once, so no
  // state is set synchronously from the effect — every update follows an await.
  useEffect(() => {
    if (!ready || !learnerId || started.current) return;
    started.current = true;

    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/quiz-sessions`, {
          method: "POST",
          headers: learnerHeaders(learnerId),
        });
        const body = await response.json();

        if (!response.ok) {
          fail(body, "The quiz could not be started.");
          return;
        }

        setQuizSessionId(body.quizSessionId as string);
        await loadNext(body.quizSessionId as string);
      } catch {
        setPhase({
          name: "error",
          code: "INTERNAL",
          message: "Could not reach ClassMind.",
        });
      }
    })();
  }, [ready, learnerId, sessionId, loadNext]);

  async function submit() {
    if (phase.name !== "question" || !selected || !learnerId || !quizSessionId) return;

    setBusy(true);

    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/quiz-sessions/${quizSessionId}/responses`,
        {
          method: "POST",
          headers: learnerHeaders(learnerId),
          body: JSON.stringify({ quizItemId: phase.item.id, optionId: selected }),
        },
      );
      const body = await response.json();

      if (!response.ok) {
        fail(body, "Your answer could not be recorded.");
        return;
      }

      setPhase({
        name: "feedback",
        item: phase.item,
        index: phase.index,
        length: phase.length,
        feedback: body as FeedbackView,
      });
    } catch {
      setPhase({ name: "error", code: "INTERNAL", message: "Could not reach ClassMind." });
    } finally {
      setBusy(false);
    }
  }

  if (ready && !learnerId) {
    return (
      <section style={panel}>
        <h1 style={{ ...type.title, marginTop: 0 }}>Join the class first</h1>
        <Link href="/" style={{ ...button.primary, textDecoration: "none" }}>
          Go to join page
        </Link>
      </section>
    );
  }

  if (phase.name === "error") {
    const poolMissing = phase.code === "POOL_UNAVAILABLE";

    return (
      <section style={panel} role="alert">
        <h1 style={{ ...type.title, marginTop: 0 }}>
          {poolMissing ? "The quiz is not available" : "Something went wrong"}
        </h1>
        <p style={{ ...type.body, color: colour.muted }}>{phase.message}</p>
        <Link
          href={`/class/${sessionId}/recap`}
          style={{ ...button.primary, textDecoration: "none" }}
        >
          Go to my recap
        </Link>
      </section>
    );
  }

  if (phase.name === "report") {
    return <UnderstandingReport report={phase.report} sessionId={sessionId} />;
  }

  if (phase.name === "loading") {
    return <p style={{ ...type.body, color: colour.muted }}>Loading your quiz…</p>;
  }

  return (
    <div style={{ display: "grid", gap: space.md }}>
      <div
        aria-hidden
        style={{
          display: "flex",
          gap: space.xs,
        }}
      >
        {Array.from({ length: phase.length }, (_, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: "4px",
              borderRadius: "2px",
              background: i < phase.index ? colour.accent : colour.border,
            }}
          />
        ))}
      </div>

      <QuizItemCard
        item={phase.item}
        index={phase.index}
        length={phase.length}
        selected={selected}
        onSelect={setSelected}
        onSubmit={submit}
        feedback={phase.name === "feedback" ? phase.feedback : null}
        busy={busy}
      />

      {phase.name === "feedback" ? (
        <ResponseFeedback
          feedback={phase.feedback}
          busy={busy}
          onContinue={() => {
            if (quizSessionId) void loadNext(quizSessionId);
          }}
        />
      ) : null}
    </div>
  );
}
