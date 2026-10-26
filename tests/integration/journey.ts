import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * The whole learner journey, driven through the real route handlers against
 * whichever store the calling test file configured. Shared so the default local
 * store and the hosted PostgreSQL store are held to exactly the same
 * assertions. The caller must set the environment before calling this, because
 * the routes are imported here.
 */
export async function defineJourney(options: {
  /** What the upload route should report for where it stored the file. */
  expectedStorage: "local" | "database";
}): Promise<void> {
  const { POST: join } = await import("@/app/api/sessions/join/route");
  const { PUT: putProfile } = await import("@/app/api/sessions/[sid]/profile/route");
  const { GET: getRecap } = await import("@/app/api/sessions/[sid]/recap/route");
  const { POST: startQuiz } = await import("@/app/api/sessions/[sid]/quiz-sessions/route");
  const { GET: nextItem } = await import("@/app/api/sessions/[sid]/quiz-sessions/[qsid]/next/route");
  const { POST: submit } = await import(
    "@/app/api/sessions/[sid]/quiz-sessions/[qsid]/responses/route"
  );
  const { GET: getReport } = await import("@/app/api/sessions/[sid]/reports/[qsid]/route");
  const { GET: getInsight } = await import("@/app/api/sessions/[sid]/insight/route");
  const { GET: getThread } = await import("@/app/api/sessions/[sid]/threads/[topicId]/route");
  const { POST: postExplanation } = await import(
    "@/app/api/sessions/[sid]/threads/[topicId]/explanations/route"
  );
  const { POST: validate } = await import(
    "@/app/api/sessions/[sid]/explanations/[eid]/validate/route"
  );
  const { POST: upload } = await import("@/app/api/sessions/[sid]/material/route");

  const { computeClassMap } = await import("@/lib/domain/classmap");
  const { computeMasterySummary } = await import("@/lib/domain/mastery");
  const { listAllClassResponses } = await import("@/lib/repo/quiz");
  const { listQuizItems } = await import("@/lib/repo/pool");
  const { listTopics } = await import("@/lib/repo/material");
  const { getSession } = await import("@/lib/repo/session");
  const { resetDemo } = await import("@/lib/demo/seed");

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  function req(url: string, learnerId: string | null, init: RequestInit = {}): Request {
    const headers = new Headers(init.headers);
    if (learnerId) headers.set("x-learner-id", learnerId);
    if (init.body && typeof init.body === "string") headers.set("content-type", "application/json");
    return new Request(`http://localhost${url}`, { ...init, headers });
  }

  async function call(
    handler: (request: Request, context: never) => Promise<Response>,
    request: Request,
    params: Record<string, string> = {},
  ): Promise<{ status: number; body: Json }> {
    const response = await handler(request, { params: Promise.resolve(params) } as never);
    return { status: response.status, body: (await response.json()) as Json };
  }

  async function joinAs(joinCode: string, displayName: string) {
    const response = await join(
      req("/api/sessions/join", null, {
        method: "POST",
        body: JSON.stringify({ joinCode, displayName }),
      }),
    );
    return { status: response.status, body: (await response.json()) as Json };
  }

  /** The class map recomputed from the persisted responses, independently of the route. */
  async function expectedMap(sessionId: string) {
    const session = await getSession(sessionId);
    const version = session!.materialVersion;
    const [responses, topics, items] = await Promise.all([
      listAllClassResponses(sessionId),
      listTopics(sessionId, version),
      listQuizItems(sessionId, version),
    ]);
    const ids = new Set(items.map((item) => item.quizItemId));
    return computeClassMap(
      topics.map((topic) => ({ topicId: topic.topicId, name: topic.name })),
      responses.filter((response) => ids.has(response.quizItemId)),
    );
  }


  // ---------------------------------------------------------------------------
  // The journey
  // ---------------------------------------------------------------------------

  let sid = "";
  let learnerId = "";

  beforeAll(async () => {
    const joined = await joinAs("CM2026", "Ada");
    expect(joined.status).toBe(200);
    sid = joined.body.sessionId;
    learnerId = joined.body.learnerId;
  }, 60_000);

  describe("first run", () => {
    it("builds the demo class on the first join, with no configuration", async () => {
      expect(sid).toBe("demo");
      expect(learnerId).toMatch(/^[0-9a-f]{32}$/);

      const session = await getSession("demo");
      expect(session?.name).toMatch(/Relational Databases/);

      const topics = await listTopics("demo", session!.materialVersion);
      expect(topics.map((topic) => topic.name)).toEqual([
        "Normalisation",
        "Second Normal Form",
        "Third Normal Form",
        "Indexing",
        "Denormalisation",
      ]);
    });

    it("also creates the empty upload class", async () => {
      const upload = await getSession("upload");
      expect(upload?.joinCode).toBe("UPLOAD");
    });

    it("rejects an unknown class code and an empty name", async () => {
      expect((await joinAs("NOPE00", "Ada")).status).toBe(404);
      expect((await joinAs("CM2026", "   ")).status).toBe(400);
    });
  });

  describe("profile and recap", () => {
    it("requires a profile before the recap", async () => {
      const { status, body } = await call(getRecap, req(`/api/sessions/${sid}/recap`, learnerId), { sid });
      expect(status).toBe(400);
      expect(body.error.code).toBe("PROFILE_REQUIRED");
    });

    it("rejects an invalid profile", async () => {
      const { status } = await call(
        putProfile,
        req(`/api/sessions/${sid}/profile`, learnerId, {
          method: "PUT",
          body: JSON.stringify({ understandingLevel: "Expert", explanationStyle: "Concise" }),
        }),
        { sid },
      );
      expect(status).toBe(400);
    });

    it("returns a recap personalised to the saved profile, then serves it from cache", async () => {
      const saved = await call(
        putProfile,
        req(`/api/sessions/${sid}/profile`, learnerId, {
          method: "PUT",
          body: JSON.stringify({
            understandingLevel: "No_Understanding",
            explanationStyle: "Step_By_Step",
          }),
        }),
        { sid },
      );
      expect(saved.status).toBe(200);

      const first = await call(getRecap, req(`/api/sessions/${sid}/recap`, learnerId), { sid });
      expect(first.status).toBe(200);
      expect(first.body.understandingLevel).toBe("No_Understanding");
      expect(first.body.explanationStyle).toBe("Step_By_Step");
      expect(first.body.sections.length).toBe(5);
      expect(first.body.takeaways.length).toBeGreaterThan(0);

      const again = await call(getRecap, req(`/api/sessions/${sid}/recap`, learnerId), { sid });
      expect(again.body.source).toBe("cache");
      expect(again.body.sections).toEqual(first.body.sections);

      // A different profile gets a different variant.
      await call(
        putProfile,
        req(`/api/sessions/${sid}/profile`, learnerId, {
          method: "PUT",
          body: JSON.stringify({
            understandingLevel: "Strong_Understanding",
            explanationStyle: "Concise",
          }),
        }),
        { sid },
      );
      const other = await call(getRecap, req(`/api/sessions/${sid}/recap`, learnerId), { sid });
      expect(other.body.understandingLevel).toBe("Strong_Understanding");
      expect(other.body.sections).not.toEqual(first.body.sections);
    });
  });

  describe("the seeded class insight", () => {
    it("publishes a map computed from the stored responses", async () => {
      const { status, body } = await call(getInsight, req(`/api/sessions/${sid}/insight`, learnerId), { sid });
      expect(status).toBe(200);

      const expected = await expectedMap(sid);
      for (const entry of expected) {
        const shown = body.topics.find((topic: Json) => topic.topicId === entry.topicId);
        expect(shown.status).toBe(entry.status);
        if (entry.status === "published") {
          expect(shown.classMastery).toBe(entry.classMastery);
          expect(shown.respondingLearners).toBe(entry.respondingLearners);
        }
      }

      // The seeded class spans several bands and shares one misconception.
      const bands = new Set(body.topics.map((topic: Json) => topic.band).filter(Boolean));
      expect(bands.size).toBeGreaterThanOrEqual(2);
      expect(body.misconceptions.length).toBeGreaterThanOrEqual(1);
      expect(body.respondingLearners).toBe(6);
      expect(JSON.stringify(body)).not.toMatch(/seedlearner|Avery|Blake|learnerId/);
    });
  });

  describe("the adaptive quiz", () => {
    let qsid = "";
    const results: { topicId: string; isCorrect: boolean; difficulty: number }[] = [];

    it("runs six questions, scoring each answer and adapting difficulty", async () => {
      const started = await call(
        startQuiz,
        req(`/api/sessions/${sid}/quiz-sessions`, learnerId, { method: "POST" }),
        { sid },
      );
      expect(started.status).toBe(201);
      qsid = started.body.quizSessionId;

      const items = await listQuizItems(sid, 1);
      const difficulties: number[] = [];

      for (let index = 1; index <= 6; index += 1) {
        const question = await call(
          nextItem,
          req(`/api/sessions/${sid}/quiz-sessions/${qsid}/next`, learnerId),
          { sid, qsid },
        );
        expect(question.body.done).toBe(false);
        expect(question.body.index).toBe(index);

        const item = items.find((entry) => entry.quizItemId === question.body.item.id)!;
        // Right on the first three, wrong on the last three.
        const wantCorrect = index <= 3;
        const option = item.options.find((entry) => entry.isCorrect === wantCorrect)!;

        const feedback = await call(
          submit,
          req(`/api/sessions/${sid}/quiz-sessions/${qsid}/responses`, learnerId, {
            method: "POST",
            body: JSON.stringify({ quizItemId: item.quizItemId, optionId: option.optionId }),
          }),
          { sid, qsid },
        );
        expect(feedback.status).toBe(200);
        expect(feedback.body.isCorrect).toBe(wantCorrect);
        expect(feedback.body.correctOptionId).toBe(item.options.find((entry) => entry.isCorrect)!.optionId);

        difficulties.push(item.difficulty);
        results.push({ topicId: item.topicId, isCorrect: wantCorrect, difficulty: item.difficulty });
      }

      // Two right at the starting level moves up; two wrong later moves down.
      expect(difficulties[0]).toBe(2);
      expect(difficulties[2]).toBe(3);
      expect(Math.min(...difficulties.slice(3))).toBeLessThan(3);

      const done = await call(nextItem, req(`/api/sessions/${sid}/quiz-sessions/${qsid}/next`, learnerId), {
        sid,
        qsid,
      });
      expect(done.body.done).toBe(true);
    });

    it("reports mastery that matches the answers given", async () => {
      const { status, body } = await call(
        getReport,
        req(`/api/sessions/${sid}/reports/${qsid}`, learnerId),
        { sid, qsid },
      );
      expect(status).toBe(200);

      const expected = computeMasterySummary(
        results.map((result) => ({
          topicId: result.topicId,
          isCorrect: result.isCorrect,
          difficultyServed: result.difficulty as 1 | 2 | 3,
        })),
      );
      for (const entry of body.topicMastery) {
        expect(entry.mastery).toBe(expected.topicMastery[entry.topicId]);
      }
      expect(body.weakTopics.map((topic: Json) => topic.topicId).sort()).toEqual(
        [...expected.weakTopics].sort(),
      );
    });

    it("is refused to another learner", async () => {
      const other = await joinAs("CM2026", "Grace");
      const { status } = await call(
        getReport,
        req(`/api/sessions/${sid}/reports/${qsid}`, other.body.learnerId),
        { sid, qsid },
      );
      expect(status).toBe(403);
    });

    it("feeds the class map: seven learners now, still matching the stored responses", async () => {
      const { body } = await call(getInsight, req(`/api/sessions/${sid}/insight`, learnerId), { sid });
      expect(body.respondingLearners).toBe(7);

      const expected = await expectedMap(sid);
      for (const entry of expected.filter((item) => item.status === "published")) {
        const shown = body.topics.find((topic: Json) => topic.topicId === entry.topicId);
        expect(shown.classMastery).toBe(entry.classMastery);
      }
    });
  });

  describe("the study thread", () => {
    it("shows the seeded explanations with their validation statuses", async () => {
      const { status, body } = await call(
        getThread,
        req(`/api/sessions/${sid}/threads/normalisation`, learnerId),
        { sid, topicId: "normalisation" },
      );
      expect(status).toBe(200);
      expect(body.explanations.length).toBe(3);
      expect(body.counts.Validated).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(body)).not.toMatch(/Avery|Blake|Casey/);
    });

    it("rejects a too-short explanation and validates a grounded one", async () => {
      const short = await call(
        postExplanation,
        req(`/api/sessions/${sid}/threads/normalisation/explanations`, learnerId, {
          method: "POST",
          body: JSON.stringify({ text: "too short" }),
        }),
        { sid, topicId: "normalisation" },
      );
      expect(short.status).toBe(400);

      const posted = await call(
        postExplanation,
        req(`/api/sessions/${sid}/threads/normalisation/explanations`, learnerId, {
          method: "POST",
          body: JSON.stringify({
            text: "A table is in first normal form when every column holds a single atomic value and each row is uniquely identified.",
          }),
        }),
        { sid, topicId: "normalisation" },
      );
      expect(posted.status).toBe(201);
      expect(posted.body.status).toBe("Pending");

      const checked = await call(
        validate,
        req(`/api/sessions/${sid}/explanations/${posted.body.id}/validate`, learnerId, { method: "POST" }),
        { sid, eid: posted.body.id },
      );
      expect(checked.status).toBe(200);
      expect(["Validated", "Unsupported", "Contradicted"]).toContain(checked.body.status);

      // Validating again does not re-assess: the first verdict stands.
      const again = await call(
        validate,
        req(`/api/sessions/${sid}/explanations/${posted.body.id}/validate`, learnerId, { method: "POST" }),
        { sid, eid: posted.body.id },
      );
      expect(again.body.status).toBe(checked.body.status);
    });
  });

  describe("uploading a lecture", () => {
    it("turns an uploaded file into a class with topics and a working quiz", async () => {
      const joined = await joinAs("UPLOAD", "Lin");
      expect(joined.status).toBe(200);
      expect(joined.body.material).toBeNull();
      const uploader = joined.body.learnerId;

      const form = new FormData();
      const text = readFileSync(path.join(process.cwd(), "tests/fixtures/lecture-sample.md"));
      form.set("file", new File([text], "my-lecture.md", { type: "text/markdown" }));

      const uploaded = await call(
        upload,
        new Request("http://localhost/api/sessions/upload/material", {
          method: "POST",
          headers: { "x-learner-id": uploader },
          body: form,
        }),
        { sid: "upload" },
      );
      expect(uploaded.status).toBe(201);
      expect(uploaded.body.storage).toBe(options.expectedStorage);
      expect(uploaded.body.topics.length).toBeGreaterThan(0);

      const started = await call(
        startQuiz,
        req("/api/sessions/upload/quiz-sessions", uploader, { method: "POST" }),
        { sid: "upload" },
      );
      expect([201, 409]).toContain(started.status);
    });

    it("refuses an unsupported file type", async () => {
      const joined = await joinAs("UPLOAD", "Lin");
      const form = new FormData();
      form.set("file", new File(["binary"], "slides.pptx"));
      const { status, body } = await call(
        upload,
        new Request("http://localhost/api/sessions/upload/material", {
          method: "POST",
          headers: { "x-learner-id": joined.body.learnerId },
          body: form,
        }),
        { sid: "upload" },
      );
      expect(status).toBe(400);
      expect(body.error.code).toBe("UNSUPPORTED_EXTENSION");
    });
  });

  describe("resetting the demo", () => {
    it("returns both classes to their initial state", async () => {
      await resetDemo();

      // A learner from before the reset is no longer a member…
      const stale = await call(getInsight, req(`/api/sessions/${sid}/insight`, learnerId), { sid });
      expect(stale.status).toBe(403);
      expect(stale.body.error.code).toBe("LEARNER_NOT_IN_SESSION");

      // …the seeded activity is exactly what a fresh clone gets…
      const rejoined = await joinAs("CM2026", "Ada");
      const fresh = await call(
        getInsight,
        req(`/api/sessions/${sid}/insight`, rejoined.body.learnerId),
        { sid },
      );
      expect(fresh.body.respondingLearners).toBe(6);
      expect((await listAllClassResponses("demo")).length).toBe(30);

      // …and the upload class is empty again.
      const upload = await joinAs("UPLOAD", "Lin");
      expect(upload.body.material).toBeNull();
    }, 60_000);
  });

}
