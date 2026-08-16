import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AnswerOption,
  ClassSession,
  DifficultyLevel,
  QuizItem,
  QuizResponse,
  QuizSession,
  UnderstandingReport,
} from "@/lib/types";

/**
 * The quiz flow, driven through the routes with an in-memory store standing in
 * for DynamoDB. The engine, the selection order and the report arithmetic are
 * the real ones — only persistence is faked.
 */

const store = vi.hoisted(() => ({
  quizSessions: new Map<string, unknown>(),
  responses: [] as unknown[],
  reports: new Map<string, unknown>(),
}));

const sessionRepo = vi.hoisted(() => ({
  getSession: vi.fn(),
  assertLearnerInSession: vi.fn(),
}));

const materialRepo = vi.hoisted(() => ({
  getMaterial: vi.fn(),
  listTopics: vi.fn(),
}));

const poolRepo = vi.hoisted(() => ({
  listQuizItems: vi.fn(),
  findQuizItemById: vi.fn(),
}));

const quizRepo = vi.hoisted(() => ({
  createQuizSession: vi.fn(),
  getQuizSession: vi.fn(),
  listSessionResponses: vi.fn(),
  markItemServed: vi.fn(),
  recordResponse: vi.fn(),
}));

const reportRepo = vi.hoisted(() => ({ putReport: vi.fn(), getReport: vi.fn() }));
const poolService = vi.hoisted(() => ({ generateAndPersistQuizPool: vi.fn() }));

vi.mock("@/lib/repo/session", () => sessionRepo);
vi.mock("@/lib/repo/material", () => materialRepo);
vi.mock("@/lib/repo/pool", () => poolRepo);
vi.mock("@/lib/repo/quiz", () => quizRepo);
vi.mock("@/lib/repo/report", () => reportRepo);
vi.mock("@/lib/ai/services/pool", () => poolService);

const { POST: startQuiz } = await import("@/app/api/sessions/[sid]/quiz-sessions/route");
const { GET: nextItem } = await import(
  "@/app/api/sessions/[sid]/quiz-sessions/[qsid]/next/route"
);
const { POST: submitAnswer } = await import(
  "@/app/api/sessions/[sid]/quiz-sessions/[qsid]/responses/route"
);
const { GET: getReportRoute } = await import(
  "@/app/api/sessions/[sid]/reports/[qsid]/route"
);

