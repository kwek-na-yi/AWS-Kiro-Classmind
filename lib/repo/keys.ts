/**
 * Single-table key construction and parsing.
 *
 * Every `PK` and `SK` string in the `classmind` table is built here and nowhere
 * else, so the key format from design.md Section 8 lives in exactly one file.
 * Repositories call these builders; they never concatenate a key themselves.
 *
 * Two rules make the keys safe to parse back:
 *
 * 1. `#` is the field separator, so no free-form component (session id, learner
 *    id, topic id, quiz item id, …) may contain one. Builders throw if one does,
 *    turning a would-be silent key corruption into an immediate failure.
 * 2. Numeric components that participate in ordering are zero-padded to a fixed
 *    width, so DynamoDB's lexicographic sort equals numeric sort — unit `0007`
 *    sorts before `0010`, response `02` before `10`.
 *
 * Parsers return `null` rather than throwing when a string is not a key of the
 * requested kind, so a caller can filter a mixed query result by shape.
 */

import {
  EXPLANATION_STYLES,
  UNDERSTANDING_LEVELS,
  type DifficultyLevel,
  type ExplanationStyle,
  type UnderstandingLevel,
} from "@/lib/types";

const SEP = "#";

/** Width of the zero-padded source unit index (`UNIT#v1#0007`). */
const UNIT_INDEX_WIDTH = 4;
/** Width of the zero-padded Topic order index (`TOPIC#v1#03#slug`). */
const TOPIC_ORDER_WIDTH = 2;
/** Width of the zero-padded Quiz_Response sequence (`RESP#qs_1#02`). */
const RESPONSE_SEQ_WIDTH = 2;

/** A full primary key for a single item. */
export interface ItemKey {
  PK: string;
  SK: string;
}

// ---------------------------------------------------------------------------
// Component guards
// ---------------------------------------------------------------------------

function component(field: string, value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError(`${field} must be a non-empty string`);
  }
  if (value.includes(SEP)) {
    throw new RangeError(`${field} must not contain "${SEP}": ${value}`);
  }
  return value;
}

