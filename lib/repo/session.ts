import "server-only";

import { TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { ddb, tableName } from "@/lib/aws/ddb";
import {
  joinCodeKey,
  learnerSk,
  metaSk,
  prefixes,
  profileSk,
  sessionPk,
} from "@/lib/repo/keys";
import {
  getItem,
  isConditionalCheckFailure,
  putItem,
  queryPrefix,
  type Item,
} from "@/lib/repo/table";
import type {
  ClassSession,
  ExplanationStyle,
  Learner,
  LearnerProfile,
  UnderstandingLevel,
} from "@/lib/types";

/**
 * Persistence for Class_Sessions, Join_Codes, Learners and Learner_Profiles.
 *
 * Persistence only: no Join_Code is generated here, no Learner_Id is minted
 * here, no token is hashed here. Callers pass values already computed, so this
 * module holds no policy and no arithmetic.
 */

// ---------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------

interface SessionItem extends Item {
  name: string;
  joinCode: string;
  instructorTokenHash: string;
  materialVersion: number;
  isDemo: boolean;
  createdAt: string;
}

interface JoinPointerItem extends Item {
  sessionId: string;
}

interface LearnerItem extends Item {
  displayName: string;
  isSeeded: boolean;
  createdAt: string;
}

interface ProfileItem extends Item {
  understandingLevel: UnderstandingLevel;
  explanationStyle: ExplanationStyle;
}

function toSession(sessionId: string, item: SessionItem): ClassSession {
  return {
    sessionId,
    name: item.name,
    joinCode: item.joinCode,
    instructorTokenHash: item.instructorTokenHash,
    materialVersion: item.materialVersion,
    isDemo: item.isDemo,
    createdAt: item.createdAt,
  };
}

function toLearner(learnerId: string, item: LearnerItem): Learner {
  return {
    learnerId,
    displayName: item.displayName,
    isSeeded: item.isSeeded,
    createdAt: item.createdAt,
  };
}

/** Raised when the Join_Code pointer already exists, so the caller can retry. */
export class JoinCodeTakenError extends Error {
  constructor(readonly joinCode: string) {
    super(`Join code ${joinCode} is already reserved`);
    this.name = "JoinCodeTakenError";
  }
}

// ---------------------------------------------------------------------------
// Class_Session
// ---------------------------------------------------------------------------

export interface NewSession {
  sessionId: string;
  name: string;
  joinCode: string;
  /** Already hashed by the caller — the plaintext token is never stored. */
  instructorTokenHash: string;
  isDemo?: boolean;
  materialVersion?: number;
  createdAt?: string;
}

/**
 * Creates a Class_Session and reserves its Join_Code in one transaction.
 *
 * The pointer put carries `attribute_not_exists(PK)`, so a Join_Code already in
 * use fails the whole write rather than silently repointing an existing code at
 * a new session. The caller regenerates and retries on `JoinCodeTakenError`.
 */
export async function createSession(input: NewSession): Promise<ClassSession> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const materialVersion = input.materialVersion ?? 0;
  const isDemo = input.isDemo ?? false;

  const meta: SessionItem = {
    PK: sessionPk(input.sessionId),
    SK: metaSk(),
    name: input.name,
    joinCode: input.joinCode,
    instructorTokenHash: input.instructorTokenHash,
    materialVersion,
    isDemo,
    createdAt,
  };

  const pointer: JoinPointerItem = {
    ...joinCodeKey(input.joinCode),
    sessionId: input.sessionId,
  };

  try {
    await ddb().send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: tableName(), Item: meta } },
          {
            Put: {
              TableName: tableName(),
              Item: pointer,
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      }),
    );
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      throw new JoinCodeTakenError(input.joinCode);
    }
    throw error;
  }

  return {
    sessionId: input.sessionId,
    name: input.name,
    joinCode: input.joinCode,
    instructorTokenHash: input.instructorTokenHash,
    materialVersion,
    isDemo,
    createdAt,
  };
}

