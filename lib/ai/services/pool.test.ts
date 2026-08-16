import { beforeEach, describe, expect, it, vi } from "vitest";

import { DemoAIProvider } from "@/lib/ai/demo/provider";
import type { AIProvider, QuizPoolOutput } from "@/lib/ai/provider";
import type { QuizItem, SourceUnit, Topic } from "@/lib/types";

const material = vi.hoisted(() => ({
  getMaterial: vi.fn(),
  listSourceUnits: vi.fn(),
  listTopics: vi.fn(),
  setPoolStatus: vi.fn(),
  transitionPoolStatus: vi.fn(),
  getRecap: vi.fn(),
  putRecap: vi.fn(),
}));

const pool = vi.hoisted(() => ({
  putQuizItems: vi.fn(),
  listQuizItems: vi.fn(),
}));

const logger = vi.hoisted(() => ({ logFallback: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/repo/material", () => material);
vi.mock("@/lib/repo/pool", () => pool);
vi.mock("@/lib/aws/logger", () => logger);

const { ENGINE_MINIMUM_ITEMS, generateAndPersistQuizPool } = await import(
  "@/lib/ai/services/pool"
);

const UNITS: SourceUnit[] = [
  {
    materialVersion: 1,
    index: 0,
    text: "Normalisation organises columns to remove redundancy. A table is in first normal form when every column holds a single atomic value. Repeating groups move to a related table.",
    ref: { kind: "page", value: "p. 1" },
  },
  {
    materialVersion: 1,
    index: 1,
    text: "An index speeds up reads and slows down writes. A covering index answers a query from the index alone. Each index costs storage.",
    ref: { kind: "page", value: "p. 2" },
  },
  {
    materialVersion: 1,
    index: 2,
    text: "Denormalisation reintroduces redundancy so fewer joins are needed. Every write path must keep the copies consistent. The trade-off is read speed against write cost.",
    ref: { kind: "page", value: "p. 3" },
  },
];

const TOPICS: Topic[] = [
  { topicId: "alpha", materialVersion: 1, order: 0, name: "Normalisation", unitIdxs: [0] },
  { topicId: "beta", materialVersion: 1, order: 1, name: "Indexing", unitIdxs: [1] },
  { topicId: "gamma", materialVersion: 1, order: 2, name: "Denormalisation", unitIdxs: [2] },
];

function input(overrides: Partial<Parameters<typeof generateAndPersistQuizPool>[0]> = {}) {
  return {
    sessionId: "cs_1",
    materialVersion: 1,
    provider: new DemoAIProvider(),
    ...overrides,
  };
}

function stubProvider(output: unknown, ok = true): AIProvider {
  return {
    id: "stub",
    label: "stub",
    kind: "deterministic",
    generateRecap: vi.fn(),
    generateQuizPool: vi.fn(async () =>
      ok
        ? { ok: true as const, value: output as QuizPoolOutput }
        : { ok: false as const, reason: "transport" as const },
    ),
    clarifyMisconception: vi.fn(),
    validatePeerExplanation: vi.fn(),
  } as unknown as AIProvider;
}

beforeEach(() => {
  vi.clearAllMocks();
  material.getMaterial.mockResolvedValue({ poolStatus: "pending", version: 1 });
  material.listSourceUnits.mockResolvedValue(UNITS);
  material.listTopics.mockResolvedValue(TOPICS);
  material.transitionPoolStatus.mockResolvedValue(true);
  material.setPoolStatus.mockResolvedValue(undefined);
  pool.putQuizItems.mockResolvedValue(undefined);
  pool.listQuizItems.mockResolvedValue([]);
});

describe("successful generation", () => {
  it("persists validated items and marks the pool ready", async () => {
    const result = await generateAndPersistQuizPool(input());

    expect(result.poolStatus).toBe("ready");
    expect(result.persisted).toBeGreaterThan(0);
    expect(pool.putQuizItems).toHaveBeenCalledTimes(1);

    const [sessionId, items] = pool.putQuizItems.mock.calls[0] as [string, QuizItem[]];
    expect(sessionId).toBe("cs_1");
    expect(items).toHaveLength(result.persisted);
  });

  it("flips the status only after the items are written", async () => {
    const order: string[] = [];
    pool.putQuizItems.mockImplementation(async () => {
      order.push("write");
    });
    material.transitionPoolStatus.mockImplementation(async () => {
      order.push("status");
      return true;
    });

    await generateAndPersistQuizPool(input());

    expect(order).toEqual(["write", "status"]);
    expect(material.transitionPoolStatus).toHaveBeenCalledWith("cs_1", 1, {
      from: "pending",
      to: "ready",
    });
  });

  it("persists only well-formed items", async () => {
    await generateAndPersistQuizPool(input());
    const [, items] = pool.putQuizItems.mock.calls[0] as [string, QuizItem[]];

    const topicIds = new Set(TOPICS.map((topic) => topic.topicId));
    const unitIdxs = new Set(UNITS.map((unit) => unit.index));

    for (const item of items) {
      expect(item.options).toHaveLength(4);
      expect(item.options.filter((option) => option.isCorrect)).toHaveLength(1);
      expect(topicIds.has(item.topicId)).toBe(true);
      expect(unitIdxs.has(item.unitIdx)).toBe(true);
      expect(item.sourceRef.value).toMatch(/^p\. \d+$/);
      expect([1, 2, 3]).toContain(item.difficulty);
    }
  });

  it("reports the per-level counts and whether the engine can run", async () => {
    const result = await generateAndPersistQuizPool(input());

    const total =
      result.countsByDifficulty[1] +
      result.countsByDifficulty[2] +
      result.countsByDifficulty[3];

    expect(total).toBe(result.persisted);
    expect(result.meetsEngineMinimum).toBe(total >= ENGINE_MINIMUM_ITEMS);
    expect(result.meetsEngineMinimum).toBe(true);
  });
});

describe("idempotency", () => {
  it("returns the retained pool without regenerating when already ready", async () => {
    material.getMaterial.mockResolvedValue({ poolStatus: "ready", version: 1 });
    pool.listQuizItems.mockResolvedValue([
      { quizItemId: "a", difficulty: 1 },
      { quizItemId: "b", difficulty: 2 },
    ] as QuizItem[]);

    const provider = stubProvider({ items: [] });
    const result = await generateAndPersistQuizPool(input({ provider }));

    expect(result.poolStatus).toBe("ready");
    expect(result.persisted).toBe(0);
    expect(result.countsByDifficulty).toEqual({ 1: 1, 2: 1, 3: 0 });
    expect(provider.generateQuizPool).not.toHaveBeenCalled();
    expect(pool.putQuizItems).not.toHaveBeenCalled();
  });

  it("produces the same item ids on a repeated generation", async () => {
    const first = await generateAndPersistQuizPool(input());
    const firstIds = (pool.putQuizItems.mock.calls[0][1] as QuizItem[]).map(
      (item) => item.quizItemId,
    );

    vi.clearAllMocks();
    material.getMaterial.mockResolvedValue({ poolStatus: "pending", version: 1 });
    material.listSourceUnits.mockResolvedValue(UNITS);
    material.listTopics.mockResolvedValue(TOPICS);
    material.transitionPoolStatus.mockResolvedValue(true);

    const second = await generateAndPersistQuizPool(input());
    const secondIds = (pool.putQuizItems.mock.calls[0][1] as QuizItem[]).map(
      (item) => item.quizItemId,
    );

    expect(secondIds).toEqual(firstIds);
    expect(second.persisted).toBe(first.persisted);
  });

  it("tolerates losing the status race", async () => {
    material.transitionPoolStatus.mockResolvedValue(false);

    const result = await generateAndPersistQuizPool(input());

    expect(result.poolStatus).toBe("ready");
    expect(pool.putQuizItems).toHaveBeenCalledTimes(1);
  });
});

describe("invalid and duplicate items", () => {
  it("discards malformed items and persists the rest", async () => {
    const provider = stubProvider({
      items: [
        {
          topicId: "alpha",
          difficulty: 1,
          stem: "A well-formed question?",
          unitIdx: 0,
          options: [
            { text: "Right", isCorrect: true, misconceptionLabel: null },
            { text: "Wrong one", isCorrect: false, misconceptionLabel: "One" },
            { text: "Wrong two", isCorrect: false, misconceptionLabel: "Two" },
            { text: "Wrong three", isCorrect: false, misconceptionLabel: "Three" },
          ],
        },
        // Unknown topic.
        {
          topicId: "ghost",
          difficulty: 1,
          stem: "Bad topic?",
          unitIdx: 0,
          options: [
            { text: "Right", isCorrect: true, misconceptionLabel: null },
            { text: "A", isCorrect: false, misconceptionLabel: "a" },
            { text: "B", isCorrect: false, misconceptionLabel: "b" },
            { text: "C", isCorrect: false, misconceptionLabel: "c" },
          ],
        },
        // Three options.
        {
          topicId: "beta",
          difficulty: 2,
          stem: "Too few options?",
          unitIdx: 1,
          options: [
            { text: "Right", isCorrect: true, misconceptionLabel: null },
            { text: "A", isCorrect: false, misconceptionLabel: "a" },
            { text: "B", isCorrect: false, misconceptionLabel: "b" },
          ],
        },
      ],
    });

    const result = await generateAndPersistQuizPool(input({ provider }));

    const [, items] = pool.putQuizItems.mock.calls[0] as [string, QuizItem[]];
    expect(items).toHaveLength(1);
    expect(items[0].topicId).toBe("alpha");

    const reasons = result.discarded.map((entry) => entry.reason);
    expect(reasons).toContain("unknown_topic");
    expect(reasons).toContain("option_count");
  });

  it("does not persist the same question twice", async () => {
    const duplicate = {
      topicId: "alpha",
      difficulty: 1,
      stem: "The same question?",
      unitIdx: 0,
      options: [
        { text: "Right", isCorrect: true, misconceptionLabel: null },
        { text: "A", isCorrect: false, misconceptionLabel: "a" },
        { text: "B", isCorrect: false, misconceptionLabel: "b" },
        { text: "C", isCorrect: false, misconceptionLabel: "c" },
      ],
    };

    const result = await generateAndPersistQuizPool(
      input({ provider: stubProvider({ items: [duplicate, duplicate] }) }),
    );

    const [, items] = pool.putQuizItems.mock.calls[0] as [string, QuizItem[]];
    expect(items).toHaveLength(1);
    expect(result.discarded.map((entry) => entry.reason)).toContain("duplicate_item");
  });
});

describe("level-scoped regeneration", () => {
  it("retries a thin level exactly once, scoped to that level", async () => {
    const goodItem = (difficulty: number, stem: string) => ({
      topicId: "alpha",
      difficulty,
      stem,
      unitIdx: 0,
      options: [
        { text: `Right ${stem}`, isCorrect: true, misconceptionLabel: null },
        { text: `A ${stem}`, isCorrect: false, misconceptionLabel: "a" },
        { text: `B ${stem}`, isCorrect: false, misconceptionLabel: "b" },
        { text: `C ${stem}`, isCorrect: false, misconceptionLabel: "c" },
      ],
    });

    const generateQuizPool = vi
      .fn()
      // First pass: level 3 comes back empty.
      .mockResolvedValueOnce({
        ok: true,
        value: {
          items: [
            goodItem(1, "one"),
            goodItem(1, "two"),
            goodItem(2, "three"),
            goodItem(2, "four"),
          ],
        },
      })
      // Second pass: the level-scoped retry supplies it.
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [goodItem(3, "five"), goodItem(3, "six")] },
      });

    const provider = { ...stubProvider({}), generateQuizPool } as unknown as AIProvider;

    const result = await generateAndPersistQuizPool(input({ provider }));

    expect(generateQuizPool).toHaveBeenCalledTimes(2);
    expect(generateQuizPool.mock.calls[1][0].difficulties).toEqual([3]);
    expect(result.countsByDifficulty).toEqual({ 1: 2, 2: 2, 3: 2 });
    expect(result.poolStatus).toBe("ready");
  });

  it("does not retry when every level is adequately filled", async () => {
    const provider = new DemoAIProvider();
    const spy = vi.spyOn(provider, "generateQuizPool");

    await generateAndPersistQuizPool(input({ provider }));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("persists what it has when the retry also fails", async () => {
    const generateQuizPool = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          items: [
            {
              topicId: "alpha",
              difficulty: 1,
              stem: "Only question?",
              unitIdx: 0,
              options: [
                { text: "Right", isCorrect: true, misconceptionLabel: null },
                { text: "A", isCorrect: false, misconceptionLabel: "a" },
                { text: "B", isCorrect: false, misconceptionLabel: "b" },
                { text: "C", isCorrect: false, misconceptionLabel: "c" },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: false, reason: "timeout" });

    const provider = { ...stubProvider({}), generateQuizPool } as unknown as AIProvider;
    const result = await generateAndPersistQuizPool(input({ provider }));

    expect(result.poolStatus).toBe("ready");
    expect(result.persisted).toBe(1);
    expect(result.meetsEngineMinimum).toBe(false);
  });
});

describe("failure", () => {
  it("marks the pool unavailable when the provider fails", async () => {
    const result = await generateAndPersistQuizPool(
      input({ provider: stubProvider(null, false), requestId: "req-9" }),
    );

    expect(result.poolStatus).toBe("unavailable");
    expect(result.degraded).toEqual(["pool"]);
    expect(pool.putQuizItems).not.toHaveBeenCalled();
    expect(material.setPoolStatus).toHaveBeenCalledWith("cs_1", 1, "unavailable");
    expect(logger.logFallback).toHaveBeenCalledWith(
      expect.objectContaining({ task: "pool", reason: "transport", requestId: "req-9" }),
    );
  });

  it("marks the pool unavailable when every item is rejected", async () => {
    const provider = stubProvider({
      items: [
        { topicId: "ghost", difficulty: 1, stem: "Bad?", unitIdx: 0, options: [] },
        { topicId: "alpha", difficulty: 9, stem: "Also bad?", unitIdx: 99, options: [] },
      ],
    });

    const result = await generateAndPersistQuizPool(input({ provider }));

    expect(result.poolStatus).toBe("unavailable");
    expect(result.persisted).toBe(0);
    expect(pool.putQuizItems).not.toHaveBeenCalled();
    expect(result.discarded.length).toBeGreaterThan(0);
  });

  it("marks the pool unavailable when there is no source material", async () => {
    material.listSourceUnits.mockResolvedValue([]);
    material.listTopics.mockResolvedValue([]);

    const result = await generateAndPersistQuizPool(input());

    expect(result.poolStatus).toBe("unavailable");
    expect(result.meetsEngineMinimum).toBe(false);
  });
});
