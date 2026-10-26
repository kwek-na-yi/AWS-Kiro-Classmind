/**
 * Pre-demo health check.
 *
 * Part A reads the seeded Class_Session back through the real repository
 * functions. Part B drives the whole learner journey over HTTP against a running
 * dev server, exactly as the browser does — join, profile, recap, six quiz
 * answers, report.
 *
 * Usage:  npm run verify        (with `npm run dev` already running)
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { masteryTone } from "@/lib/design/tokens";
import { computeClassMap } from "@/lib/domain/classmap";
import { replay } from "@/lib/domain/difficulty";
import { selectNextItem } from "@/lib/domain/selection";
import { MATERIAL_MAX_BYTES } from "@/lib/domain/validate-input";
import { hashInstructorToken, newInstructorToken } from "@/lib/http/auth";
import { materialExists } from "@/lib/ingest/material-store";
import { listAllExplanations } from "@/lib/repo/explanation";
import { listSourceUnits, listTopics, getMaterial } from "@/lib/repo/material";
import { listQuizItems } from "@/lib/repo/pool";
import { listAllClassResponses } from "@/lib/repo/quiz";
import {
  createSession,
  getSession,
  JoinCodeTakenError,
  listLearners,
  resolveJoinCode,
} from "@/lib/repo/session";
import type { QuizItem } from "@/lib/types";

const JOIN_CODE = "CM2026";
const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";

/**
 * The Class_Session section E uploads into.
 *
 * Fixed rather than random, so repeated verification reuses one session instead
 * of leaving a new one behind on every run — and deliberately not the demo, an
 * upload into which would replace the seeded CM2026 lecture.
 */
const UPLOAD_SESSION_ID = "upload-check";
const UPLOAD_JOIN_CODE = "UPCHK1";

/** Enough prose to clear the readable-text floor, for the rejection cases. */
const TEXT_LECTURE = new TextEncoder().encode(
  "A relational schema stores each fact once. ".repeat(20),
);

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function verifySeededState(): Promise<ClassFacts> {
  console.log("\nA. Seeded state, read through the repository");

  const session = await resolveJoinCode(JOIN_CODE);
  check(`join code ${JOIN_CODE} resolves`, session !== null);
  if (!session) throw new Error("Nothing seeded — run `npm run seed` first.");

  check("session has a material version", session.materialVersion >= 1);

  const [material, topics, pool] = await Promise.all([
    getMaterial(session.sessionId, session.materialVersion),
    listTopics(session.sessionId, session.materialVersion),
    listQuizItems(session.sessionId, session.materialVersion),
  ]);

  check("lecture material exists", material !== null, material?.filename);
  check("material is ready", material?.status === "ready", material?.status);
  check("topics exist (3–8)", topics.length >= 3 && topics.length <= 8, `${topics.length} topics`);
  check("source text was extracted", (material?.charCount ?? 0) >= 200, `${material?.charCount} chars`);
  check("quiz pool is ready", material?.poolStatus === "ready", material?.poolStatus);
  check("pool can fill a session", pool.length >= 6, `${pool.length} items`);

  for (const difficulty of [1, 2, 3] as const) {
    const count = pool.filter((item) => item.difficulty === difficulty).length;
    check(`pool has items at level ${difficulty}`, count > 0, `${count} items`);
  }

  const malformed = pool.filter(
    (item) =>
      item.options.length !== 4 ||
      item.options.filter((option) => option.isCorrect).length !== 1,
  );
  check("every pool item is well-formed", malformed.length === 0);

  // These are guarantees about the *seed*, so they are measured over the seeded
  // Learners alone. Real learners — this script's own on a previous run, or
  // anyone who has taken the quiz since — genuinely move the class map, which is
  // the product working; reading them in here would make a property of the seed
  // depend on how many times the class had been used.
  const seededLearners = (await listLearners(session.sessionId)).filter(
    (learner) => learner.isSeeded,
  );
  const seededIds = new Set(seededLearners.map((learner) => learner.learnerId));

  const allResponses = await listAllClassResponses(session.sessionId);
  const responses = allResponses.filter((response) => seededIds.has(response.learnerId));

  check("seeded learners exist", seededIds.size >= 3, `${seededIds.size} learners`);
  check("seeded responses exist", responses.length > 0, `${responses.length} responses`);

  const map = computeClassMap(
    topics.map((topic) => ({ topicId: topic.topicId, name: topic.name })),
    responses.map((response) => ({
      topicId: response.topicId,
      learnerId: response.learnerId,
      isCorrect: response.isCorrect,
    })),
  );

  const publishedSeed = map.filter((entry) => entry.status === "published");
  check(
    "seeded topics clear the anonymity threshold",
    publishedSeed.length >= 3,
    `${publishedSeed.length} published`,
  );

  const seededBands = new Set(
    publishedSeed.map((entry) =>
      entry.status === "published" ? masteryTone(entry.classMastery).band : "",
    ),
  );
  check(
    "the seeded class spans three mastery bands",
    seededBands.size >= 3,
    [...seededBands].join(", "),
  );

  const explanations = await listAllExplanations(session.sessionId);
  const statuses = new Set(explanations.map((entry) => entry.status));

  check("seeded peer explanations exist", explanations.length >= 2, `${explanations.length} explanations`);
  check("a seeded explanation is validated", statuses.has("Validated"), [...statuses].join(", "));
  check(
    "a seeded explanation is not validated",
    statuses.has("Contradicted") || statuses.has("Unsupported"),
    [...statuses].join(", "),
  );

  return {
    sessionId: session.sessionId,
    pool,
    topicOrder: [...topics]
      .sort((a, b) => a.order - b.order)
      .map((topic) => topic.topicId),
    threadTopicId: explanations[0]?.topicId ?? topics[0]?.topicId ?? "",
  };
}

