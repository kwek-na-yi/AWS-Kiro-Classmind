import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { applyUpdate, conditionHolds, LocalStore } from "@/lib/store/local";
import { ConditionFailedError } from "@/lib/store/types";

/**
 * The embedded store has to give the repositories the same guarantees the
 * DynamoDB adapter does — conditional writes, all-or-nothing transactions,
 * ordered prefix queries — because idempotency in the quiz, the pool and the
 * validation claim is built on them.
 */

const ROOT = mkdtempSync(path.join(tmpdir(), "classmind-store-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

let counter = 0;
function fileStore(): { store: LocalStore; file: string } {
  counter += 1;
  const file = path.join(ROOT, `case-${counter}`, "store.json");
  return { store: new LocalStore(file), file };
}

const key = { PK: "SESSION#s1", SK: "META" };

describe("reads and writes", () => {
  it("round-trips an item and returns a copy, not the stored object", async () => {
    const store = new LocalStore(null);
    await store.put({ ...key, name: "Class", tags: ["a"] });

    const first = await store.get(key);
    (first?.tags as string[]).push("mutated");

    expect(await store.get(key)).toEqual({ ...key, name: "Class", tags: ["a"] });
  });

  it("drops undefined attributes, as the DynamoDB adapter does", async () => {
    const store = new LocalStore(null);
    await store.put({ ...key, reason: undefined, kept: "" });

    const item = await store.get(key);
    expect(item).not.toHaveProperty("reason");
    expect(item?.kept).toBe("");
  });

  it("returns null for an absent item", async () => {
    expect(await new LocalStore(null).get(key)).toBeNull();
  });

  it("queries one partition by prefix, in sort-key order", async () => {
    const store = new LocalStore(null);
    await store.putAll([
      { PK: "SESSION#s1", SK: "TOPIC#v1#002" },
      { PK: "SESSION#s1", SK: "TOPIC#v1#000" },
      { PK: "SESSION#s1", SK: "UNIT#v1#000" },
      { PK: "SESSION#s2", SK: "TOPIC#v1#001" },
    ]);

    const topics = await store.query("SESSION#s1", "TOPIC#");
    expect(topics.map((item) => item.SK)).toEqual(["TOPIC#v1#000", "TOPIC#v1#002"]);
    expect(await store.count("SESSION#s1", "TOPIC#")).toBe(2);
    expect(await store.query("SESSION#s1", "")).toHaveLength(3);
  });

  it("batch-gets only the items that exist", async () => {
    const store = new LocalStore(null);
    await store.put({ PK: "P", SK: "a" });
    const found = await store.batchGet([
      { PK: "P", SK: "a" },
      { PK: "P", SK: "missing" },
    ]);
    expect(found).toEqual([{ PK: "P", SK: "a" }]);
  });

  it("deletes by key", async () => {
    const store = new LocalStore(null);
    await store.putAll([{ PK: "P", SK: "a" }, { PK: "P", SK: "b" }]);
    await store.deleteAll([{ PK: "P", SK: "a" }]);
    expect((await store.query("P", "")).map((item) => item.SK)).toEqual(["b"]);
  });
});

describe("conditions", () => {
  it("rejects a put whose not-exists condition fails, leaving the item alone", async () => {
    const store = new LocalStore(null);
    await store.put({ ...key, owner: "first" });

    await expect(store.put({ ...key, owner: "second" }, { exists: false })).rejects.toBeInstanceOf(
      ConditionFailedError,
    );
    expect((await store.get(key))?.owner).toBe("first");
  });

  it("applies an equality-guarded transition exactly once", async () => {
    // The Quiz_Pool generation guard: two callers race pending → generating.
    const store = new LocalStore(null);
    await store.put({ ...key, poolStatus: "pending" });

    const results = await Promise.allSettled([
      store.update(key, { set: { poolStatus: "generating" } }, { equals: { poolStatus: "pending" } }),
      store.update(key, { set: { poolStatus: "generating" } }, { equals: { poolStatus: "pending" } }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("fails an equality condition on an absent item", () => {
    expect(conditionHolds(null, { equals: { attempts: 0 } })).toBe(false);
  });

  it("holds a not-contains condition over an absent attribute", () => {
    expect(conditionHolds({ PK: "P", SK: "S" }, { notContains: { answeredItemIds: "q1" } })).toBe(true);
    expect(
      conditionHolds({ PK: "P", SK: "S", answeredItemIds: ["q1"] }, { notContains: { answeredItemIds: "q1" } }),
    ).toBe(false);
  });

  it("refuses an exists-guarded update of a missing item instead of creating it", async () => {
    const store = new LocalStore(null);
    await expect(store.update(key, { set: { a: 1 } }, { exists: true })).rejects.toBeInstanceOf(
      ConditionFailedError,
    );
    expect(await store.get(key)).toBeNull();
  });
});

describe("updates", () => {
  it("creates the item when unconditional, as UpdateItem does", async () => {
    const store = new LocalStore(null);
    await store.update(key, { set: { stage: "Extracting" } });
    expect(await store.get(key)).toEqual({ ...key, stage: "Extracting" });
  });

  it("increments, appends and adds set members", () => {
    const next = applyUpdate(key, { ...key, attempts: 0, served: ["a"], answered: ["x"] }, {
      increment: { attempts: 1, fresh: 2 },
      appendToList: { served: ["b"], other: ["z"] },
      addToSet: { answered: ["x", "y"] },
    });

    expect(next).toMatchObject({
      attempts: 1,
      fresh: 2,
      served: ["a", "b"],
      other: ["z"],
      answered: ["x", "y"],
    });
  });
});

describe("transactions", () => {
  it("applies nothing when any condition fails", async () => {
    // The response write: a duplicate answer must neither add a response nor
    // advance the Quiz_Session.
    const store = new LocalStore(null);
    const session = { PK: "S", SK: "QS#1" };
    const response = { PK: "S", SK: "RESP#1#001" };
    await store.put({ ...session, answered: ["q1"], difficulty: 2 });

    await expect(
      store.transact([
        {
          kind: "update",
          key: session,
          update: { set: { difficulty: 3 }, addToSet: { answered: ["q1"] } },
          condition: { exists: true, notContains: { answered: "q1" } },
        },
        { kind: "put", item: response, condition: { exists: false } },
      ]),
    ).rejects.toBeInstanceOf(ConditionFailedError);

    expect((await store.get(session))?.difficulty).toBe(2);
    expect(await store.get(response)).toBeNull();
  });

  it("applies every write when all conditions hold", async () => {
    const store = new LocalStore(null);
    await store.transact([
      { kind: "put", item: { PK: "S", SK: "META", name: "x" } },
      { kind: "put", item: { PK: "JOIN#ABC", SK: "JOIN" }, condition: { exists: false } },
    ]);
    expect(await store.get({ PK: "JOIN#ABC", SK: "JOIN" })).not.toBeNull();
  });
});

describe("persistence", () => {
  it("survives a restart", async () => {
    const { store, file } = fileStore();
    await store.put({ ...key, name: "Persisted" });

    const reopened = new LocalStore(file);
    expect((await reopened.get(key))?.name).toBe("Persisted");
  });

  it("sees writes made by another process", async () => {
    const { store, file } = fileStore();
    await store.put({ ...key, name: "before" });

    // A second instance stands in for `npm run seed` running alongside the server.
    const other = new LocalStore(file);
    await other.put({ ...key, name: "after" });

    expect((await store.get(key))?.name).toBe("after");
  });

  it("reads a deleted file as an empty table — the reset path", async () => {
    const { store, file } = fileStore();
    await store.put({ ...key, name: "gone soon" });

    unlinkSync(file);

    expect(await store.get(key)).toBeNull();
    // And it can be written again afterwards.
    await store.put({ ...key, name: "fresh" });
    expect((await new LocalStore(file).get(key))?.name).toBe("fresh");
  });

  it("explains how to recover from a corrupt file", async () => {
    const { store, file } = fileStore();
    await store.put({ ...key });
    writeFileSync(file, "{ not json");

    await expect(store.get(key)).rejects.toThrow(/demo:reset/);
  });
});
