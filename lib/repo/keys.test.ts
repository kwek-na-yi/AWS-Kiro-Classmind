import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  explanationSk,
  joinCodeKey,
  joinCodePk,
  isMetaSk,
  learnerSk,
  materialSk,
  metaSk,
  misconceptionSk,
  parseExplanationSk,
  parseJoinCodePk,
  parseLearnerSk,
  parseMaterialSk,
  parseMisconceptionSk,
  parseProfileSk,
  parseQuizItemSk,
  parseQuizSessionSk,
  parseRecapSk,
  parseReportSk,
  parseResponseSk,
  parseSessionPk,
  parseTopicSk,
  parseUnitSk,
  prefixes,
  profileSk,
  quizItemSk,
  quizSessionSk,
  recapSk,
  reportSk,
  responseSk,
  sessionItemKey,
  sessionPk,
  topicSk,
  unitSk,
} from "@/lib/repo/keys";
import {
  EXPLANATION_STYLES,
  UNDERSTANDING_LEVELS,
  type DifficultyLevel,
} from "@/lib/types";

/** A component that is legal in a key: non-empty and free of the `#` separator. */
const idArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.length > 0 && !s.includes("#"));

const difficultyArb = fc.constantFrom<DifficultyLevel>(1, 2, 3);
const versionArb = fc.integer({ min: 1, max: 99 });

describe("partition keys", () => {
  it("round-trips a Class_Session partition key", () => {
    fc.assert(
      fc.property(idArb, (sessionId) => {
        expect(parseSessionPk(sessionPk(sessionId))).toEqual({ sessionId });
      }),
    );
  });

  it("round-trips a Join_Code pointer key", () => {
    fc.assert(
      fc.property(idArb, (joinCode) => {
        expect(parseJoinCodePk(joinCodePk(joinCode))).toEqual({ joinCode });
      }),
    );
  });

  it("uses the same string for both halves of the Join_Code pointer", () => {
    const key = joinCodeKey("CM2026");
    expect(key).toEqual({ PK: "JOIN#CM2026", SK: "JOIN#CM2026" });
  });

  it("pairs a session partition with a sort key", () => {
    expect(sessionItemKey("cs_1", metaSk())).toEqual({
      PK: "CS#cs_1",
      SK: "META",
    });
  });

  it("produces the documented key shapes", () => {
    expect(sessionPk("cs_1")).toBe("CS#cs_1");
    expect(joinCodePk("CM2026")).toBe("JOIN#CM2026");
  });
});

