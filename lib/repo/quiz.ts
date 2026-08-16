import "server-only";

import { TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { ddb, tableName } from "@/lib/aws/ddb";
import {
  parseResponseSk,
  prefixes,
  quizSessionSk,
  responseSk,
  sessionPk,
} from "@/lib/repo/keys";
import { getItem, putItem, queryPrefix, type Item } from "@/lib/repo/table";
import type {
  DifficultyLevel,
  QuizResponse,
  QuizSession,
  QuizSessionStatus,
  RunKind,
} from "@/lib/types";

/**
 * Persistence for Quiz_Sessions and Quiz_Responses.
 *
 * The engine's arithmetic lives in `lib/domain/difficulty.ts`: the difficulty
 * and run values written here are computed by the caller and stored as a cache
 * of the fold over the persisted responses, which remain the source of truth.
 */

interface QuizSessionItem extends Item {
  currentDifficulty: DifficultyLevel;
  runKind: RunKind;
  runLen: 0 | 1;
  servedItemIds?: string[];
  /** A DynamoDB string set, absent until the first response is recorded. */
  answeredItemIds?: Set<string> | string[];
  status: QuizSessionStatus;
  length: number;
  startedAt: string;
}

interface ResponseItem extends Item {
  learnerId: string;
  quizItemId: string;
  topicId: string;
  optionId: string;
  isCorrect: boolean;
  difficultyServed: DifficultyLevel;
  submittedAt: string;
}

function toQuizSession(
  learnerId: string,
  quizSessionId: string,
  item: QuizSessionItem,
): QuizSession {
  const answered = item.answeredItemIds;

  return {
    quizSessionId,
    learnerId,
    currentDifficulty: item.currentDifficulty,
    runKind: item.runKind,
    runLen: item.runLen,
    servedItemIds: item.servedItemIds ?? [],
    answeredItemIds: answered ? [...answered] : [],
    status: item.status,
    length: item.length,
    startedAt: item.startedAt,
  };
}

function toResponse(item: ResponseItem): QuizResponse | null {
  const parsed = parseResponseSk(String(item.SK));
  if (!parsed) return null;

  return {
    quizSessionId: parsed.quizSessionId,
    seq: parsed.seq,
    learnerId: item.learnerId,
    quizItemId: item.quizItemId,
    topicId: item.topicId,
    optionId: item.optionId,
    isCorrect: item.isCorrect,
    difficultyServed: item.difficultyServed,
    submittedAt: item.submittedAt,
  };
}

/**
 * Whether a cancelled transaction was cancelled by a failed condition rather
 * than by throttling or a conflict — the difference between "this Quiz_Item is
 * already answered" and a genuine fault that must surface.
 */
function isConditionalCancellation(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "TransactionCanceledException") {
    return false;
  }

  const reasons = (error as { CancellationReasons?: { Code?: string }[] })
    .CancellationReasons;

  return Boolean(reasons?.some((reason) => reason.Code === "ConditionalCheckFailed"));
}

// ---------------------------------------------------------------------------
// Quiz_Session
// ---------------------------------------------------------------------------

export interface NewQuizSession {
  quizSessionId: string;
  learnerId: string;
  currentDifficulty: DifficultyLevel;
  length: number;
  startedAt?: string;
}

/**
 * Opens a Quiz_Session.
 *
 * `answeredItemIds` is deliberately not written: DynamoDB cannot store an empty
 * set, and `ADD` creates the attribute on the first response. `contains` over a
 * missing attribute is false, so the first-write-wins condition still holds.
 */
export async function createQuizSession(
  sessionId: string,
  input: NewQuizSession,
): Promise<QuizSession> {
  const startedAt = input.startedAt ?? new Date().toISOString();

  const item: QuizSessionItem = {
    PK: sessionPk(sessionId),
    SK: quizSessionSk(input.learnerId, input.quizSessionId),
    currentDifficulty: input.currentDifficulty,
    runKind: "none",
    runLen: 0,
    servedItemIds: [],
    status: "in_progress",
    length: input.length,
    startedAt,
  };

  await putItem(item);

  return {
    quizSessionId: input.quizSessionId,
    learnerId: input.learnerId,
    currentDifficulty: input.currentDifficulty,
    runKind: "none",
    runLen: 0,
    servedItemIds: [],
    answeredItemIds: [],
    status: "in_progress",
    length: input.length,
    startedAt,
  };
}

/**
 * One Quiz_Session. The Learner_Id is part of the key, so a Learner cannot read
 * another Learner's Quiz_Session even by guessing its id.
 */
