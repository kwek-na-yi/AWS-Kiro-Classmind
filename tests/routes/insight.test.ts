import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnswerOption, ClassSession, QuizItem, QuizResponse } from "@/lib/types";

const sessionRepo = vi.hoisted(() => ({
  getSession: vi.fn(),
  assertLearnerInSession: vi.fn(),
  getLearner: vi.fn(),
}));

const materialRepo = vi.hoisted(() => ({
  listTopics: vi.fn(),
  listSourceUnits: vi.fn(),
}));

const poolRepo = vi.hoisted(() => ({ listQuizItems: vi.fn() }));
const quizRepo = vi.hoisted(() => ({ listAllClassResponses: vi.fn() }));
const miscRepo = vi.hoisted(() => ({
  getClarifications: vi.fn(),
  putClarification: vi.fn(),
}));

vi.mock("@/lib/repo/session", () => sessionRepo);
vi.mock("@/lib/repo/material", () => materialRepo);
vi.mock("@/lib/repo/pool", () => poolRepo);
vi.mock("@/lib/repo/quiz", () => quizRepo);
vi.mock("@/lib/repo/misconception", () => miscRepo);

const { GET } = await import("@/app/api/sessions/[sid]/insight/route");

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

const UNITS = [0, 1, 2].map((index) => ({
  materialVersion: 1,
  index,
  text: `Unit ${index} of the lecture material, with enough words to quote.`,
  ref: { kind: "page" as const, value: `p. ${index + 1}` },
}));

function options(): AnswerOption[] {
  return [
    { optionId: "a", text: "Correct answer", isCorrect: true },
    {
      optionId: "b",
      text: "The popular wrong answer",
      isCorrect: false,
      misconceptionLabel: "Confuses ALPHA with BETA",
    },
    { optionId: "c", text: "Another wrong answer", isCorrect: false, misconceptionLabel: "c" },
    { optionId: "d", text: "A third wrong answer", isCorrect: false, misconceptionLabel: "d" },
  ];
}

const POOL: QuizItem[] = TOPICS.map((topic, index) => ({
  quizItemId: `${topic.topicId}-item`,
  materialVersion: 1,
  topicId: topic.topicId,
  difficulty: 1,
  stem: `Question about ${topic.name}`,
  options: options(),
  unitIdx: index,
  sourceRef: { kind: "page", value: `p. ${index + 1}` },
}));

function response(
  learnerId: string,
  topicId: string,
  optionId: string,
  isCorrect: boolean,
): QuizResponse {
  return {
    quizSessionId: `qs-${learnerId}`,
    seq: 1,
    learnerId,
    quizItemId: `${topicId}-item`,
    topicId,
    optionId,
    isCorrect,
    difficultyServed: 1,
    submittedAt: "2026-01-01T10:00:00.000Z",
  };
}

/**
 * Four learners. ALPHA is weak with three of them choosing the same distractor
 * (a misconception); BETA is mixed; GAMMA is strong.
 */
const RESPONSES: QuizResponse[] = [
  response("l1", "alpha", "b", false),
  response("l2", "alpha", "b", false),
  response("l3", "alpha", "b", false),
  response("l4", "alpha", "a", true),

  response("l1", "beta", "a", true),
  response("l2", "beta", "a", true),
  response("l3", "beta", "c", false),
  response("l4", "beta", "d", false),

  response("l1", "gamma", "a", true),
  response("l2", "gamma", "a", true),
  response("l3", "gamma", "a", true),
  response("l4", "gamma", "a", true),
];

function get(learnerId: string | null = "learner-1"): Request {
  return new Request("http://localhost/api/sessions/demo/insight", {
    headers: learnerId ? { "x-learner-id": learnerId } : {},
  });
}

const context = () => ({ params: Promise.resolve({ sid: "demo" }) });

beforeEach(() => {
  vi.clearAllMocks();
  sessionRepo.assertLearnerInSession.mockResolvedValue(true);
  sessionRepo.getSession.mockResolvedValue(DEMO);
  materialRepo.listTopics.mockResolvedValue(TOPICS);
  materialRepo.listSourceUnits.mockResolvedValue(UNITS);
  poolRepo.listQuizItems.mockResolvedValue(POOL);
  quizRepo.listAllClassResponses.mockResolvedValue(RESPONSES);
  miscRepo.getClarifications.mockResolvedValue([]);
  miscRepo.putClarification.mockResolvedValue(undefined);
});

