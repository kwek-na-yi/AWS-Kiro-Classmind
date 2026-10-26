import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassSession, PeerExplanation } from "@/lib/types";

/**
 * The Study_Thread routes, driven against an in-memory explanation store. The
 * validator is the real DemoAIProvider, so the statuses these tests assert are
 * ones the checker genuinely produced.
 */

const store = vi.hoisted(() => ({ explanations: [] as PeerExplanation[] }));

const sessionRepo = vi.hoisted(() => ({
  getSession: vi.fn(),
  assertLearnerInSession: vi.fn(),
  getLearner: vi.fn(),
}));

const materialRepo = vi.hoisted(() => ({
  listTopics: vi.fn(),
  listSourceUnits: vi.fn(),
}));

const explanationRepo = vi.hoisted(() => ({
  putExplanation: vi.fn(),
  listThread: vi.fn(),
  listAllExplanations: vi.fn(),
  findExplanationById: vi.fn(),
  claimValidation: vi.fn(),
  resolveValidation: vi.fn(),
}));

const logger = vi.hoisted(() => ({ logFallback: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/repo/session", () => sessionRepo);
vi.mock("@/lib/repo/material", () => materialRepo);
vi.mock("@/lib/repo/explanation", () => explanationRepo);
vi.mock("@/lib/aws/logger", () => logger);

const { GET: getThreadRoute } = await import(
  "@/app/api/sessions/[sid]/threads/[topicId]/route"
);
const { POST: postExplanation } = await import(
  "@/app/api/sessions/[sid]/threads/[topicId]/explanations/route"
);
const { POST: postValidate } = await import(
  "@/app/api/sessions/[sid]/explanations/[eid]/validate/route"
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

const TOPICS = [
  { topicId: "alpha", materialVersion: 1, order: 0, name: "Normalisation", unitIdxs: [0] },
];

const UNITS = [
  {
    materialVersion: 1,
    index: 0,
    text: "Normalisation organises the columns and tables of a relational database to reduce data redundancy and improve data integrity.",
    ref: { kind: "page" as const, value: "p. 1" },
  },
];

const LEARNER = "learner-1";

function request(url: string, learnerId: string | null, init: RequestInit = {}) {
  return new Request(`http://localhost${url}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(learnerId ? { "x-learner-id": learnerId } : {}),
    },
  });
}

const threadContext = () => ({
  params: Promise.resolve({ sid: "demo", topicId: "alpha" }),
});

beforeEach(() => {
  vi.clearAllMocks();
  store.explanations = [];

  sessionRepo.assertLearnerInSession.mockResolvedValue(true);
  sessionRepo.getSession.mockResolvedValue(DEMO);
  sessionRepo.getLearner.mockResolvedValue({
    learnerId: LEARNER,
    displayName: "Ada Lovelace",
    isSeeded: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  materialRepo.listTopics.mockResolvedValue(TOPICS);
  materialRepo.listSourceUnits.mockResolvedValue(UNITS);

  explanationRepo.putExplanation.mockImplementation(
    async (_sid: string, explanation: PeerExplanation) => {
      store.explanations.push(explanation);
    },
  );

  explanationRepo.listThread.mockImplementation(async (_sid, topicId) =>
    store.explanations.filter((entry) => entry.topicId === topicId),
  );

  explanationRepo.findExplanationById.mockImplementation(async (_sid, id) =>
    store.explanations.find((entry) => entry.explanationId === id) ?? null,
  );

  explanationRepo.claimValidation.mockImplementation(async (_sid, key) => {
    const entry = store.explanations.find(
      (candidate) => candidate.explanationId === key.explanationId,
    );
    if (!entry || entry.attempts !== 0) return false;
    entry.attempts = 1;
    return true;
  });

  explanationRepo.resolveValidation.mockImplementation(async (_sid, key, outcome) => {
    const entry = store.explanations.find(
      (candidate) => candidate.explanationId === key.explanationId,
    );
    if (!entry) return;
    entry.status = outcome.status;
    entry.sourceRef = outcome.sourceRef;
    entry.reason = outcome.reason;
  });
});

async function submit(text: string, learnerId = LEARNER) {
  const response = await postExplanation(
    request("/api/sessions/demo/threads/alpha/explanations", learnerId, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
    threadContext(),
  );

  return { response, body: await response.json() };
}

async function validate(explanationId: string, learnerId = LEARNER) {
  const response = await postValidate(
    request(`/api/sessions/demo/explanations/${explanationId}/validate`, learnerId, {
      method: "POST",
    }),
    { params: Promise.resolve({ sid: "demo", eid: explanationId }) },
  );

  return { response, body: await response.json() };
}

async function readThread(learnerId: string | null = LEARNER) {
  const response = await getThreadRoute(
    request("/api/sessions/demo/threads/alpha", learnerId),
    threadContext(),
  );

  return { response, body: await response.json() };
}

describe("submitting an explanation", () => {
  it("persists it as Pending and returns immediately", async () => {
    const { response, body } = await submit(
      "Normalisation organises columns and tables to reduce data redundancy.",
    );

    expect(response.status).toBe(201);
    expect(body.status).toBe("Pending");
    expect(body.id).toMatch(/^[0-9a-f]{32}$/);
    expect(store.explanations).toHaveLength(1);
  });

  it("never echoes the author's identity", async () => {
    const { body } = await submit(
      "Normalisation organises columns and tables to reduce data redundancy.",
    );

    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("Ada Lovelace");
    expect(serialised).not.toContain(LEARNER);
    expect(serialised).not.toContain("displayName");
  });

  it("rejects text below 20 characters", async () => {
    const { response, body } = await submit("Too short");

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("EXPLANATION_LENGTH");
    expect(store.explanations).toHaveLength(0);
  });

  it("rejects text above 1500 characters", async () => {
    const { response } = await submit("a".repeat(1501));
    expect(response.status).toBe(400);
  });

  it("rejects a topic outside the class", async () => {
    const response = await postExplanation(
      request("/api/sessions/demo/threads/ghost/explanations", LEARNER, {
        method: "POST",
        body: JSON.stringify({ text: "A perfectly reasonable explanation here." }),
      }),
      { params: Promise.resolve({ sid: "demo", topicId: "ghost" }) },
    );

    expect(response.status).toBe(404);
  });

  it("refuses a learner outside the session", async () => {
    sessionRepo.assertLearnerInSession.mockResolvedValue(false);

    const { response } = await submit(
      "Normalisation organises columns and tables to reduce redundancy.",
      "stranger",
    );

    expect(response.status).toBe(403);
  });
});

describe("validation", () => {
  it("validates an explanation the material supports and records a source", async () => {
    const { body: created } = await submit(
      "Normalisation organises the columns and tables of a relational database to reduce data redundancy.",
    );

    const { response, body } = await validate(created.id as string);

    expect(response.status).toBe(200);
    expect(body.status).toBe("Validated");
    expect(body.sourceRef).toEqual({ kind: "page", value: "p. 1" });
    expect(body.reason).toBeNull();
    expect(explanationRepo.resolveValidation).toHaveBeenCalled();
  });

  it("does not validate an explanation the material contradicts", async () => {
    const { body: created } = await submit(
      "Normalisation does not organise the columns and tables of a relational database to reduce data redundancy.",
    );

    const { body } = await validate(created.id as string);

    expect(body.status).toBe("Contradicted");
    expect(body.reason).toBeTruthy();
    expect(body.sourceRef).toBeNull();
  });

  it("marks an unrelated explanation unsupported", async () => {
    const { body: created } = await submit(
      "Sharding splits a database horizontally across several physical machines.",
    );

    const { body } = await validate(created.id as string);

    expect(body.status).toBe("Unsupported");
    expect(body.reason).toBeTruthy();
  });

  it("persists the verdict so a second call does not reassess", async () => {
    const { body: created } = await submit(
      "Normalisation organises the columns and tables of a relational database to reduce data redundancy.",
    );

    await validate(created.id as string);
    explanationRepo.resolveValidation.mockClear();

    const { body } = await validate(created.id as string);

    expect(body.status).toBe("Validated");
    expect(explanationRepo.resolveValidation).not.toHaveBeenCalled();
  });

  it("returns 404 for an explanation that does not exist", async () => {
    const { response } = await validate("nosuchexplanation");
    expect(response.status).toBe(404);
  });
});

describe("reading a thread", () => {
  it("returns every explanation with its status, and no identity", async () => {
    const supported = await submit(
      "Normalisation organises the columns and tables of a relational database to reduce data redundancy.",
    );
    await validate(supported.body.id as string);

    const contradicted = await submit(
      "Normalisation does not organise the columns and tables of a relational database to reduce data redundancy.",
    );
    await validate(contradicted.body.id as string);

    const { response, body } = await readThread();

    expect(response.status).toBe(200);
    expect(body.explanations).toHaveLength(2);
    expect(body.topicName).toBe("Normalisation");

    const serialised = await new Response(JSON.stringify(body)).text();
    expect(serialised).not.toContain("Ada Lovelace");
    expect(serialised).not.toContain(LEARNER);
    expect(serialised).not.toContain("displayName");
    expect(serialised).not.toContain("learnerId");
  });

  it("marks only validated explanations as recommended", async () => {
    const supported = await submit(
      "Normalisation organises the columns and tables of a relational database to reduce data redundancy.",
    );
    await validate(supported.body.id as string);

    const unrelated = await submit(
      "Sharding splits a database horizontally across several machines.",
    );
    await validate(unrelated.body.id as string);

    const { body } = await readThread();

    const recommended = body.explanations.filter(
      (entry: { isRecommended: boolean }) => entry.isRecommended,
    );

    expect(recommended).toHaveLength(1);
    expect(recommended[0].status).toBe("Validated");
    expect(body.recommendedCount).toBe(1);
  });

  it("puts the recommended explanation first", async () => {
    await submit("Sharding splits a database horizontally across several machines.");

    const supported = await submit(
      "Normalisation organises the columns and tables of a relational database to reduce data redundancy.",
    );
    await validate(supported.body.id as string);

    const { body } = await readThread();
    expect(body.explanations[0].isRecommended).toBe(true);
  });

  it("reports the status counts", async () => {
    const supported = await submit(
      "Normalisation organises the columns and tables of a relational database to reduce data redundancy.",
    );
    await validate(supported.body.id as string);

    const { body } = await readThread();

    expect(body.counts.Validated).toBe(1);
    expect(body.counts.Pending).toBe(0);
  });

  it("returns an empty thread for a topic with no explanations", async () => {
    const { body } = await readThread();

    expect(body.explanations).toEqual([]);
    expect(body.recommendedCount).toBe(0);
  });

  it("refuses a learner outside the session", async () => {
    sessionRepo.assertLearnerInSession.mockResolvedValue(false);

    const { response } = await readThread("stranger");
    expect(response.status).toBe(403);
  });

  it("returns 404 for a topic outside the class", async () => {
    const response = await getThreadRoute(
      request("/api/sessions/demo/threads/ghost", LEARNER),
      { params: Promise.resolve({ sid: "demo", topicId: "ghost" }) },
    );

    expect(response.status).toBe(404);
  });
});
