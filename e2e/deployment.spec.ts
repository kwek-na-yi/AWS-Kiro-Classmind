import { expect, test } from "@playwright/test";

/**
 * Checks that only make sense against the hosted public demo: the protections
 * it adds, and that data lives in the shared database rather than in one
 * server instance. Skipped for a local run.
 */

test.skip(!process.env.E2E_BASE_URL, "deployment checks need E2E_BASE_URL");
test.describe.configure({ mode: "serial" });

async function join(request: import("@playwright/test").APIRequestContext, code: string, name: string) {
  const response = await request.post("/api/sessions/join", {
    data: { joinCode: code, displayName: name },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { sessionId: string; learnerId: string };
}

test("every page is served with the security headers", async ({ request }) => {
  for (const path of ["/", "/class/demo/lecture", "/api/sessions/join"]) {
    const response = path.startsWith("/api")
      ? await request.post(path, { data: {} })
      : await request.get(path);
    const headers = response.headers();
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["x-powered-by"], path).toBeUndefined();
  }
});

test("the join page says this is a shared public demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("public-demo-notice")).toContainText("reset daily");
});

test("the reset endpoint refuses anyone without the secret", async ({ request }) => {
  expect((await request.get("/api/admin/reset-demo")).status()).toBe(401);
  expect(
    (await request.get("/api/admin/reset-demo", { headers: { authorization: "Bearer guess" } })).status(),
  ).toBe(401);
});

test("the shared demo lecture cannot be replaced", async ({ page, request }) => {
  const { learnerId } = await join(request, "CM2026", "Probe");

  const response = await request.post("/api/sessions/demo/material", {
    headers: { "x-learner-id": learnerId },
    multipart: { file: { name: "x.md", mimeType: "text/markdown", buffer: Buffer.from("# Replaced\n\nGone.") } },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe("DEMO_READ_ONLY");

  await page.goto("/");
  await page.getByLabel("Your name").fill("Probe");
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page.getByText(/can.t\s+be replaced/)).toBeVisible();
  await expect(page.getByText("demo-lecture.md").first()).toBeVisible();
});

test("uploads state and enforce the platform's 4 MB ceiling", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("Class code").fill("UPLOAD");
  await page.getByLabel("Your name").fill("Probe");
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page.getByText(/up to\s+4\.0 MB/)).toBeVisible();

  const { learnerId } = await join(request, "UPLOAD", "Probe");
  const response = await request.post("/api/sessions/upload/material", {
    headers: { "x-learner-id": learnerId },
    multipart: {
      file: { name: "big.txt", mimeType: "text/plain", buffer: Buffer.alloc(4 * 1024 * 1024 + 10, 97) },
    },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error.code).toBe("MATERIAL_TOO_LARGE");
});

test("data is shared through the database, not held by one server instance", async ({ browser }) => {
  // Two unrelated browsers. What one does must be visible to the other on fresh
  // requests, which can land on different serverless instances.
  const first = await browser.newContext();
  const second = await browser.newContext();

  const a = await join(first.request, "CM2026", "Alpha");
  const before = await (
    await second.request.get("/api/sessions/demo/insight", {
      headers: { "x-learner-id": (await join(second.request, "CM2026", "Beta")).learnerId },
    })
  ).json();

  await first.request.put("/api/sessions/demo/profile", {
    headers: { "x-learner-id": a.learnerId },
    data: { understandingLevel: "Basic_Understanding", explanationStyle: "Concise" },
  });

  // Answer one full quiz as Alpha.
  const started = await (
    await first.request.post("/api/sessions/demo/quiz-sessions", { headers: { "x-learner-id": a.learnerId } })
  ).json();
  for (let i = 0; i < 6; i += 1) {
    const next = await (
      await first.request.get(`/api/sessions/demo/quiz-sessions/${started.quizSessionId}/next`, {
        headers: { "x-learner-id": a.learnerId },
      })
    ).json();
    const answered = await first.request.post(
      `/api/sessions/demo/quiz-sessions/${started.quizSessionId}/responses`,
      {
        headers: { "x-learner-id": a.learnerId },
        data: { quizItemId: next.item.id, optionId: next.item.options[0].id },
      },
    );
    expect(answered.status()).toBe(200);
  }

  // A fresh request context for Beta sees Alpha counted in the class.
  const betaAgain = await browser.newContext();
  const b = await join(betaAgain.request, "CM2026", "Beta2");
  const after = await (
    await betaAgain.request.get("/api/sessions/demo/insight", { headers: { "x-learner-id": b.learnerId } })
  ).json();
  expect(after.respondingLearners).toBe(before.respondingLearners + 1);

  // And Alpha's own profile and report survive in independent requests.
  const recap = await betaAgain.request.get("/api/sessions/demo/recap", {
    headers: { "x-learner-id": a.learnerId },
  });
  expect(recap.status()).toBe(200);
  expect((await recap.json()).explanationStyle).toBe("Concise");

  await Promise.all([first.close(), second.close(), betaAgain.close()]);
});

