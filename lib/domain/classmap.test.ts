import { readFileSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ANONYMITY_THRESHOLD,
  BAND_LABELS,
  bandFor,
  computeClassMap,
  type ClassMapEntry,
  type ClassResponse,
  type NamedTopic,
} from "@/lib/domain/classmap";

const TOPICS: NamedTopic[] = [
  { topicId: "t1", name: "Normalisation" },
  { topicId: "t2", name: "Indexing" },
  { topicId: "t3", name: "Transactions" },
];

function response(
  topicId: string,
  learnerId: string,
  isCorrect: boolean,
): ClassResponse {
  return { topicId, learnerId, isCorrect };
}

/** `count` responses to one Topic from distinct Learners, `correct` of them right. */
function fromLearners(
  topicId: string,
  count: number,
  correct: number,
  prefix = "l",
): ClassResponse[] {
  return Array.from({ length: count }, (_, i) =>
    response(topicId, `${prefix}${i}`, i < correct),
  );
}

function published(entries: ClassMapEntry[]) {
  return entries.filter((entry) => entry.status === "published");
}

const responsesArb = fc.array(
  fc.record({
    topicId: fc.constantFrom("t1", "t2", "t3"),
    learnerId: fc.constantFrom("l1", "l2", "l3", "l4", "l5"),
    isCorrect: fc.boolean(),
  }),
  { maxLength: 40 },
);

describe("aggregation", () => {
  it("counts responses and correct answers per Topic", () => {
    const entries = computeClassMap(TOPICS, [
      ...fromLearners("t1", 4, 2),
      ...fromLearners("t2", 3, 3),
    ]);

    const t1 = entries.find((entry) => entry.topicId === "t1");
    expect(t1).toMatchObject({
      status: "published",
      answered: 4,
      correct: 2,
      classMastery: 50,
      respondingLearners: 4,
    });

    const t2 = entries.find((entry) => entry.topicId === "t2");
    expect(t2).toMatchObject({ status: "published", classMastery: 100 });
  });

  it("returns one row per Topic, including Topics with no responses", () => {
    const entries = computeClassMap(TOPICS, fromLearners("t1", 3, 1));

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.topicId).sort()).toEqual(["t1", "t2", "t3"]);
    expect(entries.find((e) => e.topicId === "t3")?.status).toBe("insufficient-data");
  });

  it("counts one Learner's several responses as one distinct Learner", () => {
    const entries = computeClassMap(TOPICS, [
      response("t1", "solo", true),
      response("t1", "solo", false),
      response("t1", "solo", true),
      response("t1", "solo", true),
    ]);

    expect(entries.find((entry) => entry.topicId === "t1")?.status).toBe(
      "insufficient-data",
    );
  });

  it("ignores a response naming a Topic outside the Class_Session", () => {
    const entries = computeClassMap(TOPICS, [
      ...fromLearners("t1", 3, 3),
      response("ghost", "l9", true),
    ]);

    expect(entries).toHaveLength(3);
    expect(entries.some((entry) => entry.topicId === "ghost")).toBe(false);
  });

  it("scores 0 and 100 exactly at the extremes", () => {
    const entries = computeClassMap(TOPICS, [
      ...fromLearners("t1", 5, 0),
      ...fromLearners("t2", 5, 5),
    ]);

    expect(entries.find((e) => e.topicId === "t1")).toMatchObject({
      classMastery: 0,
      band: "needs-attention",
    });
    expect(entries.find((e) => e.topicId === "t2")).toMatchObject({
      classMastery: 100,
      band: "strong",
    });
  });
});

