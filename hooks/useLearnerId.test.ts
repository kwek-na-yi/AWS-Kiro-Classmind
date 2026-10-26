import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The recovery path for a Learner_Id the server no longer knows.
 *
 * Reseeding the demo class deletes its Learners while the Class_Session keeps
 * its id, so a browser can be left holding an identity that is a member of
 * nothing. These tests pin the behaviour that keeps that out of the interface:
 * the request rejoins on the stored Join_Code and is sent again.
 */

const SESSION = "sess-1";

function fakeStorage() {
  const values = new Map<string, string>();

  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

let storage: ReturnType<typeof fakeStorage>;
let replace: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

/** A fresh copy of the module, so its in-flight recovery map starts empty. */
async function load() {
  vi.resetModules();
  return import("@/hooks/useLearnerId");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function notInSession(): Response {
  return json(
    { error: { code: "LEARNER_NOT_IN_SESSION", message: "Not a member." } },
    403,
  );
}

function headerOf(call: unknown[]): string | undefined {
  const init = call[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string> | undefined)?.["x-learner-id"];
}

beforeEach(() => {
  storage = fakeStorage();
  replace = vi.fn();
  fetchMock = vi.fn();

  vi.stubGlobal("window", {
    localStorage: storage,
    location: { replace },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("learnerFetch", () => {
  it("sends the Learner_Id and returns the response untouched", async () => {
    const { learnerFetch } = await load();
    fetchMock.mockResolvedValue(json({ ok: true }));

    const response = await learnerFetch(SESSION, "learner-1", "/api/thing");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(headerOf(fetchMock.mock.calls[0])).toBe("learner-1");
  });

  it("rejoins on the stored Join_Code and retries with the new Learner_Id", async () => {
    const { learnerFetch, writeDisplayName, writeJoinCode, writeLearnerId, readLearnerId } =
      await load();

    writeLearnerId(SESSION, "dead");
    writeDisplayName(SESSION, "Avery");
    writeJoinCode(SESSION, "DEMO24");

    fetchMock
      .mockResolvedValueOnce(notInSession())
      .mockResolvedValueOnce(json({ sessionId: SESSION, learnerId: "live", displayName: "Avery" }))
      .mockResolvedValueOnce(json({ ok: true }));

    const response = await learnerFetch(SESSION, "dead", "/api/thing");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // The join went out on the stored code, and the retry carried the id it
    // returned — which is now the stored one.
    expect(fetchMock.mock.calls[1][0]).toBe("/api/sessions/join");
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({
      joinCode: "DEMO24",
      displayName: "Avery",
    });
    expect(headerOf(fetchMock.mock.calls[2])).toBe("live");
    expect(readLearnerId(SESSION)).toBe("live");
  });

  it("registers one Learner when several requests fail together", async () => {
    const { learnerFetch, writeDisplayName, writeJoinCode } = await load();

    writeDisplayName(SESSION, "Avery");
    writeJoinCode(SESSION, "DEMO24");

    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/api/sessions/join"
          ? json({ sessionId: SESSION, learnerId: "live", displayName: "Avery" })
          : notInSession(),
      ),
    );

    // The retries fail the same way here, which does not matter: what is under
    // test is that three concurrent failures share one join.
    await Promise.all([
      learnerFetch(SESSION, "dead", "/api/a"),
      learnerFetch(SESSION, "dead", "/api/b"),
      learnerFetch(SESSION, "dead", "/api/c"),
    ]);

    const joins = fetchMock.mock.calls.filter((call) => call[0] === "/api/sessions/join");
    expect(joins).toHaveLength(1);
  });

  it("ignores a rejoin whose code now resolves to another Class_Session", async () => {
    const { learnerFetch, writeDisplayName, writeJoinCode, readLearnerId, writeLearnerId } =
      await load();

    writeLearnerId(SESSION, "dead");
    writeDisplayName(SESSION, "Avery");
    writeJoinCode(SESSION, "DEMO24");

    fetchMock
      .mockResolvedValueOnce(notInSession())
      .mockResolvedValueOnce(
        json({ sessionId: "another-session", learnerId: "live", displayName: "Avery" }),
      );

    void learnerFetch(SESSION, "dead", "/api/thing");
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/"));

    expect(readLearnerId(SESSION)).toBeNull();
  });

  it("drops the dead id and returns to the join page when there is nothing to rejoin with", async () => {
    const { learnerFetch, writeLearnerId, readLearnerId } = await load();

    writeLearnerId(SESSION, "dead");
    fetchMock.mockResolvedValue(notInSession());

    // The promise is deliberately left unsettled while the browser navigates, so
    // the assertion waits on the effects rather than on the call.
    void learnerFetch(SESSION, "dead", "/api/thing");

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(readLearnerId(SESSION)).toBeNull();
  });

  it("passes a 403 raised for any other reason straight through", async () => {
    const { learnerFetch } = await load();

    fetchMock.mockResolvedValue(
      json({ error: { code: "NOT_YOUR_REPORT", message: "Another learner's." } }, 403),
    );

    const response = await learnerFetch(SESSION, "learner-1", "/api/thing");

    expect(response.status).toBe(403);
    // The body is still unread, because the code was checked on a clone.
    expect(await response.json()).toEqual({
      error: { code: "NOT_YOUR_REPORT", message: "Another learner's." },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });
});
