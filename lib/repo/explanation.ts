import "server-only";

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { ddb, tableName } from "@/lib/aws/ddb";
import { explanationSk, parseExplanationSk, prefixes, sessionPk } from "@/lib/repo/keys";
import {
  isConditionalCheckFailure,
  putItem,
  queryPrefix,
  type Item,
} from "@/lib/repo/table";
import type { PeerExplanation, SourceRef, ValidationStatus } from "@/lib/types";

/**
 * Persistence for Peer_Explanations.
 *
 * Every Peer_Explanation is retained whatever its Validation_Status — there is
 * no delete path in this module. Which explanations may be recommended is a
 * gating decision made in `lib/domain/`, over the statuses stored here.
 */

interface ExplanationItem extends Item {
  learnerId: string;
  displayName: string;
  text: string;
  status: ValidationStatus;
  sourceRef?: SourceRef;
  reason?: string;
  attempts: number;
}

/** The three components that address one Peer_Explanation item. */
export type ExplanationKey = Pick<
  PeerExplanation,
  "topicId" | "submittedAt" | "explanationId"
>;

function toExplanation(item: ExplanationItem): PeerExplanation | null {
  const parsed = parseExplanationSk(String(item.SK));
  if (!parsed) return null;

  return {
    explanationId: parsed.explanationId,
    topicId: parsed.topicId,
    submittedAt: parsed.submittedAt,
    learnerId: item.learnerId,
    displayName: item.displayName,
    text: item.text,
    status: item.status,
    sourceRef: item.sourceRef,
    reason: item.reason,
    attempts: item.attempts,
  };
}

function keyOf(sessionId: string, key: ExplanationKey) {
  return {
    PK: sessionPk(sessionId),
    SK: explanationSk(key.topicId, key.submittedAt, key.explanationId),
  };
}

/** Persists a submitted Peer_Explanation in its terminal-safe `Pending` state. */
export async function putExplanation(
  sessionId: string,
  explanation: PeerExplanation,
): Promise<void> {
  const item: ExplanationItem = {
    ...keyOf(sessionId, explanation),
    learnerId: explanation.learnerId,
    displayName: explanation.displayName,
    text: explanation.text,
    status: explanation.status,
    sourceRef: explanation.sourceRef,
    reason: explanation.reason,
    attempts: explanation.attempts,
  };

  await putItem(item);
}

/** One Study_Thread, in chronological order, from a single prefix query. */
export async function listThread(
  sessionId: string,
  topicId: string,
): Promise<PeerExplanation[]> {
  const items = await queryPrefix<ExplanationItem>(
    sessionId,
    prefixes.explanations(topicId),
  );
  return items.flatMap((item) => toExplanation(item) ?? []);
}

/** Every Peer_Explanation in the Class_Session, across all Study_Threads. */
export async function listAllExplanations(
  sessionId: string,
): Promise<PeerExplanation[]> {
  const items = await queryPrefix<ExplanationItem>(
    sessionId,
    prefixes.explanations(),
  );
  return items.flatMap((item) => toExplanation(item) ?? []);
}

/**
 * One Peer_Explanation when only its id is known, which is the shape of the
 * validation continuation route. One partition query over the session's
 * explanations, then a match in memory — never a scan.
 */
export async function findExplanationById(
  sessionId: string,
  explanationId: string,
): Promise<PeerExplanation | null> {
  const all = await listAllExplanations(sessionId);
  return all.find((item) => item.explanationId === explanationId) ?? null;
}

/**
 * Claims a Peer_Explanation for validation by incrementing `attempts` under the
 * condition that it is still zero.
 *
 * Returns false when another request has already claimed it, which is what
 * stops two concurrent readers from both paying for the same assessment.
 */
export async function claimValidation(
  sessionId: string,
  key: ExplanationKey,
): Promise<boolean> {
  try {
    await ddb().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: keyOf(sessionId, key),
        UpdateExpression: "SET #attempts = #attempts + :one",
        ConditionExpression: "attribute_exists(SK) AND #attempts = :zero",
        ExpressionAttributeNames: { "#attempts": "attempts" },
        ExpressionAttributeValues: { ":one": 1, ":zero": 0 },
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalCheckFailure(error)) return false;
    throw error;
  }
}

/**
 * Writes the outcome of validation: the assigned Validation_Status plus either
 * the supporting Source_Reference or the reason the claim was not supported.
 */
export async function resolveValidation(
  sessionId: string,
  key: ExplanationKey,
  outcome: { status: ValidationStatus; sourceRef?: SourceRef; reason?: string },
): Promise<void> {
  const sets = ["#status = :status"];
  const names: Record<string, string> = { "#status": "status" };
  const values: Record<string, unknown> = { ":status": outcome.status };

  if (outcome.sourceRef !== undefined) {
    sets.push("#sourceRef = :sourceRef");
    names["#sourceRef"] = "sourceRef";
    values[":sourceRef"] = outcome.sourceRef;
  }
  if (outcome.reason !== undefined) {
    sets.push("#reason = :reason");
    names["#reason"] = "reason";
    values[":reason"] = outcome.reason;
  }

  await ddb().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: keyOf(sessionId, key),
      UpdateExpression: `SET ${sets.join(", ")}`,
      ConditionExpression: "attribute_exists(SK)",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}
