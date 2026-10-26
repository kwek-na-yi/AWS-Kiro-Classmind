import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassSession, Recap } from "@/lib/types";

const session = vi.hoisted(() => ({
  getSession: vi.fn(),
  getProfile: vi.fn(),
  assertLearnerInSession: vi.fn(),
}));

const material = vi.hoisted(() => ({
  getMaterial: vi.fn(),
  getRecap: vi.fn(),
  putRecap: vi.fn(),
  listSourceUnits: vi.fn(),
  listTopics: vi.fn(),
}));

const logger = vi.hoisted(() => ({ logFallback: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/repo/session", () => session);
vi.mock("@/lib/repo/material", () => material);
vi.mock("@/lib/aws/logger", () => logger);

const { GET } = await import("@/app/api/sessions/[sid]/recap/route");

const DEMO: ClassSession = {
  sessionId: "demo",
  name: "Relational Databases",
  joinCode: "CM2026",
  instructorTokenHash: "hash",
  materialVersion: 1,
  isDemo: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const UNITS = [
  {
    materialVersion: 1,
    index: 0,
    text: "Normalisation organises columns to remove redundancy. A table is in first normal form when every column holds a single atomic value.",
    ref: { kind: "page" as const, value: "p. 1" },
  },
  {
    materialVersion: 1,
    index: 1,
    text: "An index speeds up reads and slows down writes. A covering index answers a query from the index alone.",
    ref: { kind: "page" as const, value: "p. 2" },
  },
  {
    materialVersion: 1,
    index: 2,
    text: "Denormalisation reintroduces redundancy so fewer joins are needed. Every write path must keep the copies consistent.",
    ref: { kind: "page" as const, value: "p. 3" },
  },
];

const TOPICS = [
  { topicId: "alpha", materialVersion: 1, order: 0, name: "Normalisation", unitIdxs: [0] },
  { topicId: "beta", materialVersion: 1, order: 1, name: "Indexing", unitIdxs: [1] },
  { topicId: "gamma", materialVersion: 1, order: 2, name: "Denormalisation", unitIdxs: [2] },
];

function get(learnerId: string | null = "learner-1"): Request {
  return new Request("http://localhost/api/sessions/demo/recap", {
    headers: learnerId ? { "x-learner-id": learnerId } : {},
  });
}

const context = { params: Promise.resolve({ sid: "demo" }) };

beforeEach(() => {
  vi.clearAllMocks();
  session.assertLearnerInSession.mockResolvedValue(true);
  session.getSession.mockResolvedValue(DEMO);
  session.getProfile.mockResolvedValue({
    learnerId: "learner-1",
    understandingLevel: "Basic_Understanding",
    explanationStyle: "Detailed",
  });
  material.getMaterial.mockResolvedValue({ status: "ready", version: 1 });
  material.getRecap.mockResolvedValue(null);
  material.putRecap.mockResolvedValue(undefined);
  material.listSourceUnits.mockResolvedValue(UNITS);
  material.listTopics.mockResolvedValue(TOPICS);
});

describe("cache miss", () => {
  it("generates, persists and returns the recap", async () => {
    const response = await GET(get(), { params: Promise.resolve({ sid: "demo" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("generated");
    expect(body.mode).toBe("generated");
    expect(body.sections).toHaveLength(3);
    expect(body.takeaways.length).toBeGreaterThanOrEqual(3);
    expect(material.putRecap).toHaveBeenCalledTimes(1);
  });

  it("carries a resolved Source_Reference on every covered section", async () => {
    const response = await GET(get(), { params: Promise.resolve({ sid: "demo" }) });
    const body = await response.json();

    const known = new Set(UNITS.map((unit) => unit.ref.value));

    for (const section of body.sections) {
      if (section.uncovered) continue;

      expect(section.sourceRefs.length).toBeGreaterThan(0);
      for (const ref of section.sourceRefs) expect(known.has(ref.value)).toBe(true);
    }
  });
});

describe("cache hit", () => {
  it("returns the retained recap without generating or writing", async () => {
    const retained: Recap = {
      sessionId: "demo",
      materialVersion: 1,
      understandingLevel: "Basic_Understanding",
      explanationStyle: "Detailed",
      mode: "generated",
      takeaways: ["Retained one.", "Retained two.", "Retained three."],
      sections: [
        {
          topicId: "alpha",
          topicName: "Normalisation",
          body: "Retained body.",
          sourceRefs: [{ kind: "page", value: "p. 1" }],
          unverified: false,
        },
      ],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    material.getRecap.mockResolvedValue(retained);

    const response = await GET(get(), { params: Promise.resolve({ sid: "demo" }) });
    const body = await response.json();

    expect(body.source).toBe("cache");
    expect(body.sections[0].body).toBe("Retained body.");
    expect(material.putRecap).not.toHaveBeenCalled();
    expect(material.listSourceUnits).not.toHaveBeenCalled();
  });

  it("looks up by the learner's own profile combination", async () => {
    session.getProfile.mockResolvedValue({
      learnerId: "learner-1",
      understandingLevel: "Strong_Understanding",
      explanationStyle: "Concise",
    });

    await GET(get(), { params: Promise.resolve({ sid: "demo" }) });

    expect(material.getRecap).toHaveBeenCalledWith(
      "demo",
      1,
      "Strong_Understanding",
      "Concise",
    );
  });
});

describe("profile and access", () => {
  it("explains that a class without lecture material has nothing to recap", async () => {
    // Regression: an empty class got a "0 things you need to know" fallback
    // claiming to quote material that did not exist.
    material.getMaterial.mockResolvedValue(null);

    const response = await GET(get(), context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("MATERIAL_REQUIRED");
    expect(material.putRecap).not.toHaveBeenCalled();
    expect(logger.logFallback).not.toHaveBeenCalled();
  });

  it("requires a profile before a recap can be produced", async () => {
    session.getProfile.mockResolvedValue(null);

    const response = await GET(get(), { params: Promise.resolve({ sid: "demo" }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("PROFILE_REQUIRED");
  });

  it("refuses a learner who is not in the session", async () => {
    session.assertLearnerInSession.mockResolvedValue(false);

    const response = await GET(get("stranger"), context);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("LEARNER_NOT_IN_SESSION");
  });

  it("refuses a request with no Learner_Id", async () => {
    const response = await GET(get(null), context);

    expect(response.status).toBe(403);
  });
});

describe("degraded generation", () => {
  it("returns a labelled source extract and does not cache it", async () => {
    // No topics means nothing can be grounded, which the service treats exactly
    // as it treats a failed generation.
    material.listTopics.mockResolvedValue([]);

    const response = await GET(get(), { params: Promise.resolve({ sid: "demo" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe("source_extract");
    expect(body.degraded).toEqual(["recap"]);
    expect(material.putRecap).not.toHaveBeenCalled();
  });
});