describe("sort key builders and parsers", () => {
  it("identifies the META sort key", () => {
    expect(metaSk()).toBe("META");
    expect(isMetaSk("META")).toBe(true);
    expect(isMetaSk("MATERIAL#v1")).toBe(false);
  });

  it("round-trips a Lecture_Material key", () => {
    fc.assert(
      fc.property(versionArb, (version) => {
        expect(parseMaterialSk(materialSk(version))).toEqual({ version });
      }),
    );
  });

  it("round-trips a source unit key", () => {
    fc.assert(
      fc.property(versionArb, fc.integer({ min: 0, max: 9999 }), (version, index) => {
        expect(parseUnitSk(unitSk(version, index))).toEqual({ version, index });
      }),
    );
  });

  it("round-trips a Topic key", () => {
    fc.assert(
      fc.property(
        versionArb,
        fc.integer({ min: 0, max: 99 }),
        idArb,
        (version, order, topicId) => {
          expect(parseTopicSk(topicSk(version, order, topicId))).toEqual({
            version,
            order,
            topicId,
          });
        },
      ),
    );
  });

  it("round-trips Learner and Learner_Profile keys", () => {
    fc.assert(
      fc.property(idArb, (learnerId) => {
        expect(parseLearnerSk(learnerSk(learnerId))).toEqual({ learnerId });
        expect(parseProfileSk(profileSk(learnerId))).toEqual({ learnerId });
      }),
    );
  });

  it("round-trips a Recap cache key for every profile combination", () => {
    fc.assert(
      fc.property(
        versionArb,
        fc.constantFrom(...UNDERSTANDING_LEVELS),
        fc.constantFrom(...EXPLANATION_STYLES),
        (version, understandingLevel, explanationStyle) => {
          expect(
            parseRecapSk(recapSk(version, understandingLevel, explanationStyle)),
          ).toEqual({ version, understandingLevel, explanationStyle });
        },
      ),
    );
  });

  it("round-trips a Quiz_Item key", () => {
    fc.assert(
      fc.property(versionArb, difficultyArb, idArb, (version, difficulty, quizItemId) => {
        expect(parseQuizItemSk(quizItemSk(version, difficulty, quizItemId))).toEqual({
          version,
          difficulty,
          quizItemId,
        });
      }),
    );
  });

  it("round-trips a Quiz_Session key", () => {
    fc.assert(
      fc.property(idArb, idArb, (learnerId, quizSessionId) => {
        expect(parseQuizSessionSk(quizSessionSk(learnerId, quizSessionId))).toEqual({
          learnerId,
          quizSessionId,
        });
      }),
    );
  });

  it("round-trips a Quiz_Response key", () => {
    fc.assert(
      fc.property(idArb, fc.integer({ min: 0, max: 99 }), (quizSessionId, seq) => {
        expect(parseResponseSk(responseSk(quizSessionId, seq))).toEqual({
          quizSessionId,
          seq,
        });
      }),
    );
  });

  it("round-trips an Understanding_Report key", () => {
    fc.assert(
      fc.property(idArb, idArb, (learnerId, quizSessionId) => {
        expect(parseReportSk(reportSk(learnerId, quizSessionId))).toEqual({
          learnerId,
          quizSessionId,
        });
      }),
    );
  });

  it("round-trips a Peer_Explanation key", () => {
    fc.assert(
      fc.property(idArb, idArb, idArb, (topicId, submittedAt, explanationId) => {
        expect(
          parseExplanationSk(explanationSk(topicId, submittedAt, explanationId)),
        ).toEqual({ topicId, submittedAt, explanationId });
      }),
    );
  });

  it("round-trips a misconception clarification key", () => {
    fc.assert(
      fc.property(versionArb, idArb, idArb, (version, quizItemId, optionId) => {
        expect(
          parseMisconceptionSk(misconceptionSk(version, quizItemId, optionId)),
        ).toEqual({ version, quizItemId, optionId });
      }),
    );
  });

  it("produces the documented key shapes", () => {
    expect(materialSk(1)).toBe("MATERIAL#v1");
    expect(unitSk(1, 7)).toBe("UNIT#v1#0007");
    expect(topicSk(1, 3, "normalisation")).toBe("TOPIC#v1#03#normalisation");
    expect(learnerSk("l_1")).toBe("LEARNER#l_1");
    expect(profileSk("l_1")).toBe("PROFILE#l_1");
    expect(recapSk(1, "Basic_Understanding", "Step_By_Step")).toBe(
      "RECAP#v1#Basic_Understanding#Step_By_Step",
    );
    expect(quizItemSk(1, 2, "qi_9")).toBe("QITEM#v1#2#qi_9");
    expect(quizSessionSk("l_1", "qs_1")).toBe("QSESS#l_1#qs_1");
    expect(responseSk("qs_1", 2)).toBe("RESP#qs_1#02");
    expect(reportSk("l_1", "qs_1")).toBe("REPORT#l_1#qs_1");
    expect(explanationSk("t_1", "2026-01-01T10:00:00.000Z", "e_1")).toBe(
      "EXPL#t_1#2026-01-01T10:00:00.000Z#e_1",
    );
    expect(misconceptionSk(1, "qi_9", "b")).toBe("MISC#v1#qi_9#b");
  });
});

describe("zero padding makes lexicographic order match numeric order", () => {
  it("orders source unit indexes numerically", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 0, max: 9999 }),
        (a, b) => {
          const ka = unitSk(1, a);
          const kb = unitSk(1, b);
          expect(ka < kb).toBe(a < b);
        },
      ),
    );
  });

  it("orders Quiz_Response sequences numerically", () => {
    const keys = [10, 2, 1, 9].map((seq) => responseSk("qs_1", seq));
    expect([...keys].sort()).toEqual([
      responseSk("qs_1", 1),
      responseSk("qs_1", 2),
      responseSk("qs_1", 9),
      responseSk("qs_1", 10),
    ]);
  });

  it("orders Topics by their persisted order index", () => {
    const keys = [10, 2, 0].map((order) => topicSk(1, order, "t"));
    expect([...keys].sort()).toEqual([
      topicSk(1, 0, "t"),
      topicSk(1, 2, "t"),
      topicSk(1, 10, "t"),
    ]);
  });
});

describe("parsers reject keys of another kind", () => {
  it("returns null rather than a wrong shape", () => {
    expect(parseUnitSk(topicSk(1, 0, "t"))).toBeNull();
    expect(parseTopicSk(unitSk(1, 0))).toBeNull();
    expect(parseResponseSk(reportSk("l_1", "qs_1"))).toBeNull();
    expect(parseQuizItemSk("QITEM#v1#4#qi_1")).toBeNull();
    expect(parseRecapSk("RECAP#v1#Nope#Concise")).toBeNull();
    expect(parseRecapSk("RECAP#v1#Basic_Understanding#Nope")).toBeNull();
    expect(parseUnitSk("UNIT#v1#7")).toBeNull();
    expect(parseMaterialSk("MATERIAL#v0")).toBeNull();
    expect(parseSessionPk("JOIN#CM2026")).toBeNull();
  });
});

