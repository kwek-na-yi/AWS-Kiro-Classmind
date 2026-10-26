import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The ClassMind demo, driven through a real browser against a production build
 * in local mode — no AWS, no API keys, a data directory that did not exist when
 * the server started.
 *
 * Tests run in order and share state, as a visitor's session would: join, set a
 * profile, read the recap, take the quiz, see the class, contribute to a study
 * thread, upload a lecture, reset.
 */

test.describe.configure({ mode: "serial" });

/** Set when the suite runs against a deployment rather than a local build. */
const REMOTE = Boolean(process.env.E2E_BASE_URL);

/**
 * Returns the demo to its seeded state: the reset script locally, the protected
 * reset endpoint on a deployment.
 */
async function resetDemo(request: APIRequestContext): Promise<void> {
  if (REMOTE) {
    const token = process.env.E2E_RESET_TOKEN;
    if (!token) throw new Error("E2E_RESET_TOKEN is required to reset a deployed demo");
    const response = await request.post("/api/admin/reset-demo", {
      headers: { authorization: `Bearer ${token}` },
      timeout: 120_000,
    });
    expect(response.status(), await response.text()).toBe(200);
    return;
  }

  execFileSync(process.execPath, [
    path.join("node_modules", "tsx", "dist", "cli.mjs"),
    "--conditions=react-server",
    "scripts/demo-reset.ts",
  ], {
    env: { ...process.env, CLASSMIND_TARGET: "local", CLASSMIND_DATA_DIR: process.env.E2E_DATA_DIR },
    stdio: "pipe",
  });
}

/** Errors the browser reports that are not expected states of the app. */
const unexpected: string[] = [];

/** Responses the app deliberately produces and renders as a state. */
function isExpectedFailure(url: string, status: number): boolean {
  // The recap before a profile is chosen (400 PROFILE_REQUIRED), validation
  // failures this suite provokes on purpose, and the stale-learner 403 that
  // the client heals by rejoining after a reset.
  return (
    (status === 400 && /\/api\/sessions\/(join|[^/]+\/(recap|threads\/[^/]+\/explanations|material))$/.test(url)) ||
    (status === 404 && url.endsWith("/api/sessions/join")) ||
    (status === 403 && /\/api\/sessions\//.test(url)) ||
    // An empty class: no quiz pool and no material to recap, both rendered as states.
    (status === 409 && /\/api\/sessions\/[^/]+\/(quiz-sessions|recap)$/.test(url))
  );
}

function watch(page: Page): void {
  page.on("pageerror", (error) => unexpected.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    const status = response.status();
    if (status >= 400 && !isExpectedFailure(response.url(), status)) {
      unexpected.push(`${status} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on("console", (message) => {
    // Failed-resource console lines duplicate the responses checked above.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      unexpected.push(`console: ${message.text()}`);
    }
  });
}

let page: Page;

test.beforeAll(async ({ browser, request }) => {
  // A deployment is shared, so start from a known state rather than whatever
  // earlier visitors left behind. A local run starts from an empty directory.
  if (REMOTE) await resetDemo(request);
  page = await browser.newPage();
  watch(page);
});

test.afterAll(async () => {
  await page.close();
});

test.afterEach(() => {
  expect(unexpected, "unexpected browser errors or failed requests").toEqual([]);
});

const nav = () => page.getByRole("navigation", { name: "ClassMind sections" });

async function joinAs(code: string, name: string) {
  await page.goto("/");
  await page.getByLabel("Class code").fill(code);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Start learning" }).click();
}

test("the home page refuses an unknown class code and a missing name", async () => {
  await joinAs("NOPE00", "Recruiter");
  await expect(page.getByRole("alert").filter({ hasText: "not recognised" })).toBeVisible();

  await joinAs("CM2026", "");
  await expect(page.getByRole("alert").filter({ hasText: /name/i })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("joining the demo class opens the lecture with its five topics", async () => {
  await joinAs("CM2026", "Recruiter");
  await expect(page).toHaveURL(/\/class\/demo\/lecture$/);

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Relational Databases — Week 4");
  for (const topic of ["Normalisation", "Second Normal Form", "Third Normal Form", "Indexing", "Denormalisation"]) {
    await expect(main.getByText(topic, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("navigation", { name: "ClassMind sections" })).toContainText("Recruiter");
});

test("the recap asks for a profile first", async () => {
  await nav().getByRole("link", { name: "Recap", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tell us how you learn first" })).toBeVisible();
  await page.getByRole("link", { name: "Set up my recap" }).click();
  await expect(page).toHaveURL(/lecture$/);
});

test("choosing a profile produces a recap that matches it", async () => {
  const create = page.getByRole("button", { name: "Create My Recap" });
  await expect(create).toBeDisabled();

  await page.getByRole("radio", { name: /New to it/ }).check();
  await page.getByRole("radio", { name: /Step-by-step/ }).check();
  await create.click();

  await expect(page).toHaveURL(/\/class\/demo\/recap$/);
  // The recap says which profile it was written for — the one just chosen.
  await expect(page.getByText("Written for no understanding · step by step")).toBeVisible();
  await expect(page.getByRole("heading", { name: "The ideas in this lecture" })).toBeVisible();
  for (const topic of ["Normalisation", "Second Normal Form", "Third Normal Form", "Indexing", "Denormalisation"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${topic} `) })).toBeVisible();
  }

  // The recap survives a reload: the profile is stored server-side.
  const before = await page.getByRole("main").innerText();
  await page.reload();
  await expect(page.getByText("Written for no understanding · step by step")).toBeVisible();
  expect(await page.getByRole("main").innerText()).toBe(before);

  // Changing the profile changes the recap.
  await page.getByRole("link", { name: "Change how this reads" }).click();
  await page.getByRole("radio", { name: /Confident/ }).check();
  await page.getByRole("radio", { name: /Concise/ }).check();
  await page.getByRole("button", { name: "Create My Recap" }).click();
  await expect(page.getByText(/Written for strong understanding · concise/i)).toBeVisible();
  expect(await page.getByRole("main").innerText()).not.toBe(before);
});

