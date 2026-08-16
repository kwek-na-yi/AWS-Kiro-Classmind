import { percentage } from "@/lib/domain/round";

/**
 * The Class_Understanding_Map.
 *
 * Computed from the persisted Quiz_Responses on every request, never stored and
 * served back, so the map cannot go stale. Pure integer counting plus one
 * division through the shared rounding helper — no I/O, no generation, and no
 * dependence on the order responses arrive in.
 *
 * Anonymity is enforced here rather than in the view: a Topic answered by fewer
 * than three distinct Learners carries no percentage, no band and no learner
 * count, because with one or two respondents a published percentage would
 * describe an identifiable person's answers.
 */

/** Distinct Learners who must have answered a Topic before it is published. */
export const ANONYMITY_THRESHOLD = 3;

export type Band = "needs-attention" | "developing" | "strong";

/**
 * The text label rendered beside every band.
 *
 * Meaning is always carried by the label and the percentage; colour is only
 * decoration on top, so the map is readable without colour perception.
 */
export const BAND_LABELS: Record<Band, string> = {
  "needs-attention": "Needs Attention",
  developing: "Developing",
  strong: "Strong",
};

/** Rendered in place of a band for a Topic held below the threshold. */
export const INSUFFICIENT_DATA_LABEL = "Not enough responses yet";

/** Just enough of a Quiz_Response to aggregate a class. */
export interface ClassResponse {
  topicId: string;
  learnerId: string;
  isCorrect: boolean;
}

/** Just enough of a Topic to name and order a row. */
export interface NamedTopic {
  topicId: string;
  name: string;
}

/**
 * A published row: at least three distinct Learners have answered the Topic.
 *
 * `answered` and `correct` are the aggregate counts the percentage came from.
 * They are safe to carry here because the row is already above the threshold,
 * and the API projection drops them regardless.
 */
export interface PublishedClassMapEntry {
  topicId: string;
  topicName: string;
  status: "published";
  classMastery: number;
  band: Band;
  bandLabel: string;
  respondingLearners: number;
  answered: number;
  correct: number;
}

/**
 * A suppressed row. It carries no counts at all — not even `answered` — because
 * "two learners, one correct" would disclose an individual's result just as
 * surely as a percentage would.
 */
export interface SuppressedClassMapEntry {
  topicId: string;
  topicName: string;
  status: "insufficient-data";
}

export type ClassMapEntry = PublishedClassMapEntry | SuppressedClassMapEntry;

/** The band a Class_Mastery value falls in. */
export function bandFor(classMastery: number): Band {
  if (classMastery >= 75) return "strong";
  if (classMastery >= 50) return "developing";
  return "needs-attention";
}

function compareNames(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

interface Tally {
  answered: number;
  correct: number;
  learnerIds: Set<string>;
}

/**
 * Aggregates every persisted Quiz_Response into one row per Topic.
 *
 * Rows are ordered weakest first, so the Topics the class is struggling with
 * lead the view. Suppressed Topics sort last, among themselves by name.
 *
 * A response naming a Topic that is not in `topics` is ignored: the map is a
 * view over the Class_Session's Topics, and a row cannot be published without a
 * Topic name to label it.
 */
export function computeClassMap(
  topics: readonly NamedTopic[],
  responses: readonly ClassResponse[],
  threshold: number = ANONYMITY_THRESHOLD,
): ClassMapEntry[] {
  const tallies = new Map<string, Tally>();
  for (const topic of topics) {
    tallies.set(topic.topicId, { answered: 0, correct: 0, learnerIds: new Set() });
  }

  for (const response of responses) {
    const tally = tallies.get(response.topicId);
    if (!tally) continue;

    tally.answered += 1;
    if (response.isCorrect) tally.correct += 1;
    tally.learnerIds.add(response.learnerId);
  }

  const entries: ClassMapEntry[] = topics.map((topic) => {
    const tally = tallies.get(topic.topicId) as Tally;
    const distinct = tally.learnerIds.size;

    if (distinct < threshold || tally.answered === 0) {
      return {
        topicId: topic.topicId,
        topicName: topic.name,
        status: "insufficient-data",
      };
    }

    const classMastery = percentage(tally.correct, tally.answered);
    const band = bandFor(classMastery);

    return {
      topicId: topic.topicId,
      topicName: topic.name,
      status: "published",
      classMastery,
      band,
      bandLabel: BAND_LABELS[band],
      respondingLearners: distinct,
      answered: tally.answered,
      correct: tally.correct,
    };
  });

  // Every comparison ends in the Topic id, so the order is total: it can never
  // fall back on the order the responses or Topics happened to arrive in.
  return entries.sort((a, b) => {
    if (a.status !== b.status) return a.status === "published" ? -1 : 1;

    if (a.status === "published" && b.status === "published") {
      const byMastery = a.classMastery - b.classMastery;
      if (byMastery !== 0) return byMastery;
    }

    const byName = compareNames(a.topicName, b.topicName);
    if (byName !== 0) return byName;

    return compareIds(a.topicId, b.topicId);
  });
}