describe("component guards", () => {
  it("rejects a component containing the separator", () => {
    expect(() => sessionPk("cs#1")).toThrow(/must not contain/);
    expect(() => learnerSk("l#1")).toThrow(/must not contain/);
    expect(() => topicSk(1, 0, "a#b")).toThrow(/must not contain/);
    expect(() => explanationSk("t_1", "2026#01", "e_1")).toThrow(/must not contain/);
  });

  it("rejects an empty component", () => {
    expect(() => sessionPk("")).toThrow(/non-empty/);
    expect(() => quizSessionSk("l_1", "")).toThrow(/non-empty/);
  });

  it("rejects a numeric component too wide for its field", () => {
    expect(() => unitSk(1, 10000)).toThrow(/does not fit/);
    expect(() => responseSk("qs_1", 100)).toThrow(/does not fit/);
    expect(() => topicSk(1, 100, "t")).toThrow(/does not fit/);
  });

  it("rejects a negative or fractional numeric component", () => {
    expect(() => unitSk(1, -1)).toThrow(/non-negative integer/);
    expect(() => unitSk(1, 1.5)).toThrow(/non-negative integer/);
  });

  it("rejects an invalid material version", () => {
    expect(() => materialSk(0)).toThrow(/integer >= 1/);
    expect(() => materialSk(1.5)).toThrow(/integer >= 1/);
  });

  it("rejects a Difficulty_Level outside 1 to 3", () => {
    expect(() => quizItemSk(1, 4 as DifficultyLevel, "qi_1")).toThrow(/1, 2 or 3/);
    expect(() => prefixes.quizItems(1, 0 as DifficultyLevel)).toThrow(/1, 2 or 3/);
  });
});

describe("begins_with prefixes", () => {
  it("builds a prefix of the key it selects", () => {
    expect(unitSk(2, 7).startsWith(prefixes.units(2))).toBe(true);
    expect(topicSk(2, 7, "t").startsWith(prefixes.topics(2))).toBe(true);
    expect(quizItemSk(2, 3, "qi_1").startsWith(prefixes.quizItems(2))).toBe(true);
    expect(quizItemSk(2, 3, "qi_1").startsWith(prefixes.quizItems(2, 3))).toBe(true);
    expect(recapSk(2, "No_Understanding", "Concise").startsWith(prefixes.recaps(2))).toBe(true);
    expect(misconceptionSk(2, "qi_1", "b").startsWith(prefixes.misconceptions(2))).toBe(true);
    expect(materialSk(2).startsWith(prefixes.material(2))).toBe(true);
    expect(learnerSk("l_1").startsWith(prefixes.learners())).toBe(true);
    expect(quizSessionSk("l_1", "qs_1").startsWith(prefixes.quizSessions("l_1"))).toBe(true);
    expect(quizSessionSk("l_1", "qs_1").startsWith(prefixes.quizSessions())).toBe(true);
    expect(responseSk("qs_1", 1).startsWith(prefixes.responses("qs_1"))).toBe(true);
    expect(reportSk("l_1", "qs_1").startsWith(prefixes.reports("l_1"))).toBe(true);
    expect(explanationSk("t_1", "ts", "e_1").startsWith(prefixes.explanations("t_1"))).toBe(true);
    expect(explanationSk("t_1", "ts", "e_1").startsWith(prefixes.explanations())).toBe(true);
  });

  it("selects every Quiz_Response in the Class_Session with the bare RESP prefix", () => {
    // Access pattern 20: the single query the Class_Understanding_Map is built from.
    const classWide = prefixes.responses();
    expect(responseSk("qs_1", 1).startsWith(classWide)).toBe(true);
    expect(responseSk("qs_2", 6).startsWith(classWide)).toBe(true);
    expect(reportSk("l_1", "qs_1").startsWith(classWide)).toBe(false);
  });

  it("scopes a difficulty prefix to that level only", () => {
    expect(quizItemSk(1, 1, "qi_1").startsWith(prefixes.quizItems(1, 2))).toBe(false);
  });

  it("scopes a version prefix to that material version only", () => {
    expect(unitSk(1, 0).startsWith(prefixes.units(2))).toBe(false);
    expect(topicSk(1, 0, "t").startsWith(prefixes.topics(2))).toBe(false);
  });
});
