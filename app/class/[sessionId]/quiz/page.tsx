"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";

import QuizItemCard, {
  DifficultyPill,
  type FeedbackView,
  type QuizItemView,
} from "@/components/QuizItemCard";
import ResponseFeedback from "@/components/ResponseFeedback";
import UnderstandingReport, { type ReportView } from "@/components/UnderstandingReport";
import type { AnsweredQuestion } from "@/components/gap-analysis";
import { CenteredState, Loading, Notice, StepProgress } from "@/components/ui/primitives";
import { writeLastQuizSession } from "@/hooks/useLastQuizSession";
import { learnerFetch, useLearnerId } from "@/hooks/useLearnerId";
import { button, colour, space, type } from "@/lib/design/tokens";

/**
 * The check — six questions, one at a time, nothing else on screen.
 *
 * The client holds no engine logic: it asks for the next item, submits an
 * answer, and renders what comes back. Which item is served and how the
 * difficulty moves are decided server-side.
 *
 * It does keep a record of this session's answers — Topic, level, correctness —
 * which the results view reads to say *what kind* of gap each weak Topic is.
 * That is presentation over the Learner's own answers; no score is recomputed.
 */

type Phase =
  | { name: "loading" }
  | { name: "question"; item: QuizItemView; index: number; length: number }
  | {
      name: "feedback";
      item: QuizItemView;
      index: number;
      length: number;
      feedback: FeedbackView;
    }
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
  const [answers, setAnswers] = useState<AnsweredQuestion[]>([]);
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

      const response = await learnerFetch(
        sessionId,
        learnerId,
        `/api/sessions/${sessionId}/quiz-sessions/${quizId}/next`,
      );
      const body = await response.json();

      if (!response.ok) {
        fail(body, "The next question could not be loaded.");
        return;
      }

      if (body.done) {
        const reportResponse = await learnerFetch(
          sessionId,
          learnerId,
          `/api/sessions/${sessionId}/reports/${quizId}`,
        );
        const reportBody = await reportResponse.json();

        if (!reportResponse.ok) {
          fail(reportBody, "Your results could not be loaded.");
          return;
        }

        // Remembered so the recap can mark what did not hold up.
        writeLastQuizSession(sessionId, quizId);
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

  useEffect(() => {
    if (!ready || !learnerId || started.current) return;
    started.current = true;

    void (async () => {
      try {
        const response = await learnerFetch(
          sessionId,
          learnerId,
          `/api/sessions/${sessionId}/quiz-sessions`,
          { method: "POST" },
        );
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
      const response = await learnerFetch(
        sessionId,
        learnerId,
        `/api/sessions/${sessionId}/quiz-sessions/${quizSessionId}/responses`,
        {
          method: "POST",
          body: JSON.stringify({ quizItemId: phase.item.id, optionId: selected }),
        },
      );
      const body = await response.json();

      if (!response.ok) {
        fail(body, "Your answer could not be recorded.");
        return;
      }

      const feedback = body as FeedbackView;

      setAnswers((previous) => [
        ...previous,
        {
          topicName: phase.item.topicName,
          difficulty: phase.item.difficulty,
          isCorrect: feedback.isCorrect,
        },
      ]);

      setPhase({
        name: "feedback",
        item: phase.item,
        index: phase.index,
        length: phase.length,
        feedback,
      });
    } catch {
      setPhase({
        name: "error",
        code: "INTERNAL",
        message: "Could not reach ClassMind.",
      });
    } finally {
      setBusy(false);
    }
  }

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
          The check is personal to you, so you need to join before it can start.
        </Notice>
      </CenteredState>
    );
  }

  if (phase.name === "error") {
    const poolMissing = phase.code === "POOL_UNAVAILABLE";

    return (
      <CenteredState>
        <Notice
          tone={poolMissing ? "attention" : "weak"}
          title={poolMissing ? "No questions for this class yet" : "Something went wrong"}
          action={
            <Link href={`/class/${sessionId}/recap`} style={button.primary}>
              Go to my recap
            </Link>
          }
        >
          {phase.message}
        </Notice>
      </CenteredState>
    );
  }

  if (phase.name === "report") {
    return (
      <UnderstandingReport
        report={phase.report}
        sessionId={sessionId}
        answers={answers}
      />
    );
  }

  if (phase.name === "loading") {
    return <Loading label="Preparing your check…" lines={4} />;
  }

  return (
    <div style={{ display: "grid", gap: space.lg, maxWidth: "760px" }}>
      <div style={{ display: "grid", gap: space.md }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              ...type.label,
              color: colour.subtle,
              display: "flex",
              gap: space.sm,
            }}
          >
            <span style={{ color: colour.primaryInk }}>{phase.item.topicName}</span>
            <span aria-hidden>·</span>
            <span>
              Question {phase.index} of {phase.length}
            </span>
          </span>

          <DifficultyPill level={phase.item.difficulty} />
        </div>

        <StepProgress current={phase.index} total={phase.length} />
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