test("the adaptive quiz scores each answer and ends with a report", async () => {
  await nav().getByRole("link", { name: "Check", exact: true }).click();

  const outcomes: boolean[] = [];
  const levels: string[] = [];

  for (let index = 1; index <= 6; index += 1) {
    await expect(page.getByText(`Question ${index} of 6`, { exact: true })).toBeVisible();
    levels.push(
      (await page.getByText(/^(Foundational|Intermediate|Advanced)$/).first().innerText()).trim(),
    );

    const submit = page.getByRole("button", { name: "Submit answer" });
    await expect(submit).toBeDisabled();
    await page.getByRole("radio").first().check();
    await submit.click();

    const verdict = page.getByText(/^(Correct|Not quite)/).first();
    await expect(verdict).toBeVisible();
    outcomes.push((await verdict.innerText()).startsWith("Correct"));

    const onward = page.getByRole("button", { name: index < 6 ? "Next question" : "See what I understand" });
    await onward.click();
  }

  await expect(page.getByText("Your understanding").first()).toBeVisible();
  await expect(page.getByText("Topic by topic")).toBeVisible();
  // The quiz opens at the intermediate level, and moves only after a run of two.
  expect(levels[0]).toBe("Intermediate");
  expect(levels[1]).toBe("Intermediate");
  if (outcomes[0] === outcomes[1]) {
    expect(levels[2]).toBe(outcomes[0] ? "Advanced" : "Foundational");
  }
});

test("class insight now counts this learner among seven", async () => {
  await page.getByRole("link", { name: "See how your class is doing" }).click();
  await expect(page).toHaveURL(/insight$/);
  await expect(page.getByText(/Aggregated across 7 learners/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Class understanding by topic" })).toBeVisible();
  await expect(page.getByText("Common misconception").first()).toBeVisible();
  // Anonymous: no seeded learner name appears anywhere on the page.
  await expect(page.getByRole("main")).not.toContainText(/Avery|Blake|Casey|Devon|Emery|Finley/);
});

test("a study thread accepts an explanation and checks it against the material", async () => {
  await page.getByRole("link", { name: /^Normalisation \d+%/ }).click();
  await expect(page).toHaveURL(/insight\/normalisation$/);
  await expect(page.getByText("Explanation from a classmate").first()).toBeVisible();

  const box = page.getByLabel("Your explanation");
  const submit = page.getByRole("button", { name: "Submit explanation" });

  await box.fill("Too short");
  await expect(page.getByText("11 more characters needed")).toBeVisible();

  await box.fill(
    "A table is in first normal form when every column holds a single atomic value and each row is uniquely identifiable by its key.",
  );
  await submit.click();
  await expect(page.getByText(/Verified against the material|Checked against the material/).first()).toBeVisible();
});

test("uploading a lecture into the upload class builds a new class from it", async () => {
  await joinAs("UPLOAD", "Uploader");
  await expect(page).toHaveURL(/\/class\/upload\/lecture$/);

  const file = path.join(process.cwd(), "tests", "fixtures", "lecture-sample.md");
  await page.locator('input[type="file"]').setInputFiles(file);

  await expect(page.getByText("lecture-sample.md").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "What this lecture covers" })).toBeVisible();

  // An unsupported file is refused with a message rather than silently ignored.
  await page.locator('input[type="file"]').setInputFiles({
    name: "slides.pptx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a lecture"),
  });
  await expect(page.getByText(/PDF, TXT or Markdown|not supported|\.pptx/i).first()).toBeVisible();
});

test("resetting the demo restores the seeded class and heals a stale browser", async ({ request }) => {
  await resetDemo(request);

  // This browser's learner id was deleted by the reset. The page rejoins on the
  // stored class code instead of showing an error, and the class is back to
  // its six synthetic learners.
  await page.goto("/class/demo/insight");
  await expect(page.getByText(/Aggregated across 6 learners/)).toBeVisible();

  // The upload class is empty again.
  await joinAs("UPLOAD", "Uploader");
  await expect(page.getByRole("heading", { name: "No lecture material yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No topics yet" })).toBeVisible();
});

test("an empty class explains itself instead of failing", async () => {
  // Still in the empty upload class from the previous step.
  await page.getByRole("radio", { name: /Basic understanding/ }).check();
  await page.getByRole("radio", { name: /Examples/ }).check();
  await page.getByRole("button", { name: "Create My Recap" }).click();
  await expect(page).toHaveURL(/\/class\/upload\/recap$/);
  await expect(page.getByRole("heading", { name: "No lecture material yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload lecture material" })).toBeVisible();

  await nav().getByRole("link", { name: "Check", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No questions for this class yet" })).toBeVisible();

  await nav().getByRole("link", { name: "Class Insight", exact: true }).click();
  await expect(page.getByText("Aggregated across 0 learners.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not enough responses yet" })).toBeVisible();
});
