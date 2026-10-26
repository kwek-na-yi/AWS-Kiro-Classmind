# Testing

| Command | What it runs |
| --- | --- |
| `npm run lint` | ESLint (Next.js core-web-vitals and TypeScript rules) |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Vitest: unit, property-based, route and integration tests |
| `npm run test:e2e` | Playwright: browser tests against a fresh production build |
| `npm run verify` | HTTP journey check against a running server |

None of them needs a database, Docker, AWS or network access.

## Unit and integration tests (Vitest)

Test files sit next to the code they cover (`*.test.ts`), plus `tests/` for
route and whole-application tests.

- **Domain rules** (`lib/domain/`) — adaptive difficulty, mastery, the class map,
  misconception selection, gating and anonymisation, including property-based
  tests with fast-check.
- **Routes** (`tests/routes/`) — each API route with its repositories mocked:
  validation, authorisation, duplicate and closed-quiz answers, rate limits, the
  read-only demo lecture and the reset endpoint.
- **Storage contract** (`lib/store/contract.test.ts`) — the same semantics
  checks run against the local store and the PostgreSQL store.
- **Whole journey** (`tests/integration/`) — the real route handlers, from
  joining to resetting, against the local store and against PostgreSQL. Every
  number is checked against an independent recomputation from the stored
  responses. The AWS SDK is mocked to throw, proving neither path loads it.

PostgreSQL tests use [PGlite](https://pglite.dev) — PostgreSQL compiled to
WebAssembly, in memory — so they run without a database server. PGlite uses a
single connection; true concurrent-connection behaviour is covered by the
deployed tests below.

## Browser tests (Playwright)

Install the browser once:

```bash
npx playwright install chromium
```

`npm run test:e2e` builds the app, serves it on port 3200 with a fresh, isolated
data directory and runs `e2e/demo-journey.spec.ts`: joining, profiles, recaps,
the adaptive quiz and report, Class Insight, study threads, uploads, reset and
empty states. It fails on unexpected browser errors or failed requests, and
never touches your own `.classmind/` data.

### Against a deployment

```bash
E2E_BASE_URL=https://classmind-app.vercel.app \
E2E_RESET_TOKEN=<CRON_SECRET> \
npm run test:e2e
```

With `E2E_BASE_URL` set, no local server starts, the demo is reset through
`/api/admin/reset-demo` first, and `e2e/deployment.spec.ts` also runs:
security headers, the public-demo notice, reset-endpoint authorisation, the
read-only demo lecture, the upload limit, persistence across independent
requests, simultaneous duplicate submissions, error handling and rate limiting.
It resets the shared demo, so run it deliberately.

## HTTP journey check

`npm run verify` drives the learner journey over HTTP against a running server
(`APP_ORIGIN`, default `http://localhost:3000`) and reads the seeded state back
through the repositories. Start `npm run dev` first.