export async function getQuizSession(
  sessionId: string,
  learnerId: string,
  quizSessionId: string,
): Promise<QuizSession | null> {
  const item = await getItem<QuizSessionItem>(
    sessionPk(sessionId),
    quizSessionSk(learnerId, quizSessionId),
  );
  return item ? toQuizSession(learnerId, quizSessionId, item) : null;
}

/** Appends a Quiz_Item to the served list, preserving the order it was served in. */
export async function markItemServed(
  sessionId: string,
  learnerId: string,
  quizSessionId: string,
  quizItemId: string,
): Promise<void> {
  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: {
        PK: sessionPk(sessionId),
        SK: quizSessionSk(learnerId, quizSessionId),
      },
      UpdateExpression:
        "SET #servedItemIds = list_append(if_not_exists(#servedItemIds, :empty), :served)",
      ConditionExpression: "attribute_exists(SK)",
      ExpressionAttributeNames: { "#servedItemIds": "servedItemIds" },
      ExpressionAttributeValues: { ":empty": [], ":served": [quizItemId] },
    }),
  );
}

// ---------------------------------------------------------------------------
// Quiz_Response
// ---------------------------------------------------------------------------

export interface RecordResponseInput {
  response: QuizResponse;
  /** Engine state after this response, computed by `lib/domain/difficulty.ts`. */
  next: {
    currentDifficulty: DifficultyLevel;
    runKind: RunKind;
    runLen: 0 | 1;
  };
  /** True on the final response of the Quiz_Session, which closes it. */
  close?: boolean;
}

/**
 * Records a Quiz_Response and advances the Quiz_Session in one transaction.
 *
 * Returns false when the write was rejected because this Quiz_Item already has
 * a response in this Quiz_Session: the first response stands, and the caller
 * returns the existing state rather than an error, so a double-click or a
 * retried submit is harmless.
 */
export async function recordResponse(
  sessionId: string,
  input: RecordResponseInput,
): Promise<boolean> {
  const { response, next, close } = input;

  const sets = [
    "#currentDifficulty = :difficulty",
    "#runKind = :runKind",
    "#runLen = :runLen",
  ];
  const names: Record<string, string> = {
    "#currentDifficulty": "currentDifficulty",
    "#runKind": "runKind",
    "#runLen": "runLen",
    "#answeredItemIds": "answeredItemIds",
  };
  const values: Record<string, unknown> = {
    ":difficulty": next.currentDifficulty,
    ":runKind": next.runKind,
    ":runLen": next.runLen,
    ":itemId": response.quizItemId,
    ":itemIds": new Set([response.quizItemId]),
  };

  if (close) {
    sets.push("#status = :status");
    names["#status"] = "status";
    values[":status"] = "closed" satisfies QuizSessionStatus;
  }

  const responseItem: ResponseItem = {
    PK: sessionPk(sessionId),
    SK: responseSk(response.quizSessionId, response.seq),
    learnerId: response.learnerId,
    quizItemId: response.quizItemId,
    topicId: response.topicId,
    optionId: response.optionId,
    isCorrect: response.isCorrect,
    difficultyServed: response.difficultyServed,
    submittedAt: response.submittedAt,
  };

  try {
    await ddb().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName(),
              Key: {
                PK: sessionPk(sessionId),
                SK: quizSessionSk(response.learnerId, response.quizSessionId),
              },
              UpdateExpression: `SET ${sets.join(", ")} ADD #answeredItemIds :itemIds`,
              ConditionExpression:
                "attribute_exists(SK) AND NOT contains(#answeredItemIds, :itemId)",
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: values,
            },
          },
          {
            Put: {
              TableName: tableName(),
              Item: responseItem,
              ConditionExpression: "attribute_not_exists(SK)",
            },
          },
        ],
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalCancellation(error)) return false;
    throw error;
  }
}

/** One Quiz_Session's responses, in submission order. */
export async function listSessionResponses(
  sessionId: string,
  quizSessionId: string,
): Promise<QuizResponse[]> {
  const items = await queryPrefix<ResponseItem>(
    sessionId,
    prefixes.responses(quizSessionId),
  );
  return items.flatMap((item) => toResponse(item) ?? []);
}

/**
 * Every Quiz_Response in the Class_Session, from a single partition query.
 *
 * This is the one read the Class_Understanding_Map is computed from: at demo
 * scale it returns at most a few dozen rows, which is why the map can be
 * recomputed per request instead of being served from a stale aggregate.
 */
export async function listAllClassResponses(
  sessionId: string,
): Promise<QuizResponse[]> {
  const items = await queryPrefix<ResponseItem>(sessionId, prefixes.responses());
  return items.flatMap((item) => toResponse(item) ?? []);
}
