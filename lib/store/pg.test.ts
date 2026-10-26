import { describe, expect, it } from "vitest";

import { withExplicitTls } from "@/lib/store/pg";

/** Placeholder credentials only; no real connection string appears in tests. */
const BASE = "postgresql://user:pass@ep-example.ap-southeast-1.aws.neon.tech/db";

describe("TLS mode in the connection string", () => {
  it("states full verification where pg already applies it", () => {
    for (const mode of ["require", "prefer", "verify-ca"]) {
      const url = new URL(withExplicitTls(`${BASE}?sslmode=${mode}&channel_binding=require`));
      expect(url.searchParams.get("sslmode")).toBe("verify-full");
      expect(url.searchParams.get("channel_binding")).toBe("require");
    }
  });

  it("never changes a mode it does not upgrade", () => {
    expect(withExplicitTls(`${BASE}?sslmode=verify-full`)).toBe(`${BASE}?sslmode=verify-full`);
    expect(withExplicitTls(`${BASE}?sslmode=disable`)).toBe(`${BASE}?sslmode=disable`);
    expect(withExplicitTls(BASE)).toBe(BASE);
  });

  it("leaves an unparseable string to pg to report", () => {
    expect(withExplicitTls("not a url")).toBe("not a url");
  });
});