const DEMO: ClassSession = {
  sessionId: "demo",
  name: "Relational Databases",
  joinCode: "CM2026",
  instructorTokenHash: "hash",
  materialVersion: 1,
  isDemo: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const TOPICS = ["alpha", "beta", "gamma"].map((topicId, order) => ({
  topicId,
  materialVersion: 1,
  order,
  name: topicId.toUpperCase(),
  unitIdxs: [order],
}));

function options(prefix: string): AnswerOption[] {
  return [
    { optionId: "a", text: `${prefix} correct`, isCorrect: true },
    { optionId: "b", text: `${prefix} wrong b`, isCorrect: false, misconceptionLabel: "b" },
    { optionId: "c", text: `${prefix} wrong c`, isCorrect: false, misconceptionLabel: "c" },
    { optionId: "d", text: `${prefix} wrong d`, isCorrect: false, misconceptionLabel: "d" },
  ];
}

/** Four items per level across three Topics — enough for a full session. */
const POOL: QuizItem[] = [1, 2, 3].flatMap((difficulty) =>
  TOPICS.flatMap((topic, index) => ({
    quizItemId: `${topic.topicId}-d${difficulty}-${index}`,
    materialVersion: 1,
    topicId: topic.topicId,
    difficulty: difficulty as DifficultyLevel,
    stem: `Question about ${topic.name} at level ${difficulty}`,
    options: options(`${topic.topicId}${difficulty}`),
    unitIdx: index,
    sourceRef: { kind: "page" as const, value: `p. ${index + 1}` },
  })),
);

const LEARNER = "learner-1";

function request(url: string, learnerId: string | null, init: RequestInit = {}): Request {
  return new Request(`http://localhost${url}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(learnerId ? { "x-learner-id": learnerId } : {}),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.quizSessions.clear();
  store.responses = [];
  store.reports.clear();

  sessionRepo.assertLearnerInSession.mockResolvedValue(true);
  sessionRepo.getSession.mockResolvedValue(DEMO);
  materialRepo.getMaterial.mockResolvedValue({ poolStatus: "ready", version: 1 });
  materialRepo.listTopics.mockResolvedValue(TOPICS);
  poolRepo.listQuizItems.mockResolvedValue(POOL);
  poolRepo.findQuizItemById.mockImplementation(async (_sid, _v, id) =>
    POOL.find((item) => item.quizItemId === id) ?? null,
  );

  quizRepo.createQuizSession.mockImplementation(async (_sid: string, input: {
    quizSessionId: string;
    learnerId: string;
    currentDifficulty: DifficultyLevel;
    length: number;
  }) => {
    const created: QuizSession = {
      quizSessionId: input.quizSessionId,
      learnerId: input.learnerId,
      currentDifficulty: input.currentDifficulty,
      runKind: "none",
      runLen: 0,
      servedItemIds: [],
      answeredItemIds: [],
      status: "in_progress",
      length: input.length,
      startedAt: "2026-01-01T00:00:00.000Z",
    };

    store.quizSessions.set(`${input.learnerId}/${input.quizSessionId}`, created);
    return created;
  });

  quizRepo.getQuizSession.mockImplementation(async (_sid, learnerId, qsid) =>
    store.quizSessions.get(`${learnerId}/${qsid}`) ?? null,
  );

  quizRepo.listSessionResponses.mockImplementation(async (_sid, qsid) =>
    (store.responses as QuizResponse[]).filter((r) => r.quizSessionId === qsid),
  );

  quizRepo.markItemServed.mockImplementation(async (_sid, learnerId, qsid, itemId) => {
    const key = `${learnerId}/${qsid}`;
    const existing = store.quizSessions.get(key) as QuizSession | undefined;
    if (existing) {
      store.quizSessions.set(key, {
        ...existing,
        servedItemIds: [...existing.servedItemIds, itemId],
      });
    }
  });

  quizRepo.recordResponse.mockImplementation(async (_sid, { response, next, close }) => {
    const already = (store.responses as QuizResponse[]).some(
      (r) => r.quizSessionId === response.quizSessionId && r.quizItemId === response.quizItemId,
    );
    if (already) return false;

    store.responses.push(response);

    const key = `${response.learnerId}/${response.quizSessionId}`;
    const existing = store.quizSessions.get(key) as QuizSession;
    store.quizSessions.set(key, {
      ...existing,
      currentDifficulty: next.currentDifficulty,
      runKind: next.runKind,
      runLen: next.runLen,
      answeredItemIds: [...existing.answeredItemIds, response.quizItemId],
      status: close ? "closed" : existing.status,
    });

    return true;
  });

  reportRepo.putReport.mockImplementation(async (_sid, report: UnderstandingReport) => {
    store.reports.set(`${report.learnerId}/${report.quizSessionId}`, report);
  });

  reportRepo.getReport.mockImplementation(async (_sid, learnerId, qsid) =>
    store.reports.get(`${learnerId}/${qsid}`) ?? null,
  );
});

async function start(learnerId = LEARNER) {
  const response = await startQuiz(
    request("/api/sessions/demo/quiz-sessions", learnerId, { method: "POST" }),
    { params: Promise.resolve({ sid: "demo" }) },
  );

  return { response, body: await response.json() };
}

async function next(qsid: string, learnerId = LEARNER) {
  const response = await nextItem(
    request(`/api/sessions/demo/quiz-sessions/${qsid}/next`, learnerId),
    { params: Promise.resolve({ sid: "demo", qsid }) },
  );

  return { response, body: await response.json() };
}

async function answer(qsid: string, quizItemId: string, optionId: string, learnerId = LEARNER) {
  const response = await submitAnswer(
    request(`/api/sessions/demo/quiz-sessions/${qsid}/responses`, learnerId, {
      method: "POST",
      body: JSON.stringify({ quizItemId, optionId }),
    }),
    { params: Promise.resolve({ sid: "demo", qsid }) },
  );

  return { response, body: await response.json() };
}

describe("starting a quiz session", () => {
  it("opens at difficulty 2 with a length of 6", async () => {
    const { response, body } = await start();

    expect(response.status).toBe(201);
    expect(body.currentDifficulty).toBe(2);
    expect(body.length).toBe(6);
    expect(body.quizSessionId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("builds the pool first when it has not been generated", async () => {
    materialRepo.getMaterial.mockResolvedValue({ poolStatus: "pending", version: 1 });

    await start();

    expect(poolService.generateAndPersistQuizPool).toHaveBeenCalledTimes(1);
  });

  it("returns 409 POOL_UNAVAILABLE when no items exist", async () => {
    poolRepo.listQuizItems.mockResolvedValue([]);

    const { response, body } = await start();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("POOL_UNAVAILABLE");
    expect(body.error.message).toMatch(/recap/i);
  });

  it("refuses a learner outside the session", async () => {
    sessionRepo.assertLearnerInSession.mockResolvedValue(false);

    const { response } = await start("stranger");

    expect(response.status).toBe(403);
  });
});

describe("serving questions", () => {
  it("serves an item without leaking correctness or misconception labels", async () => {
    const { body: started } = await start();
    const { body } = await next(started.quizSessionId);

    expect(body.done).toBe(false);
    expect(body.index).toBe(1);
    expect(body.length).toBe(6);
    expect(body.item.options).toHaveLength(4);

    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("isCorrect");
    expect(serialised).not.toContain("misconceptionLabel");

    for (const option of body.item.options) {
      expect(Object.keys(option).sort()).toEqual(["id", "text"]);
    }
  });

  it("starts at the intermediate difficulty", async () => {
    const { body: started } = await start();
    const { body } = await next(started.quizSessionId);

    expect(body.item.difficulty).toBe(2);
  });

  it("refuses another learner's quiz session", async () => {
    const { body: started } = await start();
    const { response, body } = await next(started.quizSessionId, "someone-else");

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("NOT_YOUR_REPORT");
  });
});

describe("a full six-question session", () => {
  async function playThrough(answerFor: (index: number) => "correct" | "wrong") {
    const { body: started } = await start();
    const qsid = started.quizSessionId as string;

    const served: string[] = [];
    const difficulties: number[] = [];

    for (let index = 1; index <= 6; index += 1) {
      const { body: question } = await next(qsid);
      expect(question.done).toBe(false);
      expect(question.index).toBe(index);

      served.push(question.item.id);
      difficulties.push(question.item.difficulty);

      const optionId = answerFor(index) === "correct" ? "a" : "b";
      const { body: feedback } = await answer(qsid, question.item.id, optionId);

      expect(feedback.isCorrect).toBe(answerFor(index) === "correct");
      expect(feedback.correctOptionId).toBe("a");
      expect(feedback.index).toBe(index);
      expect(feedback.closed).toBe(index === 6);
    }

    return { qsid, served, difficulties };
  }

  it("serves six distinct items and closes the session", async () => {
    const { qsid, served } = await playThrough(() => "correct");

    expect(served).toHaveLength(6);
    expect(new Set(served).size).toBe(6);

    const { body } = await next(qsid);
    expect(body.done).toBe(true);
  });

  it("raises the difficulty after two correct answers", async () => {
    const { difficulties } = await playThrough(() => "correct");

    expect(difficulties[0]).toBe(2);
    expect(difficulties[1]).toBe(2);
    // Two correct at level 2 moves the engine up.
    expect(difficulties[2]).toBe(3);
  });

  it("lowers the difficulty after two incorrect answers", async () => {
    const { difficulties } = await playThrough(() => "wrong");

    expect(difficulties[0]).toBe(2);
    expect(difficulties[2]).toBe(1);
  });

  it("keeps the first answer when the same question is submitted twice", async () => {
    const { body: started } = await start();
    const qsid = started.quizSessionId as string;

    const { body: question } = await next(qsid);

    const first = await answer(qsid, question.item.id, "a");
    const repeat = await answer(qsid, question.item.id, "b");

    expect(first.body.isCorrect).toBe(true);
    expect(repeat.response.status).toBe(200);
    expect(repeat.body.duplicate).toBe(true);
    expect(repeat.body.index).toBe(1);
  });

  it("rejects an answer naming a question outside the pool", async () => {
    const { body: started } = await start();
    const { response } = await answer(started.quizSessionId, "no-such-item", "a");

    expect(response.status).toBe(404);
  });
});

describe("the understanding report", () => {
  it("is built on the sixth response and holds this learner's numbers only", async () => {
    const { body: started } = await start();
    const qsid = started.quizSessionId as string;

    for (let index = 1; index <= 6; index += 1) {
      const { body: question } = await next(qsid);
      // Alternate so some Topics are weak and some are not.
      await answer(qsid, question.item.id, index % 2 === 0 ? "a" : "b");
    }

    expect(reportRepo.putReport).toHaveBeenCalledTimes(1);

    const response = await getReportRoute(
      request(`/api/sessions/demo/reports/${qsid}`, LEARNER),
      { params: Promise.resolve({ sid: "demo", qsid }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.topicMastery.length).toBeGreaterThan(0);

    for (const topic of body.topicMastery) {
      expect(topic.mastery).toBeGreaterThanOrEqual(0);
      expect(topic.mastery).toBeLessThanOrEqual(100);
      expect(topic.topicName).toBeTruthy();
    }

    // Weak Topics are exactly those below the threshold.
    for (const weak of body.weakTopics) {
      const entry = body.topicMastery.find(
        (topic: { topicId: string }) => topic.topicId === weak.topicId,
      );
      expect(entry.mastery).toBeLessThan(body.weakTopicThreshold);
    }
  });

  it("contains no class-level or other-learner data", async () => {
    const { body: started } = await start();
    const qsid = started.quizSessionId as string;

    for (let index = 1; index <= 6; index += 1) {
      const { body: question } = await next(qsid);
      await answer(qsid, question.item.id, "a");
    }

    const response = await getReportRoute(
      request(`/api/sessions/demo/reports/${qsid}`, LEARNER),
      { params: Promise.resolve({ sid: "demo", qsid }) },
    );
    const serialised = await response.text();

    // No identity, no class aggregate, no per-response rows.
    expect(serialised).not.toContain(LEARNER);
    expect(serialised).not.toContain("learnerId");
    expect(serialised).not.toContain("displayName");
    expect(serialised).not.toContain("classMastery");
    expect(serialised).not.toContain("respondingLearners");
    expect(serialised).not.toContain("submittedAt");
  });

  it("is not readable by another learner", async () => {
    const { body: started } = await start();
    const qsid = started.quizSessionId as string;

    for (let index = 1; index <= 6; index += 1) {
      const { body: question } = await next(qsid);
      await answer(qsid, question.item.id, "a");
    }

    const response = await getReportRoute(
      request(`/api/sessions/demo/reports/${qsid}`, "someone-else"),
      { params: Promise.resolve({ sid: "demo", qsid }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("NOT_YOUR_REPORT");
    expect(body).not.toHaveProperty("topicMastery");
  });
});
