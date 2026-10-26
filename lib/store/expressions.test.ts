import { describe, expect, it } from "vitest";

import { buildCondition, buildUpdate } from "@/lib/store/expressions";

/**
 * The DynamoDB adapter's translation of declarative updates. These pin the
 * expressions to the ones the repositories issued directly before the storage
 * port existed, so the optional AWS path keeps its exact semantics.
 */

describe("updates", () => {
  it("aliases every attribute, including reserved words", () => {
    const out = buildUpdate({ set: { status: "ready", stage: "Done" } });

    expect(out.UpdateExpression).toBe("SET #n0 = :v0, #n1 = :v1");
    expect(out.ExpressionAttributeNames).toEqual({ "#n0": "status", "#n1": "stage" });
    expect(out.ExpressionAttributeValues).toEqual({ ":v0": "ready", ":v1": "Done" });
    expect(out.ConditionExpression).toBeUndefined();
  });

  it("guards the validation claim: increment only while attempts is zero", () => {
    const out = buildUpdate(
      { increment: { attempts: 1 } },
      { exists: true, equals: { attempts: 0 } },
    );

    expect(out.UpdateExpression).toBe("SET #n0 = if_not_exists(#n0, :v0) + :v1");
    expect(out.ConditionExpression).toBe("attribute_exists(SK) AND #n0 = :v2");
    expect(out.ExpressionAttributeValues).toEqual({ ":v0": 0, ":v1": 1, ":v2": 0 });
  });

  it("appends to a list that may not exist yet", () => {
    const out = buildUpdate({ appendToList: { servedItemIds: ["q1"] } }, { exists: true });
    expect(out.UpdateExpression).toBe("SET #n0 = list_append(if_not_exists(#n0, :v0), :v1)");
    expect(out.ExpressionAttributeValues).toEqual({ ":v0": [], ":v1": ["q1"] });
  });

  it("records an answer with SET plus ADD, guarded by first-write-wins", () => {
    const out = buildUpdate(
      { set: { runLen: 1 }, addToSet: { answeredItemIds: ["q1"] } },
      { exists: true, notContains: { answeredItemIds: "q1" } },
    );

    expect(out.UpdateExpression).toBe("SET #n0 = :v0 ADD #n1 :v1");
    expect(out.ConditionExpression).toBe("attribute_exists(SK) AND NOT contains(#n1, :v2)");
    expect(out.ExpressionAttributeValues?.[":v1"]).toEqual(new Set(["q1"]));
  });

  it("refuses an empty update", () => {
    expect(() => buildUpdate({})).toThrow();
  });
});

describe("conditional puts", () => {
  it("expresses not-exists", () => {
    expect(buildCondition({ exists: false })).toEqual({
      ConditionExpression: "attribute_not_exists(SK)",
    });
  });

  it("is empty when unconditional", () => {
    expect(buildCondition()).toEqual({});
  });
});