describe("the Anonymity_Threshold", () => {
  it("is three distinct Learners", () => {
    expect(ANONYMITY_THRESHOLD).toBe(3);
  });

  it("suppresses at two distinct Learners and publishes at three", () => {
    const two = computeClassMap(TOPICS, fromLearners("t1", 2, 1));
    expect(two.find((entry) => entry.topicId === "t1")?.status).toBe(
      "insufficient-data",
    );

    const three = computeClassMap(TOPICS, fromLearners("t1", 3, 2));
    expect(three.find((entry) => entry.topicId === "t1")?.status).toBe("published");

    const four = computeClassMap(TOPICS, fromLearners("t1", 4, 2));
    expect(four.find((entry) => entry.topicId === "t1")?.status).toBe("published");
  });

  it("emits nothing but identity on a suppressed row", () => {
    const entries = computeClassMap(TOPICS, fromLearners("t1", 2, 2));
    const suppressed = entries.find((entry) => entry.topicId === "t1");

    expect(Object.keys(suppressed ?? {}).sort()).toEqual([
      "status",
      "topicId",
      "topicName",
    ]);
    expect(suppressed).not.toHaveProperty("classMastery");
    expect(suppressed).not.toHaveProperty("band");
    expect(suppressed).not.toHaveProperty("respondingLearners");
    expect(suppressed).not.toHaveProperty("answered");
    expect(suppressed).not.toHaveProperty("correct");
  });
});

describe("bands", () => {
  it("assigns the documented boundaries", () => {
    expect(bandFor(0)).toBe("needs-attention");
    expect(bandFor(49)).toBe("needs-attention");
    expect(bandFor(50)).toBe("developing");
    expect(bandFor(74)).toBe("developing");
    expect(bandFor(75)).toBe("strong");
    expect(bandFor(100)).toBe("strong");
  });

  it("carries the text label for every band", () => {
    const cases: [number, number, string][] = [
      // answered, correct, expected label — 49, 50, 74 and 75 percent exactly.
      [100, 49, BAND_LABELS["needs-attention"]],
      [100, 50, BAND_LABELS.developing],
      [100, 74, BAND_LABELS.developing],
      [100, 75, BAND_LABELS.strong],
    ];

    for (const [answered, correct, label] of cases) {
      const entries = computeClassMap(TOPICS, fromLearners("t1", answered, correct));
      expect(entries.find((entry) => entry.topicId === "t1")).toMatchObject({
        classMastery: correct,
        bandLabel: label,
      });
    }
  });
});

describe("Property 9: boundary agreement", () => {
  it("yields 100 for all-correct Topics and 0 for all-incorrect ones", () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 20 }), (learners) => {
        const allCorrect = computeClassMap(TOPICS, fromLearners("t1", learners, learners));
        const allWrong = computeClassMap(TOPICS, fromLearners("t2", learners, 0));

        expect(allCorrect.find((e) => e.topicId === "t1")).toMatchObject({
          classMastery: 100,
        });
        expect(allWrong.find((e) => e.topicId === "t2")).toMatchObject({
          classMastery: 0,
        });
      }),
    );
  });
});

describe("Property 10: response conservation", () => {
  it("accounts for every response across the per-Topic counts", () => {
    fc.assert(
      fc.property(responsesArb, (responses) => {
        // Suppressed rows carry no counts, so conservation is checked against a
        // map computed with the threshold lowered to publish every Topic.
        const entries = computeClassMap(TOPICS, responses, 1);

        const counted = published(entries).reduce(
          (total, entry) => total + entry.answered,
          0,
        );

        expect(counted).toBe(responses.length);
      }),
    );
  });

  it("accounts for every correct response too", () => {
    fc.assert(
      fc.property(responsesArb, (responses) => {
        const entries = computeClassMap(TOPICS, responses, 1);

        const correct = published(entries).reduce(
          (total, entry) => total + entry.correct,
          0,
        );

        expect(correct).toBe(responses.filter((r) => r.isCorrect).length);
      }),
    );
  });
});

describe("Property 11: order independence", () => {
  it("yields an identical map for every permutation of the same responses", () => {
    fc.assert(
      fc.property(responsesArb, (responses) => {
        const baseline = computeClassMap(TOPICS, responses);

        // Twenty independent shuffles of the same set.
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const shuffled = [...responses];
          for (let i = shuffled.length - 1; i > 0; i -= 1) {
            const j = (i * 7 + attempt * 13 + 5) % (i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }

          expect(computeClassMap(TOPICS, shuffled)).toEqual(baseline);
        }
      }),
      { numRuns: 25 },
    );
  });

  it("does not depend on the order the Topics arrive in", () => {
    const responses = [...fromLearners("t1", 3, 3), ...fromLearners("t2", 3, 0)];

    expect(computeClassMap([...TOPICS].reverse(), responses)).toEqual(
      computeClassMap(TOPICS, responses),
    );
  });

  it("orders same-mastery, same-name Topics by id rather than by input order", () => {
    const topics: NamedTopic[] = [
      { topicId: "zzz", name: "Shared Name" },
      { topicId: "aaa", name: "Shared Name" },
    ];
    const responses = [...fromLearners("zzz", 3, 3), ...fromLearners("aaa", 3, 3)];

    const forward = computeClassMap(topics, responses);
    const reversed = computeClassMap([...topics].reverse(), responses);

    expect(forward.map((entry) => entry.topicId)).toEqual(["aaa", "zzz"]);
    expect(reversed).toEqual(forward);
  });
});

