import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/http/errors";
import { pipeline, readJson } from "@/lib/http/pipeline";

function request(body?: unknown): Request {
  return new Request("http://localhost/api/sessions/cs_1/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stage sequencing", () => {
  it("runs the named stages in pipeline order, threading each value on", async () => {
    const order: string[] = [];

    const response = await pipeline(request({ n: 1 }))
      .parse(() => {
        order.push("parse");
        return 1;
      })
      .authorise((n) => {
        order.push("authorise");
        return n + 1;
      })
      .validate((n) => {
        order.push("validate");
        return n + 1;
      })
      .read((n) => {
        order.push("read");
        return n + 1;
      })
      .compute((n) => {
        order.push("compute");
        return n + 1;
      })
      .write((n) => {
        order.push("write");
        return n + 1;
      })
      .project((n) => {
        order.push("project");
        return { value: n };
      });

    expect(order).toEqual([
      "parse",
      "authorise",
      "validate",
      "read",
      "compute",
      "write",
      "project",
    ]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ value: 6 });
  });

  it("awaits asynchronous stages", async () => {
    const response = await pipeline(request())
      .read(async () => {
        await Promise.resolve();
        return "loaded";
      })
      .project((value) => ({ value }));

    await expect(response.json()).resolves.toEqual({ value: "loaded" });
  });

  it("passes the request context to every stage", async () => {
    const seen: string[] = [];

    await pipeline(request())
      .parse((_value, ctx) => {
        seen.push(ctx.requestId);
        return null;
      })
      .project((_value, ctx) => {
        seen.push(ctx.requestId);
        return {};
      });

    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toMatch(/[0-9a-f-]{36}/);
  });

  it("projects only what it is given, never the upstream value", async () => {
    const repoObject = { PK: "CS#cs_1", SK: "PROFILE#l_1", learnerId: "l_1" };

    const response = await pipeline(request())
      .read(() => repoObject)
      .project((item) => ({ learnerId: item.learnerId }));

    await expect(response.json()).resolves.toEqual({ learnerId: "l_1" });
  });

  it("honours a status override for created resources", async () => {
    const response = await pipeline(request())
      .write(() => ({ id: "e_1" }))
      .project((value) => value, { status: 201 });

    expect(response.status).toBe(201);
  });
});

describe("error handling", () => {
  it("turns an AppError from any stage into its coded envelope", async () => {
    const response = await pipeline(request())
      .authorise(() => {
        throw new AppError("LEARNER_NOT_IN_SESSION", "Join the class first.");
      })
      .project(() => ({ unreachable: true }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LEARNER_NOT_IN_SESSION",
        message: "Join the class first.",
      },
    });
  });

  it("keeps the offending field on a validation failure", async () => {
    const response = await pipeline(request())
      .validate(() => {
        throw new AppError("INVALID_PROFILE", "Unknown style.", "explanationStyle");
      })
      .project(() => ({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_PROFILE",
        message: "Unknown style.",
        field: "explanationStyle",
      },
    });
  });

  it("converts an unexpected failure to INTERNAL and leaks nothing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await pipeline(request())
      .read(() => {
        throw new Error("ResourceNotFoundException: table classmind not found");
      })
      .project(() => ({}));

    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toContain("classmind");
    expect(body.error.message).not.toContain("ResourceNotFound");

    // The detail reaches the log instead, under the same request id.
    expect(logged).toHaveBeenCalledTimes(1);
    const record = JSON.parse(logged.mock.calls[0][0] as string) as {
      requestId: string;
      errorMessage: string;
    };
    expect(record.errorMessage).toContain("classmind");
    expect(body.error.message).toContain(record.requestId);
  });

  it("does not run later stages once a stage has failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const laterStage = vi.fn(() => ({}));

    await pipeline(request())
      .authorise(() => {
        throw new Error("boom");
      })
      .read(laterStage)
      .project(() => ({}));

    expect(laterStage).not.toHaveBeenCalled();
  });
});

describe("readJson", () => {
  it("returns the parsed object", async () => {
    await expect(readJson(request({ displayName: "Ada" }))).resolves.toEqual({
      displayName: "Ada",
    });
  });

  it("returns an empty object for a missing, malformed or non-object body", async () => {
    await expect(readJson(request())).resolves.toEqual({});
    await expect(readJson(request(["Ada"]))).resolves.toEqual({});
    await expect(readJson(request("Ada"))).resolves.toEqual({});

    const malformed = new Request("http://localhost/api/x", {
      method: "POST",
      body: "{not json",
    });
    await expect(readJson(malformed)).resolves.toEqual({});
  });
});