test("simultaneous duplicate answers are recorded exactly once", async ({ request }) => {
  // Five requests at once, each choosing a different option for the same
  // question, can reach different instances and database connections. The
  // conditional transaction must let exactly one through, and every response
  // must describe that one recorded answer.
  const { learnerId } = await join(request, "CM2026", "Racer");
  const headers = { "x-learner-id": learnerId };

  const started = await (await request.post("/api/sessions/demo/quiz-sessions", { headers })).json();
  const qsid = started.quizSessionId as string;
  const question = await (
    await request.get(`/api/sessions/demo/quiz-sessions/${qsid}/next`, { headers })
  ).json();
  const options = question.item.options as { id: string }[];

  const results = await Promise.all(
    [0, 1, 2, 3, 0].map((index) =>
      request
        .post(`/api/sessions/demo/quiz-sessions/${qsid}/responses`, {
          headers,
          data: { quizItemId: question.item.id, optionId: options[index].id },
        })
        .then(async (response) => ({ status: response.status(), body: await response.json() })),
    ),
  );

  for (const result of results) expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(results.filter((result) => !result.body.duplicate)).toHaveLength(1);
  expect(new Set(results.map((result) => result.body.isCorrect)).size).toBe(1);
  expect(new Set(results.map((result) => result.body.index))).toEqual(new Set([1]));

  // A repeat afterwards still reports the first answer, and the quiz moves on
  // to question 2 — one response recorded, not five.
  const next = await (
    await request.get(`/api/sessions/demo/quiz-sessions/${qsid}/next`, { headers })
  ).json();
  expect(next.index).toBe(2);
});

test("simultaneous validation requests assess an explanation once", async ({ request }) => {
  const { learnerId } = await join(request, "CM2026", "Explainer");
  const headers = { "x-learner-id": learnerId };

  const posted = await (
    await request.post("/api/sessions/demo/threads/indexing/explanations", {
      headers,
      data: { text: "An index speeds up reads and slows down writes, because every index must be updated." },
    })
  ).json();

  const verdicts = await Promise.all(
    Array.from({ length: 4 }, () =>
      request
        .post(`/api/sessions/demo/explanations/${posted.id}/validate`, { headers })
        .then(async (response) => ({ status: response.status(), body: await response.json() })),
    ),
  );

  for (const verdict of verdicts) expect(verdict.status).toBe(200);
  const settled = verdicts.filter((verdict) => verdict.body.status !== "Pending");
  expect(settled.length).toBeGreaterThanOrEqual(1);
  expect(new Set(settled.map((verdict) => verdict.body.status)).size).toBe(1);
});

test("invalid requests get meaningful errors, not crashes", async ({ request }) => {
  // An unparseable body reads as empty (lib/http/pipeline.ts `readJson`), so a
  // join without a class code gets the documented SESSION_NOT_FOUND answer —
  // a coded error, never a 500.
  const badJson = await request.post("/api/sessions/join", {
    headers: { "content-type": "application/json" },
    data: "{not json",
  });
  expect(badJson.status()).toBe(404);
  expect((await badJson.json()).error).toMatchObject({
    code: "SESSION_NOT_FOUND",
    field: "joinCode",
  });

  const { learnerId } = await join(request, "CM2026", "Probe");
  const badProfile = await request.put("/api/sessions/demo/profile", {
    headers: { "content-type": "application/json", "x-learner-id": learnerId },
    data: "{not json",
  });
  expect(badProfile.status()).toBe(400);
  expect((await badProfile.json()).error.code).toBe("INVALID_PROFILE");

  const unknownCode = await request.post("/api/sessions/join", {
    data: { joinCode: "ZZZZZZ", displayName: "Probe" },
  });
  expect(unknownCode.status()).toBe(404);

  const noLearner = await request.get("/api/sessions/demo/insight");
  expect(noLearner.status()).toBe(403);
  expect((await noLearner.json()).error.code).toBe("LEARNER_NOT_IN_SESSION");

  const strangerReport = await request.get("/api/sessions/demo/reports/nope", {
    headers: { "x-learner-id": "0".repeat(32) },
  });
  expect(strangerReport.status()).toBe(403);
});

test("rate limits refuse a flood of joins, and an operator reset clears them", async ({ request }) => {
  // Last on purpose: it spends this connection's join budget, then restores it.
  const token = process.env.E2E_RESET_TOKEN;
  test.skip(!token, "needs E2E_RESET_TOKEN to restore the budget afterwards");

  let limited: { status: number; code?: string } | null = null;
  for (let attempt = 0; attempt < 40 && !limited; attempt += 1) {
    const response = await request.post("/api/sessions/join", {
      data: { joinCode: "CM2026", displayName: "Flood" },
    });
    if (response.status() === 429) {
      limited = { status: 429, code: (await response.json()).error.code };
    } else {
      expect(response.status()).toBe(200);
    }
  }
  expect(limited).toEqual({ status: 429, code: "RATE_LIMITED" });

  const reset = await request.post("/api/admin/reset-demo", {
    headers: { authorization: `Bearer ${token}` },
    timeout: 120_000,
  });
  expect(reset.status()).toBe(200);

  const afterReset = await request.post("/api/sessions/join", {
    data: { joinCode: "CM2026", displayName: "After reset" },
  });
  expect(afterReset.status()).toBe(200);
});