describe("Property 13: ordering", () => {
  it("lists published Topics weakest first", () => {
    fc.assert(
      fc.property(responsesArb, (responses) => {
        const entries = computeClassMap(TOPICS, responses, 1);
        const masteries = published(entries).map((entry) => entry.classMastery);

        for (let i = 1; i < masteries.length; i += 1) {
          expect(masteries[i]).toBeGreaterThanOrEqual(masteries[i - 1]);
        }
      }),
    );
  });

  it("places suppressed Topics last, ordered by name", () => {
    const topics: NamedTopic[] = [
      { topicId: "a", name: "Zebra" },
      { topicId: "b", name: "alpha" },
      { topicId: "c", name: "Published" },
    ];

    const entries = computeClassMap(topics, fromLearners("c", 3, 1));

    expect(entries.map((entry) => entry.topicId)).toEqual(["c", "b", "a"]);
    expect(entries[0].status).toBe("published");
  });

  it("breaks a mastery tie by case-insensitive Topic name", () => {
    const topics: NamedTopic[] = [
      { topicId: "x", name: "beta" },
      { topicId: "y", name: "Alpha" },
    ];

    const entries = computeClassMap(topics, [
      ...fromLearners("x", 4, 2),
      ...fromLearners("y", 4, 2),
    ]);

    expect(entries.map((entry) => entry.topicName)).toEqual(["Alpha", "beta"]);
  });
});

describe("Property 15: threshold suppression", () => {
  it("omits Class_Mastery for every Topic below the threshold", () => {
    fc.assert(
      fc.property(responsesArb, (responses) => {
        const entries = computeClassMap(TOPICS, responses);

        for (const entry of entries) {
          const distinct = new Set(
            responses
              .filter((response) => response.topicId === entry.topicId)
              .map((response) => response.learnerId),
          ).size;

          if (distinct < ANONYMITY_THRESHOLD) {
            expect(entry.status).toBe("insufficient-data");
            expect(entry).not.toHaveProperty("classMastery");
          } else {
            expect(entry.status).toBe("published");
            expect(entry).toHaveProperty("classMastery");
          }
        }
      }),
    );
  });
});

describe("Property 16: single-learner non-disclosure", () => {
  it("publishes nothing when every response comes from one Learner", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            topicId: fc.constantFrom("t1", "t2", "t3"),
            isCorrect: fc.boolean(),
          }),
          { maxLength: 30 },
        ),
        (rows) => {
          const responses = rows.map((row) => response(row.topicId, "solo", row.isCorrect));
          const entries = computeClassMap(TOPICS, responses);

          expect(published(entries)).toHaveLength(0);
          for (const entry of entries) {
            expect(entry.status).toBe("insufficient-data");
          }
        },
      ),
    );
  });

  it("still publishes nothing when that Learner answers every Topic many times", () => {
    const responses = TOPICS.flatMap((topic) =>
      Array.from({ length: 10 }, (_, i) => response(topic.topicId, "solo", i % 2 === 0)),
    );

    expect(published(computeClassMap(TOPICS, responses))).toHaveLength(0);
  });
});

describe("purity", () => {
  it("issues no request and touches no storage", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "lib/domain/classmap.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/(aws|repo)/);
    expect(source).not.toMatch(/from\s+["']@aws-sdk/);
    expect(source).not.toMatch(/\bawait import\b/);
  });

  it("does not mutate its inputs", () => {
    const topics = [...TOPICS];
    const responses = fromLearners("t1", 4, 2);
    const topicsCopy = structuredClone(topics);
    const responsesCopy = structuredClone(responses);

    computeClassMap(topics, responses);

    expect(topics).toEqual(topicsCopy);
    expect(responses).toEqual(responsesCopy);
  });
});
