import "server-only";

import { validateExplanation } from "@/lib/ai/services/explanation";
import { nextState, replay } from "@/lib/domain/difficulty";
import { computeMasterySummary } from "@/lib/domain/mastery";
import { putExplanation } from "@/lib/repo/explanation";
import { prefixes } from "@/lib/repo/keys";
import { listQuizItems } from "@/lib/repo/pool";
import {
  createQuizSession,
  listAllClassResponses,
  recordResponse,
} from "@/lib/repo/quiz";
import { putReport } from "@/lib/repo/report";
import { registerLearner } from "@/lib/repo/session";
import { deleteAll, queryPrefix } from "@/lib/repo/table";
import type { PeerExplanation, QuizItem, Topic } from "@/lib/types";

/**
 * Seeds the class-level activity Class Insight is computed from.
 *
 * Everything here is written through the same repository functions the live
 * application uses — the seeded Learners take real Quiz_Sessions and their
 * answers are real Quiz_Responses. Nothing is faked into the aggregate: the
 * class map genuinely computes from these responses, so what the demo shows is
 * what the arithmetic produces.
 *
 * The answers are chosen deterministically to guarantee the demo has something
 * worth looking at: three mastery bands across topics, and one Topic where
 * enough Learners pick the *same* wrong option to clear the misconception
 * thresholds.
 */

/**
 * Distinct Learners in the seeded class.
 *
 * Comfortably above the Anonymity_Threshold of 3, and large enough that one
 * more person taking the quiz shifts a Topic by a few points rather than
 * knocking it into a different band — the demo should not change character
 * because the presenter answered a question.
 */
const LEARNERS_PER_TOPIC = 6;

/** Target class mastery per Topic position, giving three visible bands. */
const TARGET_MASTERY = [25, 50, 67, 83, 90];

export interface SeededClass {
  learners: number;
  /** Quiz_Responses present after seeding. */
  responses: number;
  /** How many this run actually wrote; zero on a re-seed, which is correct. */
  written: number;
  explanations: number;
  weakestTopicName: string;
}

/**
 * Removes every learner-generated item in the Class_Session.
 *
 * Learners, their Learner_Profiles, Quiz_Sessions, Quiz_Responses,
 * Understanding_Reports and Peer_Explanations all go; the Lecture_Material,
 * source units and Topics stay, because those are the class itself rather than
 * activity in it.
 *
 * Profiles are cleared with their Learners rather than left behind: a profile
 * whose learner no longer exists is unreachable, and it would keep a Recap
 * variant alive for someone who cannot log in to read it.
 *
 * This is what makes the seed reproducible: the demo state after seeding is a
 * function of the seed script alone, not of how many people happened to take
 * the quiz beforehand.
 */
async function resetClassActivity(sessionId: string): Promise<number> {
  const groups = [
    prefixes.learners(),
    prefixes.profiles(),
    prefixes.quizSessions(),
    prefixes.responses(),
    prefixes.reports(),
    prefixes.explanations(),
  ];

  const keys: { PK: string; SK: string }[] = [];

  for (const prefix of groups) {
    const items = await queryPrefix(sessionId, prefix);

    for (const item of items) {
      keys.push({ PK: String(item.PK), SK: String(item.SK) });
    }
  }

  if (keys.length > 0) await deleteAll(keys);

  return keys.length;
}

/** Deterministic pseudo-names. No real student data is involved. */
const NAMES = [
  "Avery",
  "Blake",
  "Casey",
  "Devon",
  "Emery",
  "Finley",
  "Gray",
  "Harper",
];

/**
 * Whether seeded learner `index` should answer item `position` of a Topic
 * correctly, given how many of the group should get it right.
 *
 * Spreading the correct answers across learners rather than making some
 * learners always right keeps every Topic above the distinct-learner threshold.
 */
function isCorrectFor(index: number, position: number, correctCount: number): boolean {
  return (index + position) % LEARNERS_PER_TOPIC < correctCount;
}

