import { beforeEach, describe, expect, it, vi } from "vitest";

import { DemoAIProvider } from "@/lib/ai/demo/provider";
import type { AIProvider, RecapOutput } from "@/lib/ai/provider";
import type { Recap, SourceUnit, Topic } from "@/lib/types";

const repo = vi.hoisted(() => ({
  getRecap: vi.fn(),
  putRecap: vi.fn(),
  listSourceUnits: vi.fn(),
  listTopics: vi.fn(),
  getMaterial: vi.fn(),
  setPoolStatus: vi.fn(),
  transitionPoolStatus: vi.fn(),
}));

const logger = vi.hoisted(() => ({ logFallback: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/repo/material", () => repo);
vi.mock("@/lib/aws/logger", () => logger);

const { getOrGenerateRecap } = await import("@/lib/ai/services/recap");

const UNITS: SourceUnit[] = [
  {
    materialVersion: 1,
    index: 0,
    text: "Normalisation organises columns to remove redundancy. A table is in first normal form when every column holds a single atomic value.",
    ref: { kind: "page", value: "p. 1" },
  },
  {
    materialVersion: 1,
    index: 1,
    text: "An index speeds up reads and slows down writes. A covering index answers a query from the index alone.",
    ref: { kind: "page", value: "p. 2" },
  },
  {
    materialVersion: 1,
    index: 2,
    text: "Denormalisation reintroduces redundancy so that fewer joins are needed. Every write path must then keep the copies consistent.",
    ref: { kind: "page", value: "p. 3" },
  },
];

const TOPICS: Topic[] = [
  { topicId: "alpha", materialVersion: 1, order: 0, name: "Normalisation", unitIdxs: [0] },
  { topicId: "beta", materialVersion: 1, order: 1, name: "Indexing", unitIdxs: [1] },
  { topicId: "gamma", materialVersion: 1, order: 2, name: "Denormalisation", unitIdxs: [2] },
];

const NOW = () => "2026-01-01T00:00:00.000Z";

const PROFILE = {
  understandingLevel: "Basic_Understanding",
  explanationStyle: "Detailed",
} as const;

function input(overrides: Partial<Parameters<typeof getOrGenerateRecap>[0]> = {}) {
  return {
    sessionId: "cs_1",
    materialVersion: 1,
    profile: PROFILE,
    provider: new DemoAIProvider(),
    now: NOW,
    ...overrides,
  };
}

/** A provider that returns whatever it is told to. */
function stubProvider(recap: unknown, ok = true): AIProvider {
  return {
    id: "stub",
    label: "stub",
    kind: "deterministic",
    generateRecap: vi.fn(async () =>
      ok
        ? { ok: true as const, value: recap as RecapOutput }
        : { ok: false as const, reason: "timeout" as const },
    ),
    generateQuizPool: vi.fn(),
    clarifyMisconception: vi.fn(),
    validatePeerExplanation: vi.fn(),
  } as unknown as AIProvider;
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.getRecap.mockResolvedValue(null);
  repo.putRecap.mockResolvedValue(undefined);
  repo.listSourceUnits.mockResolvedValue(UNITS);
  repo.listTopics.mockResolvedValue(TOPICS);
});

describe("cache", () => {
  it("returns a retained Recap without generating", async () => {
    const retained = { mode: "generated", takeaways: ["A."], sections: [] } as unknown as Recap;
    repo.getRecap.mockResolvedValue(retained);

    const provider = stubProvider({});
    const result = await getOrGenerateRecap(input({ provider }));

    expect(result.source).toBe("cache");
    expect(result.recap).toBe(retained);
    expect(provider.generateRecap).not.toHaveBeenCalled();
    expect(repo.listSourceUnits).not.toHaveBeenCalled();
    expect(repo.putRecap).not.toHaveBeenCalled();
  });

  it("generates and persists on a miss", async () => {
    const result = await getOrGenerateRecap(input());

    expect(result.source).toBe("generated");
    expect(repo.putRecap).toHaveBeenCalledTimes(1);

    const persisted = repo.putRecap.mock.calls[0][0] as Recap;
    expect(persisted.mode).toBe("generated");
    expect(persisted.sessionId).toBe("cs_1");
    expect(persisted.understandingLevel).toBe("Basic_Understanding");
    expect(persisted.explanationStyle).toBe("Detailed");
    expect(persisted.sections).toHaveLength(TOPICS.length);
  });

  it("looks the cache up by the full profile combination", async () => {
    await getOrGenerateRecap(input());

    expect(repo.getRecap).toHaveBeenCalledWith(
      "cs_1",
      1,
      "Basic_Understanding",
      "Detailed",
    );
  });

  it("does not cache a fallback Recap", async () => {
    const result = await getOrGenerateRecap(
      input({ provider: stubProvider(null, false) }),
    );

    expect(result.source).toBe("fallback");
    expect(result.recap.mode).toBe("source_extract");
    expect(repo.putRecap).not.toHaveBeenCalled();
  });
});

describe("profile variation", () => {
  it("generates separately for each of the fifteen combinations", async () => {
    const levels = ["No_Understanding", "Basic_Understanding", "Strong_Understanding"] as const;
    const styles = [
      "Concise",
      "Detailed",
      "Examples",
      "Step_By_Step",
      "Visual_Structured",
    ] as const;

    const bodies = new Set<string>();

    for (const understandingLevel of levels) {
      for (const explanationStyle of styles) {
        const result = await getOrGenerateRecap(
          input({ profile: { understandingLevel, explanationStyle } }),
        );

        expect(result.source).toBe("generated");
        expect(result.recap.understandingLevel).toBe(understandingLevel);
        expect(result.recap.explanationStyle).toBe(explanationStyle);

        bodies.add(result.recap.sections.map((entry) => entry.body).join("|"));
      }
    }

    expect(repo.getRecap).toHaveBeenCalledTimes(15);
    expect(repo.putRecap).toHaveBeenCalledTimes(15);
    // The fifteen variants are genuinely different documents.
    expect(bodies.size).toBe(15);
  });
});

describe("validation", () => {
  it("resolves every Source_Reference against the persisted units", async () => {
    const result = await getOrGenerateRecap(input());
    const valid = new Set(UNITS.map((unit) => unit.ref.value));

    for (const section of result.recap.sections) {
      for (const ref of section.sourceRefs) {
        expect(valid.has(ref.value)).toBe(true);
      }
    }
  });

  it("falls back when the provider cites nothing that resolves", async () => {
    const provider = stubProvider({
      takeaways: ["One.", "Two.", "Three."],
      sections: TOPICS.map((topic) => ({
        topicId: topic.topicId,
        covered: true,
        body: "Invented body.",
        proseBody: "Invented body.",
        artefact: { kind: "none", content: "" },
        unitIdxs: [999],
      })),
    });

    const result = await getOrGenerateRecap(input({ provider }));

    expect(result.source).toBe("fallback");
    expect(repo.putRecap).not.toHaveBeenCalled();
    expect(logger.logFallback).toHaveBeenCalledWith(
      expect.objectContaining({ task: "recap", reason: "unresolvable_citation" }),
    );
  });

  it("falls back on malformed provider output", async () => {
    for (const malformed of [{}, { takeaways: [] }, { takeaways: ["Only one."] }, null]) {
      vi.clearAllMocks();
      repo.getRecap.mockResolvedValue(null);
      repo.listSourceUnits.mockResolvedValue(UNITS);
      repo.listTopics.mockResolvedValue(TOPICS);

      const result = await getOrGenerateRecap(
        input({ provider: stubProvider(malformed) }),
      );

      expect(result.source).toBe("fallback");
      expect(repo.putRecap).not.toHaveBeenCalled();
    }
  });
});

describe("provider failure", () => {
  it("returns a source extract and names the degraded task", async () => {
    const result = await getOrGenerateRecap(
      input({ provider: stubProvider(null, false), requestId: "req-1" }),
    );

    expect(result.source).toBe("fallback");
    expect(result.degraded).toEqual(["recap"]);
    expect(result.recap.mode).toBe("source_extract");
    expect(result.recap.sections).toHaveLength(TOPICS.length);

    expect(logger.logFallback).toHaveBeenCalledWith({
      task: "recap",
      classSessionId: "cs_1",
      materialVersion: 1,
      reason: "timeout",
      attempts: 1,
      requestId: "req-1",
    });
  });

  it("quotes the source verbatim in the fallback", async () => {
    const result = await getOrGenerateRecap(
      input({ provider: stubProvider(null, false) }),
    );

    expect(result.recap.sections[0].body).toBe(UNITS[0].text);
    expect(result.recap.sections[0].sourceRefs).toEqual([
      { kind: "page", value: "p. 1" },
    ]);
  });
});

describe("determinism", () => {
  it("produces identical output for identical input", async () => {
    const first = await getOrGenerateRecap(input());
    const second = await getOrGenerateRecap(input());

    expect(JSON.stringify(second.recap)).toBe(JSON.stringify(first.recap));
  });

  it("uses the configured provider when none is supplied", async () => {
    const result = await getOrGenerateRecap({
      sessionId: "cs_1",
      materialVersion: 1,
      profile: PROFILE,
      now: NOW,
    });

    expect(result.source).toBe("generated");
    expect(repo.putRecap).toHaveBeenCalledTimes(1);
  });
});