describe("the class map", () => {
  it("publishes a mastery figure for every topic above the threshold", async () => {
    const response = await GET(get(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.topics).toHaveLength(3);

    for (const topic of body.topics) {
      expect(topic.status).toBe("published");
      expect(topic.classMastery).toBeGreaterThanOrEqual(0);
      expect(topic.classMastery).toBeLessThanOrEqual(100);
      expect(topic.respondingLearners).toBe(4);
    }
  });

  it("computes mastery from the responses, weakest first", async () => {
    const body = await (await GET(get(), context())).json();

    expect(body.topics.map((topic: { topicName: string }) => topic.topicName)).toEqual([
      "ALPHA",
      "BETA",
      "GAMMA",
    ]);
    expect(body.topics[0].classMastery).toBe(25);
    expect(body.topics[1].classMastery).toBe(50);
    expect(body.topics[2].classMastery).toBe(100);
  });

  it("names the weakest published topic", async () => {
    const body = await (await GET(get(), context())).json();
    expect(body.weakestTopicId).toBe("alpha");
  });

  it("reports how many learners have answered", async () => {
    const body = await (await GET(get(), context())).json();
    expect(body.respondingLearners).toBe(4);
  });

  it("ignores answers to a superseded material version's questions", async () => {
    // Regression: Topic ids are name slugs, so answers to an older upload's
    // questions on a same-named Topic were counted in the current map.
    const stale = ["o1", "o2", "o3", "o4", "o5"].map((learnerId) => ({
      ...response(learnerId, "gamma", "b", false),
      quizItemId: "gamma-item-from-v0",
    }));
    quizRepo.listAllClassResponses.mockResolvedValue([...RESPONSES, ...stale]);

    const body = await (await GET(get(), context())).json();
    const gamma = body.topics.find((topic: { topicId: string }) => topic.topicId === "gamma");

    expect(gamma.classMastery).toBe(100);
    expect(gamma.respondingLearners).toBe(4);
    expect(body.respondingLearners).toBe(4);
  });
});

describe("anonymity", () => {
  it("suppresses a topic answered by fewer than three learners", async () => {
    quizRepo.listAllClassResponses.mockResolvedValue([
      response("l1", "alpha", "b", false),
      response("l2", "alpha", "b", false),
    ]);

    const body = await (await GET(get(), context())).json();
    const alpha = body.topics.find((topic: { topicId: string }) => topic.topicId === "alpha");

    expect(alpha.status).toBe("insufficient-data");
    expect(alpha).not.toHaveProperty("classMastery");
    expect(alpha).not.toHaveProperty("respondingLearners");
    expect(body.weakestTopicId).toBeNull();
  });

  it("publishes nothing when every response comes from one learner", async () => {
    quizRepo.listAllClassResponses.mockResolvedValue([
      response("solo", "alpha", "a", true),
      response("solo", "beta", "a", true),
      response("solo", "gamma", "a", true),
    ]);

    const body = await (await GET(get(), context())).json();

    for (const topic of body.topics) {
      expect(topic.status).toBe("insufficient-data");
    }
    expect(body.misconceptions).toEqual([]);
  });

  it("carries the anonymity threshold in the response", async () => {
    const body = await (await GET(get(), context())).json();
    expect(body.anonymityThreshold).toBe(3);
  });

  it("leaks no learner identity anywhere in the payload", async () => {
    const serialised = await (await GET(get(), context())).text();

    for (const forbidden of [
      "learnerId",
      "displayName",
      "l1",
      "l2",
      "submittedAt",
      "quizSessionId",
      "isCorrect",
      "optionId",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe("misconceptions", () => {
  it("reports the distractor a share of the class converged on", async () => {
    const body = await (await GET(get(), context())).json();

    expect(body.misconceptions.length).toBeGreaterThan(0);

    const alpha = body.misconceptions.find(
      (entry: { topicId: string }) => entry.topicId === "alpha",
    );

    expect(alpha.sharePercent).toBe(75);
    expect(alpha.misconceptionLabel).toBe("Confuses ALPHA with BETA");
    expect(alpha.topicName).toBe("ALPHA");
  });

  it("attaches a clarification drawn from the source material", async () => {
    const body = await (await GET(get(), context())).json();
    const alpha = body.misconceptions.find(
      (entry: { topicId: string }) => entry.topicId === "alpha",
    );

    expect(alpha.clarification).toBeTruthy();
    expect(miscRepo.putClarification).toHaveBeenCalled();
  });

  it("reuses a cached clarification without regenerating", async () => {
    miscRepo.getClarifications.mockResolvedValue([
      {
        quizItemId: "alpha-item",
        optionId: "b",
        clarification: "The cached clarification.",
        generatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const body = await (await GET(get(), context())).json();
    const alpha = body.misconceptions.find(
      (entry: { topicId: string }) => entry.topicId === "alpha",
    );

    expect(alpha.clarification).toBe("The cached clarification.");
    expect(miscRepo.putClarification).not.toHaveBeenCalled();
  });

  it("invents no misconception when answers are spread", async () => {
    quizRepo.listAllClassResponses.mockResolvedValue([
      response("l1", "beta", "a", true),
      response("l2", "beta", "b", false),
      response("l3", "beta", "c", false),
      response("l4", "beta", "d", false),
    ]);

    const body = await (await GET(get(), context())).json();

    // One selection each: nothing clears the two-selection floor.
    expect(body.misconceptions).toEqual([]);
  });

  it("invents no misconception below the anonymity threshold", async () => {
    quizRepo.listAllClassResponses.mockResolvedValue([
      response("l1", "alpha", "b", false),
      response("l2", "alpha", "b", false),
    ]);

    const body = await (await GET(get(), context())).json();
    expect(body.misconceptions).toEqual([]);
  });

  it("caps the reported misconceptions at three", async () => {
    const body = await (await GET(get(), context())).json();
    expect(body.misconceptions.length).toBeLessThanOrEqual(3);
  });
});

describe("determinism", () => {
  it("returns the same payload for the same responses", async () => {
    const first = await (await GET(get(), context())).text();
    const second = await (await GET(get(), context())).text();

    expect(second).toBe(first);
  });

  it("does not depend on the order responses are read in", async () => {
    const forward = await (await GET(get(), context())).json();

    quizRepo.listAllClassResponses.mockResolvedValue([...RESPONSES].reverse());
    const reversed = await (await GET(get(), context())).json();

    expect(reversed.topics).toEqual(forward.topics);
    expect(reversed.misconceptions).toEqual(forward.misconceptions);
  });
});

describe("access", () => {
  it("refuses a learner outside the session", async () => {
    sessionRepo.assertLearnerInSession.mockResolvedValue(false);

    const response = await GET(get("stranger"), context());
    expect(response.status).toBe(403);
  });

  it("refuses a request with no identity", async () => {
    const response = await GET(get(null), context());
    expect(response.status).toBe(403);
  });

  it("returns 404 for a session that does not exist", async () => {
    sessionRepo.getSession.mockResolvedValue(null);

    const response = await GET(get(), context());
    expect(response.status).toBe(404);
  });
});