/**
 * Plays one seeded Learner's Quiz_Session through the real write path.
 *
 * The engine state is folded exactly as the response endpoint folds it, so the
 * persisted Quiz_Session is indistinguishable from one a person produced.
 */
async function playSession(
  sessionId: string,
  learnerId: string,
  learnerIndex: number,
  plan: { item: QuizItem; correct: boolean }[],
): Promise<number> {
  const quizSessionId = `seed${String(learnerIndex).padStart(2, "0")}`;

  await createQuizSession(sessionId, {
    quizSessionId,
    learnerId,
    currentDifficulty: 2,
    length: plan.length,
    startedAt: "2026-01-01T09:00:00.000Z",
  });

  let engine = replay([]);
  let written = 0;

  for (const [position, { item, correct }] of plan.entries()) {
    const option = correct
      ? item.options.find((entry) => entry.isCorrect)
      : // Always the *first* distractor, so seeded learners who get an item
        // wrong converge on one option — which is what makes a misconception
        // detectable rather than noise.
        item.options.find((entry) => !entry.isCorrect);

    if (!option) continue;

    engine = nextState(engine, correct);

    const ok = await recordResponse(sessionId, {
      response: {
        quizSessionId,
        seq: position + 1,
        learnerId,
        quizItemId: item.quizItemId,
        topicId: item.topicId,
        optionId: option.optionId,
        isCorrect: correct,
        difficultyServed: item.difficulty,
        submittedAt: `2026-01-01T09:${String(position + 1).padStart(2, "0")}:00.000Z`,
      },
      next: {
        currentDifficulty: engine.difficulty,
        runKind: engine.run.kind,
        runLen: engine.run.len,
      },
      close: position === plan.length - 1,
    });

    if (ok) written += 1;
  }

  // The report the Learner would have received, so a seeded learner's own view
  // is consistent with the class aggregate they contribute to.
  const summary = computeMasterySummary(
    plan.map(({ item, correct }) => ({
      topicId: item.topicId,
      isCorrect: correct,
      difficultyServed: item.difficulty,
    })),
  );

  await putReport(sessionId, {
    learnerId,
    quizSessionId,
    topicMastery: summary.topicMastery,
    weakTopics: summary.weakTopics,
    highestCorrectDifficulty: summary.highestCorrectDifficulty,
    guidance: [],
    guidanceMode: "omitted",
  });

  return written;
}

/**
 * Seeds Learners, their Quiz_Responses and a starting Study_Thread.
 *
 * Returns what was written so the seed script can report it.
 */
