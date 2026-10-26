import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end tests for the local demo.
 *
 * The suite builds the app and serves the production build on port 3200 with a
 * fresh data directory for every run, so it starts from exactly the state a new
 * clone sees: no data file, demo classes created on first use, no AWS and no
 * environment variables. It never touches your own `.classmind/` data.
 *
 *   npm run test:e2e
 *
 * Set E2E_SKIP_BUILD=1 to reuse an existing `.next` build.
 *
 * To test a deployment instead, set E2E_BASE_URL (and E2E_RESET_TOKEN, the
 * deployment's CRON_SECRET, so the suite can reset the demo through
 * /api/admin/reset-demo). No local server is started in that case.
 */

const PORT = 3200;
const REMOTE = process.env.E2E_BASE_URL?.replace(/\/$/, "");

// Resolved once in the main process; workers inherit it through the environment.
process.env.E2E_DATA_DIR ??= path.join(".classmind", `e2e-${Date.now()}`);

export default defineConfig({
  testDir: "./e2e",
  // The journey shares one server and builds on earlier steps.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: REMOTE ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: REMOTE ? undefined : {
    command: process.env.E2E_SKIP_BUILD
      ? `npx next start -p ${PORT}`
      : `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      CLASSMIND_DATA_DIR: process.env.E2E_DATA_DIR,
      // Explicitly local, whatever a developer's .env.local says.
      CLASSMIND_TARGET: "local",
    },
  },
});
