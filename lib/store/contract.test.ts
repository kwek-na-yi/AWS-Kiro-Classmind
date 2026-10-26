import { describe, expect, it, vi } from "vitest";

import { pgliteDatabase } from "@/tests/support/pglite";
import { LocalStore } from "@/lib/store/local";
import { PostgresStore } from "@/lib/store/postgres";
import { ConditionFailedError, type Store } from "@/lib/store/types";

/**
 * The storage contract, run against every backend that can run in a test.
 *
 * The repositories' idempotency — a double-clicked answer counted once, a quiz
 * pool generated once, a peer explanation assessed once — rests on these
 * semantics, so the hosted PostgreSQL backend must give exactly the same
 * answers as the local store. PostgreSQL runs here for real, via PGlite.
 */

// Each PostgreSQL case boots a fresh PGlite (PostgreSQL compiled to
// WebAssembly). That takes a few seconds when the whole suite runs in parallel,
// well past the 5-second default, without anything being wrong.
vi.setConfig({ testTimeout: 30_000 });

const backends: [string, () => Promise<Store>][] = [
  ["local store", async () => new LocalStore(null)],
  ["postgres store", async () => new PostgresStore(await pgliteDatabase())],
];

const key = { PK: "CS#s1", SK: "META" };

describe.each(backends)("%s", (_name, make) => {
  it("round-trips an item, dropping undefined attributes", async () => {
    const store = await make();
    await store.put({ ...key, name: "Class", tags: ["a"], gone: undefined, nested: { n: 1 } });

    expect(await store.get(key)).toEqual({ ...key, name: "Class", tags: ["a"], nested: { n: 1 } });
    expect(await store.get({ PK: "CS#s1", SK: "nope" })).toBeNull();
  });

  it("queries one partition by prefix in byte order, and counts", async () => {
    const store = await make();
    await store.putAll([
      { PK: "CS#s1", SK: "TOPIC#v1#002" },
      { PK: "CS#s1", SK: "TOPIC#v1#000" },
      { PK: "CS#s1", SK: "TOPIC#v1#a" },
      { PK: "CS#s1", SK: "TOPIC#v1#B" },
      { PK: "CS#s1", SK: "UNIT#v1#000" },
      { PK: "CS#s2", SK: "TOPIC#v1#001" },
      // LIKE wildcards in a key are literal characters, not patterns.
      { PK: "CS#s1", SK: "X%_#1" },
    ]);

    const topics = await store.query("CS#s1", "TOPIC#");
    // Uppercase sorts before lowercase in byte order, as DynamoDB sorts.
    expect(topics.map((item) => item.SK)).toEqual([
      "TOPIC#v1#000",
      "TOPIC#v1#002",
      "TOPIC#v1#B",
      "TOPIC#v1#a",
    ]);
    expect(await store.count("CS#s1", "TOPIC#")).toBe(4);
    expect(await store.query("CS#s1", "X%_")).toHaveLength(1);
    expect(await store.query("CS#s1", "X_")).toHaveLength(0);
    expect(await store.query("CS#s1", "")).toHaveLength(6);
  });

  it("batch-gets only existing items and deletes by key", async () => {
    const store = await make();
    await store.putAll([
      { PK: "P", SK: "a", v: 1 },
      { PK: "P", SK: "b", v: 2 },
    ]);

    const found = await store.batchGet([
      { PK: "P", SK: "a" },
      { PK: "P", SK: "missing" },
    ]);
    expect(found).toEqual([{ PK: "P", SK: "a", v: 1 }]);

    await store.deleteAll([{ PK: "P", SK: "a" }]);
    expect((await store.query("P", "")).map((item) => item.SK)).toEqual(["b"]);
  });

  it("keeps the last write when a batch names a key twice", async () => {
    const store = await make();
    await store.putAll([
      { PK: "P", SK: "a", v: 1 },
      { PK: "P", SK: "a", v: 2 },
    ]);
    expect((await store.get({ PK: "P", SK: "a" }))?.v).toBe(2);
  });

  it("rejects a not-exists put on an existing key, leaving it unchanged", async () => {
    const store = await make();
    await store.put({ ...key, owner: "first" });

    await expect(store.put({ ...key, owner: "second" }, { exists: false })).rejects.toBeInstanceOf(
      ConditionFailedError,
    );
    expect((await store.get(key))?.owner).toBe("first");
  });

  it("applies an equality-guarded transition exactly once under concurrency", async () => {
    const store = await make();
    await store.put({ ...key, poolStatus: "pending" });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        store.update(key, { set: { poolStatus: "generating" } }, { equals: { poolStatus: "pending" } }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("claims a counter exactly once under concurrency", async () => {
    const store = await make();
    await store.put({ ...key, attempts: 0 });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        store.update(key, { increment: { attempts: 1 } }, { exists: true, equals: { attempts: 0 } }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await store.get(key))?.attempts).toBe(1);
  });

  it("refuses an exists-guarded update of a missing item instead of creating it", async () => {
    const store = await make();
    await expect(store.update(key, { set: { a: 1 } }, { exists: true })).rejects.toBeInstanceOf(
      ConditionFailedError,
    );
    expect(await store.get(key)).toBeNull();
  });

  it("creates on an unconditional update, and appends, increments and adds", async () => {
    const store = await make();
    await store.update(key, { set: { stage: "Extracting" } });
    await store.update(key, {
      increment: { attempts: 2 },
      appendToList: { served: ["q1"] },
      addToSet: { answered: ["q1"] },
    });
    await store.update(key, { appendToList: { served: ["q2"] }, addToSet: { answered: ["q1", "q2"] } });

    expect(await store.get(key)).toEqual({
      ...key,
      stage: "Extracting",
      attempts: 2,
      served: ["q1", "q2"],
      answered: ["q1", "q2"],
    });
  });

  it("applies nothing from a transaction whose condition fails", async () => {
    const store = await make();
    const session = { PK: "S", SK: "QS#1" };
    const response = { PK: "S", SK: "RESP#1#01" };
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

  it("records concurrent duplicate answers exactly once", async () => {
    // The response route's write, raced: only one transaction may win.
    const store = await make();
    const session = { PK: "S", SK: "QS#1" };
    await store.put({ ...session, difficulty: 2 });

    const attempt = () =>
      store.transact([
        {
          kind: "update",
          key: session,
          update: { set: { difficulty: 3 }, addToSet: { answered: ["q1"] } },
          condition: { exists: true, notContains: { answered: "q1" } },
        },
        { kind: "put", item: { PK: "S", SK: "RESP#1#01", optionId: "a" }, condition: { exists: false } },
      ]);

    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await store.query("S", "RESP#")).toHaveLength(1);
  });

  it("applies every write of a transaction whose conditions hold", async () => {
    const store = await make();
    await store.transact([
      { kind: "put", item: { PK: "S", SK: "META", name: "x" } },
      { kind: "put", item: { PK: "JOIN#ABC", SK: "JOIN" }, condition: { exists: false } },
    ]);
    expect(await store.get({ PK: "JOIN#ABC", SK: "JOIN" })).not.toBeNull();
    expect((await store.get({ PK: "S", SK: "META" }))?.name).toBe("x");
  });
});

describe("postgres-only capabilities", () => {
  it("stores, reads and deletes lecture files by prefix", async () => {
    const store = new PostgresStore(await pgliteDatabase());
    const bytes = new TextEncoder().encode("# Lecture\n\nBody");

    await store.putFile("sessions/a/material/v1/x.md", bytes, "text/markdown");
    await store.putFile("sessions/a/material/v2/y.md", bytes);
    await store.putFile("sessions/ab/material/v1/z.md", bytes);

    expect(Array.from((await store.getFile("sessions/a/material/v1/x.md")) ?? [])).toEqual(
      Array.from(bytes),
    );
    expect(await store.getFile("sessions/a/nope")).toBeNull();

    // The trailing slash keeps `sessions/a/` from matching `sessions/ab/`.
    expect(await store.deleteFiles("sessions/a/")).toBe(2);
    expect(await store.getFile("sessions/ab/material/v1/z.md")).not.toBeNull();
  });

  it("counts rate-limit hits per window", async () => {
    const store = new PostgresStore(await pgliteDatabase());
    expect(await store.hit("join:ip1", 60)).toBe(1);
    expect(await store.hit("join:ip1", 60)).toBe(2);
    expect(await store.hit("join:ip2", 60)).toBe(1);

    // A window that has already expired starts again at one.
    expect(await store.hit("join:ip3", 0)).toBe(1);
    expect(await store.hit("join:ip3", 0)).toBe(1);
    await store.pruneRateLimits();
    expect(await store.hit("join:ip1", 60)).toBe(3);

    await store.clearRateLimits();
    expect(await store.hit("join:ip1", 60)).toBe(1);
  });

  it("creates its schema idempotently", async () => {
    const db = await pgliteDatabase();
    await new PostgresStore(db).ensureSchema();
    await new PostgresStore(db).ensureSchema();
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name LIKE 'classmind_%'",
    );
    expect(rows[0].n).toBe(3);
  });
});