export async function seedClassActivity(input: {
  sessionId: string;
  materialVersion: number;
  topics: readonly Topic[];
  /** Progress lines for a script. Silent by default, as on the server. */
  log?: (line: string) => void;
}): Promise<SeededClass> {
  const { sessionId, materialVersion, topics, log = () => {} } = input;

  // Clear the class before rebuilding it. Without this, every rehearsal and
  // every verification run leaves its answers behind, and the class map drifts
  // away from the state the demo was designed around. Re-seeding should
  // restore a known class, not add another cohort to it.
  const cleared = await resetClassActivity(sessionId);
  if (cleared > 0) {
    log(`Cleared ${cleared} existing class items before reseeding`);
  }

  const pool = await listQuizItems(sessionId, materialVersion);

  // One item per Topic, lowest difficulty first so every seeded Learner answers
  // the same question set and the per-Topic counts stay comparable.
  const itemsByTopic = new Map<string, QuizItem>();

  for (const topic of [...topics].sort((a, b) => a.order - b.order)) {
    const candidates = pool
      .filter((item) => item.topicId === topic.topicId)
      .sort(
        (a, b) =>
          a.difficulty - b.difficulty ||
          (a.quizItemId < b.quizItemId ? -1 : 1),
      );

    if (candidates[0]) itemsByTopic.set(topic.topicId, candidates[0]);
  }

  const covered = [...itemsByTopic.keys()];
  if (covered.length === 0) {
    return {
      learners: 0,
      responses: 0,
      written: 0,
      explanations: 0,
      weakestTopicName: "",
    };
  }

  // How many of the group should get each Topic right, to land near the target.
  const correctCounts = new Map<string, number>();

  covered.forEach((topicId, position) => {
    const target = TARGET_MASTERY[position % TARGET_MASTERY.length];
    correctCounts.set(
      topicId,
      Math.round((target / 100) * LEARNERS_PER_TOPIC),
    );
  });

  let responses = 0;

  for (let index = 0; index < LEARNERS_PER_TOPIC; index += 1) {
    const learnerId = `seedlearner${String(index).padStart(2, "0")}`;

    await registerLearner(sessionId, {
      learnerId,
      displayName: NAMES[index % NAMES.length],
      isSeeded: true,
      createdAt: "2026-01-01T08:00:00.000Z",
    });

    const plan = covered.map((topicId, position) => ({
      item: itemsByTopic.get(topicId) as QuizItem,
      correct: isCorrectFor(index, position, correctCounts.get(topicId) ?? 0),
    }));

    responses += await playSession(sessionId, learnerId, index, plan);
  }

  // The weakest Topic is where the study thread is most useful, so that is
  // where the seeded explanations go.
  const weakestTopicId = covered[0];
  const weakestTopic = topics.find((topic) => topic.topicId === weakestTopicId);
  const weakestName = weakestTopic?.name ?? weakestTopicId;

  const explanations = await seedExplanations({
    sessionId,
    materialVersion,
    topicId: weakestTopicId,
  });

  // On a re-run the response items already exist, and first-write-wins
  // correctly declines to overwrite them — so `responses` counts only what this
  // run wrote. Reporting the total present is the honest number either way.
  const present = await listAllClassResponses(sessionId);

  return {
    learners: LEARNERS_PER_TOPIC,
    responses: present.length,
    written: responses,
    explanations,
    weakestTopicName: weakestName,
  };
}

/**
 * Seeds a Study_Thread and runs each explanation through the real validator.
 *
 * The statuses are not written directly: the explanations are persisted as
 * Pending and assessed by the provider exactly as a Learner's would be, so the
 * labels the demo shows are ones the checker genuinely produced.
 */
async function seedExplanations(input: {
  sessionId: string;
  materialVersion: number;
  topicId: string;
}): Promise<number> {
  const { sessionId, materialVersion, topicId } = input;

  // The first quotes the material closely and should validate; the second
  // states the opposite and should not.
  const drafts: { id: string; text: string }[] = [
    {
      id: "seedexpl01",
      text: "Normalisation organises the columns and tables of a relational database to reduce data redundancy and improve data integrity, so each fact is stored once.",
    },
    {
      id: "seedexpl02",
      text: "Normalisation is not about reducing redundancy at all — it exists purely to make queries run faster by storing every fact in as many tables as possible.",
    },
    {
      id: "seedexpl03",
      text: "You should always denormalise every table from the start because joins are the only thing that ever makes a database slow in practice.",
    },
  ];

  let seeded = 0;

  for (const [index, draft] of drafts.entries()) {
    const explanation: PeerExplanation = {
      explanationId: draft.id,
      topicId,
      learnerId: `seedlearner${String(index).padStart(2, "0")}`,
      displayName: NAMES[index % NAMES.length],
      text: draft.text,
      status: "Pending",
      attempts: 0,
      submittedAt: `2026-01-01T10:0${index}:00.000Z`,
    };

    await putExplanation(sessionId, explanation);

    await validateExplanation({
      sessionId,
      materialVersion,
      explanationId: draft.id,
      requestId: "seed",
    });

    seeded += 1;
  }

  return seeded;
}