export async function getSession(sessionId: string): Promise<ClassSession | null> {
  const item = await getItem<SessionItem>(sessionPk(sessionId), metaSk());
  return item ? toSession(sessionId, item) : null;
}

/**
 * Resolves a Join_Code to its Class_Session: one pointer lookup, then one item
 * read. Returns null when the code matches nothing.
 */
export async function resolveJoinCode(
  joinCode: string,
): Promise<ClassSession | null> {
  const key = joinCodeKey(joinCode);
  const pointer = await getItem<JoinPointerItem>(key.PK, key.SK);
  if (!pointer) return null;

  return getSession(pointer.sessionId);
}

/**
 * Points the Class_Session at a material version.
 *
 * Written last in a replacement, so a partially built version is never visible
 * to a reader: readers resolve the version from this item.
 */
export async function setMaterialVersion(
  sessionId: string,
  materialVersion: number,
): Promise<void> {
  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: sessionPk(sessionId), SK: metaSk() },
      UpdateExpression: "SET #materialVersion = :v",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeNames: { "#materialVersion": "materialVersion" },
      ExpressionAttributeValues: { ":v": materialVersion },
    }),
  );
}

// ---------------------------------------------------------------------------
// Learner
// ---------------------------------------------------------------------------

export interface NewLearner {
  learnerId: string;
  displayName: string;
  isSeeded?: boolean;
  createdAt?: string;
}

/**
 * Registers a Learner inside the Class_Session partition.
 *
 * The Learner_Id exists only as an item in this partition, which is what scopes
 * it to one Class_Session: presenting it against another session finds nothing.
 */
export async function registerLearner(
  sessionId: string,
  input: NewLearner,
): Promise<Learner> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const isSeeded = input.isSeeded ?? false;

  const item: LearnerItem = {
    PK: sessionPk(sessionId),
    SK: learnerSk(input.learnerId),
    displayName: input.displayName,
    isSeeded,
    createdAt,
  };

  await putItem(item);

  return {
    learnerId: input.learnerId,
    displayName: input.displayName,
    isSeeded,
    createdAt,
  };
}

export async function getLearner(
  sessionId: string,
  learnerId: string,
): Promise<Learner | null> {
  const item = await getItem<LearnerItem>(sessionPk(sessionId), learnerSk(learnerId));
  return item ? toLearner(learnerId, item) : null;
}

/**
 * Whether a Learner_Id belongs to this Class_Session — the membership check
 * every learner-authenticated request runs. False when the item is absent.
 */
export async function assertLearnerInSession(
  sessionId: string,
  learnerId: string,
): Promise<boolean> {
  const item = await getItem<LearnerItem>(sessionPk(sessionId), learnerSk(learnerId));
  return item !== null;
}

/** Every Learner of the Class_Session, used by seeding and by class reads. */
export async function listLearners(sessionId: string): Promise<Learner[]> {
  const items = await queryPrefix<LearnerItem>(sessionId, prefixes.learners());

  return items.map((item) => {
    const learnerId = String(item.SK).slice("LEARNER#".length);
    return toLearner(learnerId, item);
  });
}

// ---------------------------------------------------------------------------
// Learner_Profile
// ---------------------------------------------------------------------------

/** Upserts the Learner_Profile: changing a selection overwrites the previous pair. */
export async function putProfile(
  sessionId: string,
  profile: LearnerProfile,
): Promise<LearnerProfile> {
  const item: ProfileItem = {
    PK: sessionPk(sessionId),
    SK: profileSk(profile.learnerId),
    understandingLevel: profile.understandingLevel,
    explanationStyle: profile.explanationStyle,
  };

  await putItem(item);
  return profile;
}

export async function getProfile(
  sessionId: string,
  learnerId: string,
): Promise<LearnerProfile | null> {
  const item = await getItem<ProfileItem>(sessionPk(sessionId), profileSk(learnerId));
  if (!item) return null;

  return {
    learnerId,
    understandingLevel: item.understandingLevel,
    explanationStyle: item.explanationStyle,
  };
}