interface Json {
  [key: string]: unknown;
}

async function call(
  path: string,
  init: RequestInit & { learnerId?: string } = {},
): Promise<{ status: number; body: Json }> {
  const { learnerId, ...rest } = init;

  const response = await fetch(`${ORIGIN}${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(learnerId ? { "x-learner-id": learnerId } : {}),
      ...rest.headers,
    },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

/**
 * Uploads a Lecture_Material exactly as the browser does: one `multipart/form-data`
 * body with a single `file` part, and no content type set by hand — the runtime
 * writes it, boundary and all.
 */
async function upload(
  sessionId: string,
  learnerId: string,
  filename: string,
  bytes: Uint8Array | Buffer,
): Promise<{ status: number; body: Json }> {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], filename));

  const response = await fetch(`${ORIGIN}/api/sessions/${sessionId}/material`, {
    method: "POST",
    headers: { "x-learner-id": learnerId },
    body: form,
  });

  return { status: response.status, body: (await response.json()) as Json };
}

/**
 * What Part A read from the table, so Part B can predict what the server should
 * serve rather than only checking that it served something.
 */
interface ClassFacts {
  sessionId: string;
  pool: QuizItem[];
  /** Topic ids in persisted order — the tie-break selection uses. */
  topicOrder: string[];
  /** The Topic the seeded Study_Thread was written on. */
  threadTopicId: string;
}

/** Runs the whole learner journey and returns the Learner_Id it created. */
async function verifyJourney(facts: ClassFacts): Promise<string> {
  const { sessionId, pool, topicOrder } = facts;
  console.log("\nB. Learner journey over HTTP");

  // --- Join ---------------------------------------------------------------
  const badCode = await call("/api/sessions/join", {
    method: "POST",
    body: JSON.stringify({ joinCode: "ZZ0000", displayName: "Nobody" }),
  });
  check("unknown join code returns 404", badCode.status === 404);

  const join = await call("/api/sessions/join", {
    method: "POST",
    body: JSON.stringify({ joinCode: JOIN_CODE, displayName: "Demo Presenter" }),
  });

  check("join succeeds", join.status === 200, `status ${join.status}`);
  if (join.status !== 200) {
    console.error(`        ${JSON.stringify(join.body)}`);
    throw new Error("join failed — the rest of the journey cannot run");
  }

  const learnerId = join.body.learnerId as string;
  check("join returns a learner id", typeof learnerId === "string" && learnerId.length === 32);
  check("join returns the session id", join.body.sessionId === sessionId);
  check("join returns topics", Array.isArray(join.body.topics) && (join.body.topics as []).length > 0);

  // --- Profile ------------------------------------------------------------
  const badProfile = await call(`/api/sessions/${sessionId}/profile`, {
    method: "PUT",
    learnerId,
    body: JSON.stringify({ understandingLevel: "Nope", explanationStyle: "Concise" }),
  });
  check("invalid profile is rejected", badProfile.status === 400);

  const profile = await call(`/api/sessions/${sessionId}/profile`, {
    method: "PUT",
    learnerId,
    body: JSON.stringify({
      understandingLevel: "Basic_Understanding",
      explanationStyle: "Detailed",
    }),
  });
  check("profile saves", profile.status === 200, `status ${profile.status}`);

  // --- Recap --------------------------------------------------------------
  const first = await call(`/api/sessions/${sessionId}/recap`, { learnerId });
  check("recap loads", first.status === 200, `status ${first.status}`);
  if (first.status !== 200) console.error(`        ${JSON.stringify(first.body)}`);

  // Either source is correct: a first-ever run generates, a repeat run finds the
  // variant already retained. What must always hold is that the value came from
  // one of those two paths and not from a fallback.
  check(
    "recap came from generation or the cache, not a fallback",
    first.body.source === "generated" || first.body.source === "cache",
    String(first.body.source),
  );
  check("recap is a real recap, not a source extract", first.body.mode === "generated");
  check(
    "recap has 3–7 takeaways",
    Array.isArray(first.body.takeaways) &&
      (first.body.takeaways as []).length >= 3 &&
      (first.body.takeaways as []).length <= 7,
  );

  const sections = (first.body.sections ?? []) as { sourceRefs: unknown[]; uncovered: boolean }[];
  check("recap has one section per topic", sections.length > 0, `${sections.length} sections`);
  check(
    "every covered section cites a source",
    sections.every((section) => section.uncovered || section.sourceRefs.length > 0),
  );

  const second = await call(`/api/sessions/${sessionId}/recap`, { learnerId });
  check("second request is served from cache", second.body.source === "cache", String(second.body.source));

  // A different profile is a different cache entry.
  await call(`/api/sessions/${sessionId}/profile`, {
    method: "PUT",
    learnerId,
    body: JSON.stringify({
      understandingLevel: "No_Understanding",
      explanationStyle: "Step_By_Step",
    }),
  });
  const switched = await call(`/api/sessions/${sessionId}/recap`, { learnerId });
  check("a different profile returns its own variant", switched.status === 200);
  check(
    "the new variant reads differently",
    JSON.stringify(switched.body.sections) !== JSON.stringify(first.body.sections),
  );
  check(
    "the new variant is keyed to the profile that asked for it",
    switched.body.understandingLevel === "No_Understanding" &&
      switched.body.explanationStyle === "Step_By_Step",
  );

  // --- Quiz ---------------------------------------------------------------
  const start = await call(`/api/sessions/${sessionId}/quiz-sessions`, {
    method: "POST",
    learnerId,
  });
  check("quiz session starts", start.status === 201, `status ${start.status}`);
  if (start.status !== 201) {
    console.error(`        ${JSON.stringify(start.body)}`);
    throw new Error("quiz could not start");
  }

  const quizSessionId = start.body.quizSessionId as string;
  check("quiz opens at difficulty 2", start.body.currentDifficulty === 2);
  check("quiz is six questions", start.body.length === 6, String(start.body.length));

  const servedIds: string[] = [];
  const difficulties: number[] = [];
  /** The Topics answered so far, which is what selection spreads coverage over. */
  const answeredTopics: { topicId: string }[] = [];
  // The API never reveals which option is correct before an answer, so the
  // correctness pattern cannot be chosen in advance. Instead the observed
  // pattern is folded through the engine and compared with what the server
  // actually served — which is the real invariant.
  const correctness: { isCorrect: boolean }[] = [];

  for (let index = 1; index <= 6; index += 1) {
    const next = await call(
      `/api/sessions/${sessionId}/quiz-sessions/${quizSessionId}/next`,
      { learnerId },
    );

    if (next.body.done === true) {
      check(`question ${index} is served`, false, "session closed early");
      break;
    }

    const item = next.body.item as { id: string; difficulty: number; options: Json[] };

    check(`question ${index} served`, next.status === 200 && item.options.length === 4);

    // The engine's Current_Difficulty is what the server *asks* for; selection
    // walks to the nearest level when that one has no unserved item left, which
    // is what lets a six-question session finish on a pool that is thin at one
    // level. Predicting the item with the same pure function the server uses
    // checks both halves of that contract, where comparing the difficulty alone
    // would fail the moment a level is exhausted.
    const expected = replay(correctness).difficulty;
    const predicted = selectNextItem(
      pool,
      servedIds,
      answeredTopics,
      topicOrder,
      expected,
    );

    check(
      `question ${index} is the item the engine selects`,
      item.id === predicted?.quizItemId,
      `served ${item.id} at level ${item.difficulty}, engine wanted level ${expected} and selected ${predicted?.quizItemId}`,
    );

    servedIds.push(item.id);
    difficulties.push(item.difficulty);
    answeredTopics.push({ topicId: predicted?.topicId ?? "" });

    const leaks = JSON.stringify(next.body);
    if (leaks.includes("isCorrect") || leaks.includes("misconceptionLabel")) {
      check(`question ${index} leaks no answer`, false);
    }

    // Answer the first three correctly, then the rest incorrectly, so the
    // adaptive engine has to move in both directions.
    const optionId = index <= 3 ? (item.options[0] as { id: string }).id : (item.options[1] as { id: string }).id;

    const answer = await call(
      `/api/sessions/${sessionId}/quiz-sessions/${quizSessionId}/responses`,
      { method: "POST", learnerId, body: JSON.stringify({ quizItemId: item.id, optionId }) },
    );

    check(`answer ${index} recorded`, answer.status === 200, `status ${answer.status}`);
    check(`answer ${index} reports its source`, Boolean(answer.body.sourceRef));

    correctness.push({ isCorrect: answer.body.isCorrect === true });
    check(
      `answer ${index} reports the next difficulty the engine will serve`,
      answer.body.nextDifficulty === replay(correctness).difficulty,
    );

    if (index === 1) {
      const repeat = await call(
        `/api/sessions/${sessionId}/quiz-sessions/${quizSessionId}/responses`,
        { method: "POST", learnerId, body: JSON.stringify({ quizItemId: item.id, optionId }) },
      );
      check("duplicate submission keeps the first answer", repeat.body.duplicate === true);
    }
  }

  check("six distinct questions were served", new Set(servedIds).size === 6, `${servedIds.length} served`);
  check("difficulty adapts during the session", new Set(difficulties).size > 1, difficulties.join(" → "));

  const done = await call(
    `/api/sessions/${sessionId}/quiz-sessions/${quizSessionId}/next`,
    { learnerId },
  );
  check("session closes after six answers", done.body.done === true);

  // --- Report -------------------------------------------------------------
  const report = await call(`/api/sessions/${sessionId}/reports/${quizSessionId}`, {
    learnerId,
  });

  check("report loads", report.status === 200, `status ${report.status}`);
  if (report.status !== 200) console.error(`        ${JSON.stringify(report.body)}`);

  const mastery = (report.body.topicMastery ?? []) as { mastery: number }[];
  check("report holds per-topic mastery", mastery.length > 0, `${mastery.length} topics`);
  check("every mastery value is a percentage", mastery.every((entry) => entry.mastery >= 0 && entry.mastery <= 100));

  const serialised = JSON.stringify(report.body);
  for (const forbidden of ["learnerId", "displayName", "classMastery", "respondingLearners", "submittedAt"]) {
    check(`report leaks no ${forbidden}`, !serialised.includes(forbidden));
  }

  const stranger = await call(`/api/sessions/${sessionId}/reports/${quizSessionId}`, {
    learnerId: "0".repeat(32),
  });
  check("another learner cannot read the report", stranger.status === 403);

  return learnerId;
}

/** The pages a presenter actually opens, fetched as the browser fetches them. */
async function verifyPages(sessionId: string): Promise<void> {
  console.log("\nC. Pages render");

  const pages: [string, string, string][] = [
    ["/", "Understand yourself", "join page"],
    [`/class/${sessionId}/lecture`, "What this lecture covers", "lecture view"],
    [`/class/${sessionId}/recap`, "ClassMind", "recap view"],
    [`/class/${sessionId}/quiz`, "ClassMind", "quiz view"],
    [`/class/${sessionId}/insight`, "Class Insight", "class insight view"],
    // Client-rendered views are checked against the state the server actually
    // emits, which is their loading state — the content arrives after hydration.
    [`/class/${sessionId}/insight/normalisation`, "study space", "study together view"],
  ];

  for (const [path, needle, label] of pages) {
    const response = await fetch(`${ORIGIN}${path}`);
    const html = await response.text();

    check(`${label} responds`, response.status === 200, `status ${response.status}`);
    check(`${label} renders its content`, html.includes(needle));
    // Next renders a recognisable error overlay marker when a page throws.
    check(`${label} throws no server error`, !html.includes("__next_error__"));
  }

  // The lecture view is server-rendered, so the seeded material must appear in
  // the HTML itself rather than arriving later from the client.
  const lecture = await fetch(`${ORIGIN}/class/${sessionId}/lecture`);
  const html = await lecture.text();

  check("lecture view server-renders the session name", html.includes("Relational Databases"));
  check("lecture view server-renders the topic list", html.includes("Normalisation"));
  check("lecture view offers the profile picker", html.includes("How confident are you"));
  check("lecture view offers every explanation style", html.includes("Step-by-step"));
  check("lecture view renders the sidebar", html.includes("ClassMind sections"));
}

/**
 * Class Insight and Study Together, driven over HTTP exactly as the browser
 * drives them.
 */
async function verifyClassInsight(facts: ClassFacts, learnerId: string): Promise<void> {
  const { sessionId } = facts;

  console.log("\nD. Class Insight and Study Together");

  const insight = await call(`/api/sessions/${sessionId}/insight`, { learnerId });

  check("class insight loads", insight.status === 200, `status ${insight.status}`);
  if (insight.status !== 200) {
    console.error(`        ${JSON.stringify(insight.body)}`);
    throw new Error("class insight failed");
  }

  const topics = (insight.body.topics ?? []) as {
    topicId: string;
    topicName: string;
    status: string;
    classMastery?: number;
  }[];

  check("every topic is reported", topics.length > 0, `${topics.length} topics`);

  const published = topics.filter((topic) => topic.status === "published");
  check("topics are published above the threshold", published.length >= 3, `${published.length} published`);

  // Two bands rather than three: by this point this script's own learner has
  // answered, so the live class has genuinely moved. The three-band guarantee
  // belongs to the seeded state and is asserted in section A.
  const bands = new Set(
    published.map((topic) => masteryTone(topic.classMastery ?? 0).band),
  );
  check("the class map spans several bands", bands.size >= 2, [...bands].join(", "));

  const masteries = published.map((topic) => topic.classMastery ?? 0);
  check(
    "published topics are ordered weakest first",
    masteries.every((value, index) => index === 0 || value >= masteries[index - 1]),
    masteries.join(" → "),
  );

  check(
    "the weakest topic is named",
    typeof insight.body.weakestTopicId === "string",
    String(insight.body.weakestTopicId),
  );
  check("the anonymity threshold is stated", insight.body.anonymityThreshold === 3);

  const misconceptions = (insight.body.misconceptions ?? []) as {
    topicId: string;
    sharePercent: number;
    misconceptionLabel: string;
    clarification?: string;
  }[];

  check("at least one misconception is detected", misconceptions.length >= 1, `${misconceptions.length} found`);
  check("misconceptions are capped at three", misconceptions.length <= 3);

  for (const entry of misconceptions) {
    check(
      `misconception on ${entry.topicId} reports a real share`,
      entry.sharePercent >= 30 && entry.sharePercent <= 100,
      `${entry.sharePercent}%`,
    );
    check(`misconception on ${entry.topicId} names the belief`, entry.misconceptionLabel.length > 0);
  }

  const serialised = JSON.stringify(insight.body);
  for (const forbidden of [
    "learnerId",
    "displayName",
    "submittedAt",
    "quizSessionId",
    "isCorrect",
    "seedlearner",
  ]) {
    check(`class insight leaks no ${forbidden}`, !serialised.includes(forbidden));
  }

  // --- Study Together -----------------------------------------------------
  // The seeded Study_Thread is on the Topic the seed chose. The live weakest
  // Topic moves as this script's own learner answers, so reading the thread
  // from `weakestTopicId` would ask an empty Topic for seeded explanations.
  const threadTopicId = facts.threadTopicId;

  const thread = await call(`/api/sessions/${sessionId}/threads/${threadTopicId}`, {
    learnerId,
  });

  check("the study thread loads", thread.status === 200, `status ${thread.status}`);

  const explanations = (thread.body.explanations ?? []) as {
    id: string;
    status: string;
    isRecommended: boolean;
    reason: string | null;
  }[];

  check("seeded explanations are present", explanations.length >= 2, `${explanations.length} explanations`);

  const statuses = new Set(explanations.map((entry) => entry.status));
  check("at least one explanation is validated", statuses.has("Validated"), [...statuses].join(", "));
  check(
    "at least one explanation is not validated",
    statuses.has("Contradicted") || statuses.has("Unsupported"),
    [...statuses].join(", "),
  );

  const recommended = explanations.filter((entry) => entry.isRecommended);
  check("only validated explanations are recommended", recommended.every((entry) => entry.status === "Validated"));
  check("the recommended explanation leads the thread", explanations[0]?.isRecommended === true);

  for (const entry of explanations) {
    if (entry.status !== "Validated") {
      check(`a ${entry.status} explanation carries its reason`, Boolean(entry.reason));
    }
  }

  const threadSerialised = JSON.stringify(thread.body);
  for (const forbidden of ["learnerId", "displayName", "seedlearner"]) {
    check(`the study thread leaks no ${forbidden}`, !threadSerialised.includes(forbidden));
  }

  // --- Contributing -------------------------------------------------------
  const tooShort = await call(
    `/api/sessions/${sessionId}/threads/${threadTopicId}/explanations`,
    { method: "POST", learnerId, body: JSON.stringify({ text: "Too short" }) },
  );
  check("a too-short explanation is rejected", tooShort.status === 400);

  const submitted = await call(
    `/api/sessions/${sessionId}/threads/${threadTopicId}/explanations`,
    {
      method: "POST",
      learnerId,
      body: JSON.stringify({
        text: "Normalisation organises the columns and tables of a relational database to reduce data redundancy and improve data integrity.",
      }),
    },
  );

  check("an explanation can be submitted", submitted.status === 201, `status ${submitted.status}`);
  check("it is stored as Pending before checking", submitted.body.status === "Pending");

  const validated = await call(
    `/api/sessions/${sessionId}/explanations/${submitted.body.id as string}/validate`,
    { method: "POST", learnerId },
  );

  check("the explanation is checked", validated.status === 200, `status ${validated.status}`);
  check(
    "the check produced a real verdict",
    ["Validated", "Unsupported", "Contradicted", "Pending"].includes(
      validated.body.status as string,
    ),
    String(validated.body.status),
  );
  check(
    "a supported explanation cites the material",
    validated.body.status !== "Validated" || Boolean(validated.body.sourceRef),
  );

  const after = await call(`/api/sessions/${sessionId}/threads/${threadTopicId}`, {
    learnerId,
  });
  const afterCount = ((after.body.explanations ?? []) as unknown[]).length;
  check("the new explanation appears in the thread", afterCount === explanations.length + 1);
}

/**
 * Upload → storage → extraction → topics → recap → quiz, driven over HTTP.
 *
 * This runs against its own Class_Session rather than the demo one. An upload
 * moves the class it lands in onto a new material version, and doing that to
 * CM2026 would replace the seeded lecture the rest of this script has just
 * finished verifying. A separate session proves the same pipeline without
 * touching the demo — and section F then confirms the demo is still intact.
 */
async function verifyUpload(): Promise<void> {
  console.log("\nE. Upload → storage → extraction → topics → recap → quiz");

  const sessionId = UPLOAD_SESSION_ID;

  // Reused across runs, so repeated verification leaves one extra session in
  // the table rather than one per run.
  try {
    await createSession({
      sessionId,
      name: "Upload check",
      joinCode: UPLOAD_JOIN_CODE,
      instructorTokenHash: hashInstructorToken(newInstructorToken()),
      // A class with no material yet: version 1 exists as a pointer, but no
      // Lecture_Material has been written under it. That is the state a Learner
      // meets before uploading anything.
      materialVersion: 1,
    });
    console.log(`  ..    created session ${sessionId} (${UPLOAD_JOIN_CODE})`);
  } catch (error) {
    if (!(error instanceof JoinCodeTakenError)) throw error;
    console.log(`  ..    reusing session ${sessionId} (${UPLOAD_JOIN_CODE})`);
  }

  const before = await getSession(sessionId);
  const versionBefore = before?.materialVersion ?? 0;

  const join = await call("/api/sessions/join", {
    method: "POST",
    body: JSON.stringify({ joinCode: UPLOAD_JOIN_CODE, displayName: "Upload Check" }),
  });
  check("join into the upload session succeeds", join.status === 200, `status ${join.status}`);
  if (join.status !== 200) throw new Error("could not join the upload session");

  const learnerId = join.body.learnerId as string;

  // --- The empty state ----------------------------------------------------
  if (versionBefore === 1) {
    // Only true on the first run: afterwards this session has material.
    const empty = await fetch(`${ORIGIN}/class/${sessionId}/lecture`);
    const emptyHtml = await empty.text();

    check("a class with no material renders", empty.status === 200);
    check("and it says there is none yet", emptyHtml.includes("No lecture material yet"));
    check("and it offers the upload control", emptyHtml.includes("Upload your lecture material"));
  }

  // --- Files that must be refused -----------------------------------------
  const unsupported = await upload(sessionId, learnerId, "slides.pptx", TEXT_LECTURE);
  check("an unsupported extension is refused", unsupported.status === 400, `status ${unsupported.status}`);
  check(
    "and it says which types are accepted",
    String((unsupported.body.error as Json | undefined)?.code) === "UNSUPPORTED_EXTENSION",
  );

  const empty = await upload(sessionId, learnerId, "empty.txt", new Uint8Array(0));
  check("an empty file is refused", empty.status === 400, `status ${empty.status}`);

  const oversized = await upload(
    sessionId,
    learnerId,
    "huge.pdf",
    new Uint8Array(MATERIAL_MAX_BYTES + 1),
  );
  check("an oversized file is refused", oversized.status === 400, `status ${oversized.status}`);

  const malformed = await upload(
    sessionId,
    learnerId,
    "broken.pdf",
    new TextEncoder().encode("%PDF-1.7\nnot really a pdf at all\n%%EOF"),
  );
  check("a malformed PDF is refused", malformed.status === 422, `status ${malformed.status}`);
  check(
    "and it is reported as unreadable rather than as a server error",
    String((malformed.body.error as Json | undefined)?.code) === "NO_READABLE_TEXT",
  );

  const tiny = await upload(sessionId, learnerId, "stub.md", new TextEncoder().encode("# Hi"));
  check("a file with too little text is refused", tiny.status === 422, `status ${tiny.status}`);

  const afterRejections = await getSession(sessionId);
  check(
    "a refused upload leaves the class on the material it had",
    afterRejections?.materialVersion === versionBefore,
    `v${afterRejections?.materialVersion}`,
  );

  // --- A real upload, one per supported format -----------------------------
  const markdown = await upload(
    sessionId,
    learnerId,
    "week-4-lecture.md",
    readFileSync(path.resolve(process.cwd(), "tests/fixtures/lecture-sample.md")),
  );
  check("a Markdown upload succeeds", markdown.status === 201, `status ${markdown.status}`);
  if (markdown.status !== 201) {
    console.error(`        ${JSON.stringify(markdown.body)}`);
    throw new Error("the upload failed — the rest of section E cannot run");
  }

  const text = await upload(
    sessionId,
    learnerId,
    "week-4-notes.txt",
    readFileSync(path.resolve(process.cwd(), "tests/fixtures/lecture-sample.txt")),
  );
  check("a TXT upload succeeds", text.status === 201, `status ${text.status}`);

  const pdf = await upload(
    sessionId,
    learnerId,
    "week-4-slides.pdf",
    readFileSync(path.resolve(process.cwd(), "tests/fixtures/lecture-sample.pdf")),
  );
  check("a PDF upload succeeds", pdf.status === 201, `status ${pdf.status}`);
  if (pdf.status !== 201) {
    console.error(`        ${JSON.stringify(pdf.body)}`);
    throw new Error("the PDF upload failed");
  }

  const version = pdf.body.materialVersion as number;
  const uploadedTopics = (pdf.body.topics ?? []) as { topicId: string; name: string }[];

  check("each upload lands on its own material version", version === versionBefore + 3, `v${version}`);
  check("the response names the lecture", pdf.body.filename === "week-4-slides.pdf");
  check("the material is ready", pdf.body.status === "ready", String(pdf.body.status));
  check("topics were detected (3–8)", uploadedTopics.length >= 3 && uploadedTopics.length <= 8, `${uploadedTopics.length} topics`);
  check("the response leaks no storage key", !JSON.stringify(pdf.body).includes("sessions/"));

  // --- Read the persisted state back through the repository ---------------
  const [material, topics, units, pool] = await Promise.all([
    getMaterial(sessionId, version),
    listTopics(sessionId, version),
    listSourceUnits(sessionId, version),
    listQuizItems(sessionId, version),
  ]);

  check("the material record was persisted", material !== null);
  check("it points at the file that was uploaded", material?.filename === "week-4-slides.pdf");
  check("the extracted text was measured", (material?.charCount ?? 0) >= 200, `${material?.charCount} chars`);

  const storedInS3 = pdf.body.storage === "s3";
  check(
    `the original file is in ${storedInS3 ? "S3" : "local storage"}`,
    material !== null && (await materialExists(material.s3Key)),
    material?.s3Key.replace(/[^/]+$/, "…"),
  );
  if (storedInS3) {
    check("the object key uses the session and version layout", Boolean(material?.s3Key.startsWith(`sessions/${sessionId}/material/v${version}/`)));
  }

  check("source units were persisted", units.length > 0, `${units.length} units`);
  check("every unit carries a source reference", units.every((unit) => unit.ref.value.length > 0));
  check("PDF units cite pages", units.every((unit) => unit.ref.kind === "page"));
  check("topics were persisted", topics.length === uploadedTopics.length, `${topics.length} topics`);
  check(
    "every topic points at units that exist",
    topics.every((topic) =>
      topic.unitIdxs.length > 0 &&
      topic.unitIdxs.every((index) => units.some((unit) => unit.index === index)),
    ),
  );
  check("a quiz pool was built from the upload", pool.length >= 6, `${pool.length} items`);
  check("every quiz item belongs to the uploaded material", pool.every((item) => item.materialVersion === version));

  const uploadedTopicIds = new Set(topics.map((topic) => topic.topicId));
  check("every quiz item is on an uploaded topic", pool.every((item) => uploadedTopicIds.has(item.topicId)));

  const session = await getSession(sessionId);
  check("the class now reads the uploaded material", session?.materialVersion === version, `v${session?.materialVersion}`);

  // --- The recap is grounded in the upload --------------------------------
  await call(`/api/sessions/${sessionId}/profile`, {
    method: "PUT",
    learnerId,
    body: JSON.stringify({
      understandingLevel: "Basic_Understanding",
      explanationStyle: "Detailed",
    }),
  });

  const recap = await call(`/api/sessions/${sessionId}/recap`, { learnerId });
  check("the recap loads for the uploaded material", recap.status === 200, `status ${recap.status}`);
  if (recap.status !== 200) console.error(`        ${JSON.stringify(recap.body)}`);

  const uploadedNames = new Set(topics.map((topic) => topic.name));
  const knownRefs = new Set(units.map((unit) => unit.ref.value));
  const sections = (recap.body.sections ?? []) as {
    topicName: string;
    sourceRefs: { value: string }[];
    uncovered: boolean;
  }[];

  check("the recap has a section per uploaded topic", sections.length === topics.length, `${sections.length} sections`);
  check("every recap section names an uploaded topic", sections.every((section) => uploadedNames.has(section.topicName)));
  check(
    "every covered section cites the uploaded material",
    sections.every(
      (section) =>
        section.uncovered ||
        (section.sourceRefs.length > 0 &&
          section.sourceRefs.every((ref) => knownRefs.has(ref.value))),
    ),
  );

  // --- The quiz is built from the upload ----------------------------------
  const start = await call(`/api/sessions/${sessionId}/quiz-sessions`, {
    method: "POST",
    learnerId,
  });
  check("a quiz session starts on the uploaded material", start.status === 201, `status ${start.status}`);
  if (start.status !== 201) {
    console.error(`        ${JSON.stringify(start.body)}`);
    throw new Error("the quiz could not start on the uploaded material");
  }

  const quizSessionId = start.body.quizSessionId as string;
  const poolIds = new Set(pool.map((item) => item.quizItemId));

  for (let index = 1; index <= 2; index += 1) {
    const next = await call(
      `/api/sessions/${sessionId}/quiz-sessions/${quizSessionId}/next`,
      { learnerId },
    );

    const item = next.body.item as { id: string; options: { id: string }[] };
    check(`quiz question ${index} comes from the uploaded pool`, poolIds.has(item.id), item.id);

    const answer = await call(
      `/api/sessions/${sessionId}/quiz-sessions/${quizSessionId}/responses`,
      { method: "POST", learnerId, body: JSON.stringify({ quizItemId: item.id, optionId: item.options[0].id }) },
    );

    check(`quiz answer ${index} cites the uploaded material`, knownRefs.has((answer.body.sourceRef as { value: string } | undefined)?.value ?? ""));
  }

  // --- The lecture view shows the upload ----------------------------------
  const lecture = await fetch(`${ORIGIN}/class/${sessionId}/lecture`);
  const html = await lecture.text();

  check("the lecture view offers an upload control", html.includes("Upload your lecture material") || html.includes("Upload different lecture material"));
  check("the lecture view names the uploaded file", html.includes("week-4-slides.pdf"));
  check("the lecture view lists a detected topic", [...uploadedNames].some((name) => html.includes(name)));
  check("the lecture view reports the material status", html.includes("Ready"));
}

/** The seeded class must be exactly as it was before section E ran. */
async function verifySeedUnaffected(facts: ClassFacts): Promise<void> {
  console.log("\nF. The seeded CM2026 lecture is untouched");

  const session = await resolveJoinCode(JOIN_CODE);
  check("CM2026 still resolves", session !== null);
  if (!session) return;

  const [material, topics, pool] = await Promise.all([
    getMaterial(session.sessionId, session.materialVersion),
    listTopics(session.sessionId, session.materialVersion),
    listQuizItems(session.sessionId, session.materialVersion),
  ]);

  check("it is still on its seeded material version", session.materialVersion === 1, `v${session.materialVersion}`);
  check("its material is still the seeded lecture", material?.filename === "demo-lecture.md", material?.filename);
  check("its material is still ready", material?.status === "ready", material?.status);
  check("its topics are unchanged", topics.length === facts.topicOrder.length, `${topics.length} topics`);
  check("its quiz pool is unchanged", pool.length === facts.pool.length, `${pool.length} items`);
}

async function main(): Promise<void> {
  const facts = await verifySeededState();
  const learnerId = await verifyJourney(facts);
  await verifyClassInsight(facts, learnerId);
  await verifyPages(facts.sessionId);
  await verifyUpload();
  await verifySeedUnaffected(facts);

  console.log(
    failures === 0
      ? "\nAll checks passed. The vertical slice runs end to end.\n"
      : `\n${failures} check(s) failed.\n`,
  );

  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("\nHealth check aborted:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