function padded(field: string, value: number, width: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative integer, got ${value}`);
  }
  const digits = String(value);
  if (digits.length > width) {
    throw new RangeError(
      `${field} ${value} does not fit in ${width} digits — the key would sort incorrectly`,
    );
  }
  return digits.padStart(width, "0");
}

/** `v3` — the Lecture_Material version tag carried by material-derived keys. */
function versionTag(version: number): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new RangeError(`materialVersion must be an integer >= 1, got ${version}`);
  }
  return `v${version}`;
}

function parseVersionTag(tag: string): number | null {
  if (!/^v[1-9][0-9]*$/.test(tag)) return null;
  return Number(tag.slice(1));
}

function parsePaddedInt(raw: string, width: number): number | null {
  if (raw.length !== width || !/^[0-9]+$/.test(raw)) return null;
  return Number(raw);
}

/** Splits an `SK` and returns the parts only when the prefix and arity match. */
function parts(sk: string, prefix: string, count: number): string[] | null {
  if (typeof sk !== "string") return null;
  const segments = sk.split(SEP);
  if (segments.length !== count || segments[0] !== prefix) return null;
  return segments;
}

// ---------------------------------------------------------------------------
// Partition keys
// ---------------------------------------------------------------------------

/** `CS#<sid>` — every item of one Class_Session shares this partition. */
export function sessionPk(sessionId: string): string {
  return `CS${SEP}${component("sessionId", sessionId)}`;
}

export function parseSessionPk(pk: string): { sessionId: string } | null {
  const p = parts(pk, "CS", 2);
  return p ? { sessionId: p[1] } : null;
}

/**
 * `JOIN#<code>` — the Join_Code pointer, its own partition rather than a GSI.
 * The pointer uses the same string for `PK` and `SK`, so a conditional put on
 * `attribute_not_exists(PK)` gives Join_Code uniqueness (Requirement 1.2).
 */
export function joinCodePk(joinCode: string): string {
  return `JOIN${SEP}${component("joinCode", joinCode)}`;
}

export function joinCodeKey(joinCode: string): ItemKey {
  const key = joinCodePk(joinCode);
  return { PK: key, SK: key };
}

export function parseJoinCodePk(pk: string): { joinCode: string } | null {
  const p = parts(pk, "JOIN", 2);
  return p ? { joinCode: p[1] } : null;
}

/** Pairs a Class_Session partition with one of the sort keys below. */
export function sessionItemKey(sessionId: string, sk: string): ItemKey {
  return { PK: sessionPk(sessionId), SK: sk };
}

// ---------------------------------------------------------------------------
// Sort keys — Class_Session, Lecture_Material and extracted structure
// ---------------------------------------------------------------------------

/** `META` — the Class_Session item itself. */
export function metaSk(): string {
  return "META";
}

export function isMetaSk(sk: string): boolean {
  return sk === "META";
}

/** `MATERIAL#v<n>` */
export function materialSk(version: number): string {
  return `MATERIAL${SEP}${versionTag(version)}`;
}

export function parseMaterialSk(sk: string): { version: number } | null {
  const p = parts(sk, "MATERIAL", 2);
  if (!p) return null;
  const version = parseVersionTag(p[1]);
  return version === null ? null : { version };
}

/** `UNIT#v<n>#<idx4>` */
export function unitSk(version: number, index: number): string {
  return `UNIT${SEP}${versionTag(version)}${SEP}${padded("unit index", index, UNIT_INDEX_WIDTH)}`;
}

export function parseUnitSk(sk: string): { version: number; index: number } | null {
  const p = parts(sk, "UNIT", 3);
  if (!p) return null;
  const version = parseVersionTag(p[1]);
  const index = parsePaddedInt(p[2], UNIT_INDEX_WIDTH);
  return version === null || index === null ? null : { version, index };
}

/** `TOPIC#v<n>#<order2>#<slug>` — the slug is the Topic id used by other keys. */
export function topicSk(version: number, order: number, topicId: string): string {
  return [
    "TOPIC",
    versionTag(version),
    padded("topic order", order, TOPIC_ORDER_WIDTH),
    component("topicId", topicId),
  ].join(SEP);
}

export function parseTopicSk(
  sk: string,
): { version: number; order: number; topicId: string } | null {
  const p = parts(sk, "TOPIC", 4);
  if (!p) return null;
  const version = parseVersionTag(p[1]);
  const order = parsePaddedInt(p[2], TOPIC_ORDER_WIDTH);
  return version === null || order === null
    ? null
    : { version, order, topicId: p[3] };
}

// ---------------------------------------------------------------------------
// Sort keys — Learner identity
// ---------------------------------------------------------------------------

/** `LEARNER#<lid>` — also the membership check of Requirement 1.7. */
export function learnerSk(learnerId: string): string {
  return `LEARNER${SEP}${component("learnerId", learnerId)}`;
}

export function parseLearnerSk(sk: string): { learnerId: string } | null {
  const p = parts(sk, "LEARNER", 2);
  return p ? { learnerId: p[1] } : null;
}

/** `PROFILE#<lid>` */
export function profileSk(learnerId: string): string {
  return `PROFILE${SEP}${component("learnerId", learnerId)}`;
}

export function parseProfileSk(sk: string): { learnerId: string } | null {
  const p = parts(sk, "PROFILE", 2);
  return p ? { learnerId: p[1] } : null;
}

// ---------------------------------------------------------------------------
// Sort keys — Recap cache
// ---------------------------------------------------------------------------

/**
 * `RECAP#v<n>#<UL>#<ES>` — the retained-Recap cache key.
 *
 * It is a total function of (Class_Session, materialVersion, Understanding_Level,
 * Explanation_Style), which is what makes the lookup in Requirement 3.6 single
 * valued and caps the variant space at 15 per material version.
 */
export function recapSk(
  version: number,
  understandingLevel: UnderstandingLevel,
  explanationStyle: ExplanationStyle,
): string {
  return [
    "RECAP",
    versionTag(version),
    component("understandingLevel", understandingLevel),
    component("explanationStyle", explanationStyle),
  ].join(SEP);
}

export function parseRecapSk(sk: string): {
  version: number;
  understandingLevel: UnderstandingLevel;
  explanationStyle: ExplanationStyle;
} | null {
  const p = parts(sk, "RECAP", 4);
  if (!p) return null;
  const version = parseVersionTag(p[1]);
  if (version === null) return null;

  const understandingLevel = UNDERSTANDING_LEVELS.find((v) => v === p[2]);
  const explanationStyle = EXPLANATION_STYLES.find((v) => v === p[3]);
  if (!understandingLevel || !explanationStyle) return null;

  return { version, understandingLevel, explanationStyle };
}

// ---------------------------------------------------------------------------
// Sort keys — Quiz_Pool, Quiz_Session and Quiz_Responses
// ---------------------------------------------------------------------------

/**
 * `QITEM#v<n>#<d>#<itemId>` — the Difficulty_Level sits in the key so candidate
 * items for the Current_Difficulty are one `begins_with` query, and the
 * per-level pool counts are three cheap counting queries.
 */
export function quizItemSk(
  version: number,
  difficulty: DifficultyLevel,
  quizItemId: string,
): string {
  if (difficulty !== 1 && difficulty !== 2 && difficulty !== 3) {
    throw new RangeError(`difficulty must be 1, 2 or 3, got ${String(difficulty)}`);
  }
  return [
    "QITEM",
    versionTag(version),
    String(difficulty),
    component("quizItemId", quizItemId),
  ].join(SEP);
}

export function parseQuizItemSk(sk: string): {
  version: number;
  difficulty: DifficultyLevel;
  quizItemId: string;
} | null {
  const p = parts(sk, "QITEM", 4);
  if (!p) return null;
  const version = parseVersionTag(p[1]);
  if (version === null) return null;
  if (p[2] !== "1" && p[2] !== "2" && p[2] !== "3") return null;

  return {
    version,
    difficulty: Number(p[2]) as DifficultyLevel,
    quizItemId: p[3],
  };
}

/** `QSESS#<lid>#<qsid>` — learner id first, so ownership is enforced by the key. */
export function quizSessionSk(learnerId: string, quizSessionId: string): string {
  return [
    "QSESS",
    component("learnerId", learnerId),
    component("quizSessionId", quizSessionId),
  ].join(SEP);
}

export function parseQuizSessionSk(
  sk: string,
): { learnerId: string; quizSessionId: string } | null {
  const p = parts(sk, "QSESS", 3);
  return p ? { learnerId: p[1], quizSessionId: p[2] } : null;
}

/**
 * `RESP#<qsid>#<seq2>` — the Quiz_Session id precedes the sequence, so one
 * `begins_with` yields a session's responses in submission order while the bare
 * `RESP#` prefix yields the whole class for the Class_Understanding_Map.
 */
export function responseSk(quizSessionId: string, seq: number): string {
  return [
    "RESP",
    component("quizSessionId", quizSessionId),
    padded("response seq", seq, RESPONSE_SEQ_WIDTH),
  ].join(SEP);
}

export function parseResponseSk(
  sk: string,
): { quizSessionId: string; seq: number } | null {
  const p = parts(sk, "RESP", 3);
  if (!p) return null;
  const seq = parsePaddedInt(p[2], RESPONSE_SEQ_WIDTH);
  return seq === null ? null : { quizSessionId: p[1], seq };
}

/** `REPORT#<lid>#<qsid>` */
export function reportSk(learnerId: string, quizSessionId: string): string {
  return [
    "REPORT",
    component("learnerId", learnerId),
    component("quizSessionId", quizSessionId),
  ].join(SEP);
}

export function parseReportSk(
  sk: string,
): { learnerId: string; quizSessionId: string } | null {
  const p = parts(sk, "REPORT", 3);
  return p ? { learnerId: p[1], quizSessionId: p[2] } : null;
}

// ---------------------------------------------------------------------------
// Sort keys — Study_Space and misconceptions
// ---------------------------------------------------------------------------

/**
 * `EXPL#<topicId>#<ts>#<eid>` — Topic then timestamp, so one Study_Thread comes
 * back in chronological order from a single `begins_with`. `ts` is an ISO-8601
 * instant, which sorts lexicographically in the same order it sorts temporally.
 */
export function explanationSk(
  topicId: string,
  submittedAt: string,
  explanationId: string,
): string {
  return [
    "EXPL",
    component("topicId", topicId),
    component("submittedAt", submittedAt),
    component("explanationId", explanationId),
  ].join(SEP);
}

export function parseExplanationSk(sk: string): {
  topicId: string;
  submittedAt: string;
  explanationId: string;
} | null {
  const p = parts(sk, "EXPL", 4);
  return p
    ? { topicId: p[1], submittedAt: p[2], explanationId: p[3] }
    : null;
}

/** `MISC#v<n>#<itemId>#<optionId>` — the clarification cache for one Distractor. */
export function misconceptionSk(
  version: number,
  quizItemId: string,
  optionId: string,
): string {
  return [
    "MISC",
    versionTag(version),
    component("quizItemId", quizItemId),
    component("optionId", optionId),
  ].join(SEP);
}

export function parseMisconceptionSk(sk: string): {
  version: number;
  quizItemId: string;
  optionId: string;
} | null {
  const p = parts(sk, "MISC", 4);
  if (!p) return null;
  const version = parseVersionTag(p[1]);
  return version === null
    ? null
    : { version, quizItemId: p[2], optionId: p[3] };
}

// ---------------------------------------------------------------------------
// Prefixes for `begins_with` queries
//
// One per access pattern in design.md Section 8, plus the per-version prefixes
// the material-replacement purge walks.
// ---------------------------------------------------------------------------

export const prefixes = {
  /** Access pattern 9: every source unit of a material version. */
  units(version: number): string {
    return `UNIT${SEP}${versionTag(version)}${SEP}`;
  },

  /** Access pattern 8: every Topic of a material version, in order. */
  topics(version: number): string {
    return `TOPIC${SEP}${versionTag(version)}${SEP}`;
  },

  /** Access patterns 14 and 15: the whole pool, or one Difficulty_Level of it. */
  quizItems(version: number, difficulty?: DifficultyLevel): string {
    const base = `QITEM${SEP}${versionTag(version)}${SEP}`;
    if (difficulty === undefined) return base;
    if (difficulty !== 1 && difficulty !== 2 && difficulty !== 3) {
      throw new RangeError(`difficulty must be 1, 2 or 3, got ${String(difficulty)}`);
    }
    return `${base}${difficulty}${SEP}`;
  },

  /** Every retained Recap variant of a material version (purge). */
  recaps(version: number): string {
    return `RECAP${SEP}${versionTag(version)}${SEP}`;
  },

  /** Every cached misconception clarification of a material version (purge). */
  misconceptions(version: number): string {
    return `MISC${SEP}${versionTag(version)}${SEP}`;
  },

  /** The `MATERIAL#v<n>` item of one version (purge). */
  material(version: number): string {
    return `MATERIAL${SEP}${versionTag(version)}`;
  },

  /** Every Learner of the Class_Session. */
  learners(): string {
    return `LEARNER${SEP}`;
  },

  /** Every Learner_Profile in the Class_Session. */
  profiles(): string {
    return `PROFILE${SEP}`;
  },

  /** One Learner's Quiz_Sessions, or every Quiz_Session in the Class_Session. */
  quizSessions(learnerId?: string): string {
    return learnerId === undefined
      ? `QSESS${SEP}`
      : `QSESS${SEP}${component("learnerId", learnerId)}${SEP}`;
  },

  /**
   * Access pattern 18 with a Quiz_Session id: one session's responses in order.
   * Access pattern 20 without one: **every Quiz_Response in the Class_Session**,
   * the single query the Class_Understanding_Map is computed from.
   */
  responses(quizSessionId?: string): string {
    return quizSessionId === undefined
      ? `RESP${SEP}`
      : `RESP${SEP}${component("quizSessionId", quizSessionId)}${SEP}`;
  },

  /** One Learner's Understanding_Reports, or every report in the session. */
  reports(learnerId?: string): string {
    return learnerId === undefined
      ? `REPORT${SEP}`
      : `REPORT${SEP}${component("learnerId", learnerId)}${SEP}`;
  },

  /** Access pattern 23 with a Topic: one Study_Thread. Access pattern 24 without: all threads. */
  explanations(topicId?: string): string {
    return topicId === undefined
      ? `EXPL${SEP}`
      : `EXPL${SEP}${component("topicId", topicId)}${SEP}`;
  },
} as const;
