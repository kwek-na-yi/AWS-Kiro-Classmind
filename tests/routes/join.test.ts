import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassSession } from "@/lib/types";

const session = vi.hoisted(() => ({
  resolveJoinCode: vi.fn(),
  registerLearner: vi.fn(),
  getSession: vi.fn(),
  assertLearnerInSession: vi.fn(),
  getProfile: vi.fn(),
  putProfile: vi.fn(),
}));

const material = vi.hoisted(() => ({
  getMaterial: vi.fn(),
  listTopics: vi.fn(),
}));

vi.mock("@/lib/repo/session", () => session);
vi.mock("@/lib/repo/material", () => material);

const { POST } = await import("@/app/api/sessions/join/route");

const DEMO: ClassSession = {
  sessionId: "demo",
  name: "Relational Databases",
  joinCode: "CM2026",
  instructorTokenHash: "hash",
  materialVersion: 1,
  isDemo: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/sessions/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.resolveJoinCode.mockResolvedValue(DEMO);
  session.registerLearner.mockImplementation(async (_sid: string, learner: { learnerId: string; displayName: string }) => ({
    ...learner,
    isSeeded: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  material.getMaterial.mockResolvedValue({
    filename: "lecture.md",
    status: "ready",
    poolStatus: "ready",
  });
  material.listTopics.mockResolvedValue([
    { topicId: "t1", name: "Normalisation", order: 0, materialVersion: 1, unitIdxs: [0] },
  ]);
});

describe("joining a class", () => {
  it("admits a learner and returns the session, topics and a fresh Learner_Id", async () => {
    const response = await POST(post({ joinCode: "CM2026", displayName: "Ada" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessionId).toBe("demo");
    expect(body.name).toBe("Relational Databases");
    expect(body.displayName).toBe("Ada");
    expect(body.topics).toEqual([{ topicId: "t1", name: "Normalisation" }]);
    expect(body.learnerId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("accepts a lower-case code with surrounding spaces", async () => {
    const response = await POST(post({ joinCode: " cm2026 ", displayName: "Ada" }));

    expect(response.status).toBe(200);
    expect(session.resolveJoinCode).toHaveBeenCalledWith("CM2026");
  });

  it("mints a different Learner_Id for each join", async () => {
    const first = await (await POST(post({ joinCode: "CM2026", displayName: "Ada" }))).json();
    const second = await (await POST(post({ joinCode: "CM2026", displayName: "Ada" }))).json();

    expect(second.learnerId).not.toBe(first.learnerId);
  });

  it("returns no instructor token or hash to a learner", async () => {
    const response = await POST(post({ joinCode: "CM2026", displayName: "Ada" }));
    const text = await response.text();

    expect(text).not.toContain("instructorToken");
    expect(text).not.toContain("hash");
  });
});

describe("an unrecognised class code", () => {
  it("returns 404 SESSION_NOT_FOUND naming the code", async () => {
    session.resolveJoinCode.mockResolvedValue(null);

    const response = await POST(post({ joinCode: "ZZ9999", displayName: "Ada" }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
    expect(body.error.message).toContain("ZZ9999");
    expect(session.registerLearner).not.toHaveBeenCalled();
  });

  it("rejects a malformed code without reading the database", async () => {
    const response = await POST(post({ joinCode: "AB", displayName: "Ada" }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
    expect(session.resolveJoinCode).not.toHaveBeenCalled();
  });
});

describe("an invalid display name", () => {
  it("rejects an empty name", async () => {
    const response = await POST(post({ joinCode: "CM2026", displayName: "  " }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_DISPLAY_NAME");
    expect(body.error.field).toBe("displayName");
    expect(session.registerLearner).not.toHaveBeenCalled();
  });

  it("rejects a name over 30 characters", async () => {
    const response = await POST(
      post({ joinCode: "CM2026", displayName: "a".repeat(31) }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a missing body", async () => {
    const response = await POST(
      new Request("http://localhost/api/sessions/join", { method: "POST" }),
    );

    expect(response.status).toBe(404);
  });
});
