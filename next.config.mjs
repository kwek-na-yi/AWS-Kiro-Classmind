/**
 * Next.js configuration for ClassMind.
 *
 * Route Handlers under `app/api/` run on the Node runtime, which is already the
 * App Router default and so needs no configuration here — see
 * `docs/api.md` for the convention and the reason behind it.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  /**
   * Emit `.next/standalone`: the traced server plus only the `node_modules`
   * files the traced code actually reaches.
   *
   * This is what makes the container image reasonable. The alternative is
   * shipping the whole dependency tree and running `next start`, which drags in
   * every build-time package — TypeScript, ESLint, Vitest, the full AWS SDK
   * surface — none of which a running server needs.
   *
   * Only the container build sets CLASSMIND_STANDALONE=1 (see the Dockerfile).
   * Locally `npm run build && npm start` uses the normal output, because
   * `next start` does not support standalone output.
   *
   * Two consequences the Dockerfile has to honour: the standalone server is
   * `server.js` rather than `next start`, and it does not copy `.next/static`
   * itself, so that directory is copied in alongside it.
   */
  output: process.env.CLASSMIND_STANDALONE === "1" ? "standalone" : undefined,

  /**
   * The synthetic demo lecture is read from disk when the demo class is built
   * on first run. It is data rather than an import, so the tracer cannot see
   * it; listing it here keeps it in the standalone output.
   */
  outputFileTracingIncludes: {
    "/**": ["./lib/demo/demo-lecture.md"],
  },

  poweredByHeader: false,

  /**
   * Baseline security headers for every response. The app embeds nothing from
   * other origins and is never meant to be framed. A full script CSP is not set:
   * Next.js inlines its bootstrap scripts, and a nonce-based policy is more
   * machinery than this demo needs — `frame-ancestors` is the part that matters.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
