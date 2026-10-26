import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The protections the hosted public demo relies on. Each is checked both ways:
 * active when its switch is on, inert when off, so local development is never
 * obstructed by a production control.
 */

const seed = vi.hoisted(() => ({
  resetDemo: vi.fn(async () => ({
    topics: 5,
    units: 5,
    poolItems: 15,
    classActivity: { learners: 6, responses: 30, written: 30, explanations: 3, weakestTopicName: "x" },
    instructorToken: "never-returned",
  })),
}));
vi.mock("@/lib/demo/seed", () => seed);

const ENV = ["NEXT_PUBLIC_CLASSMIND_PUBLIC_DEMO", "VERCEL", "CRON_SECRET", "CLASSMIND_TARGET"] as const;
const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

beforeEach(() => {
  for (const name of ENV) delete process.env[name];
  vi.clearAllMocks();
});

afterEach(async () => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  (await import("@/lib/http/rate-limit")).resetMemoryRateLimits();
});

function from(ip: string): Request {
  return new Request("http://localhost/x", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
}

describe("rate limiting", () => {
  it("does nothing outside public-demo mode", async () => {
    const { enforceRateLimit } = await import("@/lib/http/rate-limit");
    for (let i = 0; i < 50; i += 1) {
      await enforceRateLimit(from("1.1.1.1"), [{ name: "t", max: 2, windowSeconds: 60 }]);
    }
  });

  it("refuses with 429 once a caller exceeds the limit, per caller", async () => {
    process.env.NEXT_PUBLIC_CLASSMIND_PUBLIC_DEMO = "1";
    const { enforceRateLimit } = await import("@/lib/http/rate-limit");
    const limits = [{ name: "t", max: 2, windowSeconds: 60 }];

    await enforceRateLimit(from("1.1.1.1"), limits);
    await enforceRateLimit(from("1.1.1.1"), limits);
    await expect(enforceRateLimit(from("1.1.1.1"), limits)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });

    // Another caller has their own budget.
    await enforceRateLimit(from("2.2.2.2"), limits);
  });

  it("applies a global budget across callers", async () => {
    process.env.NEXT_PUBLIC_CLASSMIND_PUBLIC_DEMO = "1";
    const { enforceRateLimit } = await import("@/lib/http/rate-limit");
    const limits = [{ name: "g", max: 2, windowSeconds: 60, global: true }];

    await enforceRateLimit(from("1.1.1.1"), limits);
    await enforceRateLimit(from("2.2.2.2"), limits);
    await expect(enforceRateLimit(from("3.3.3.3"), limits)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("identifies the caller by the first forwarded address", async () => {
    const { clientAddress } = await import("@/lib/http/rate-limit");
    expect(clientAddress(from("203.0.113.9"))).toBe("203.0.113.9");
    expect(
      clientAddress(new Request("http://x", { headers: { "x-real-ip": "198.51.100.2" } })),
    ).toBe("198.51.100.2");
  });
});

describe("hosting guards", () => {
  it("caps uploads at 4 MB on a serverless host and 20 MB elsewhere", async () => {
    const { uploadLimitBytes } = await import("@/lib/ingest/limits");
    expect(uploadLimitBytes()).toBe(20 * 1024 * 1024);
    process.env.VERCEL = "1";
    expect(uploadLimitBytes()).toBe(4 * 1024 * 1024);
  });

  it("refuses the local file store on a serverless host instead of losing data", async () => {
    process.env.VERCEL = "1";
    const { store } = await import("@/lib/store");
    await expect(store()).rejects.toThrow(/CLASSMIND_TARGET=postgres/);
  });
});

describe("the demo reset endpoint", () => {
  async function call(authorization?: string) {
    const { GET } = await import("@/app/api/admin/reset-demo/route");
    return GET(
      new Request("http://localhost/api/admin/reset-demo", {
        headers: authorization ? { authorization } : {},
      }),
    );
  }

  it("does not exist when no secret is configured", async () => {
    expect((await call("Bearer anything")).status).toBe(404);
    expect(seed.resetDemo).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong secret", async () => {
    process.env.CRON_SECRET = "correct-horse";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call("correct-horse")).status).toBe(401);
    expect(seed.resetDemo).not.toHaveBeenCalled();
  });

  it("clears rate-limit counters, so a reset leaves the demo fully usable", async () => {
    process.env.CRON_SECRET = "correct-horse";
    process.env.NEXT_PUBLIC_CLASSMIND_PUBLIC_DEMO = "1";
    const { enforceRateLimit } = await import("@/lib/http/rate-limit");
    const limits = [{ name: "r", max: 1, windowSeconds: 60 }];

    await enforceRateLimit(from("9.9.9.9"), limits);
    await expect(enforceRateLimit(from("9.9.9.9"), limits)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });

    expect((await call("Bearer correct-horse")).status).toBe(200);
    await enforceRateLimit(from("9.9.9.9"), limits);
  });

  it("resets with the right secret and never returns the instructor token", async () => {
    process.env.CRON_SECRET = "correct-horse";
    const response = await call("Bearer correct-horse");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reset).toBe(true);
    expect(seed.resetDemo).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain("never-returned");
  });
});
