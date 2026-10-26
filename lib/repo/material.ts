import "server-only";

import {
  materialSk,
  parseTopicSk,
  parseUnitSk,
  prefixes,
  recapSk,
  sessionPk,
  topicSk,
  unitSk,
} from "@/lib/repo/keys";
import {
  deleteAll,
  getItem,
  isConditionalCheckFailure,
  putAll,
  putItem,
  queryPrefix,
  updateItem,
  type Item,
} from "@/lib/repo/table";
import type {
  ExplanationStyle,
  LectureMaterial,
  MaterialExtension,
  MaterialStatus,
  PoolStatus,
  ProcessingStage,
  Recap,
  RecapSection,
  SourceRef,
  SourceUnit,
  Topic,
  UnderstandingLevel,
} from "@/lib/types";

/**
 * Persistence for the Lecture_Material record, its extracted source units, its
 * Topics and the retained Recap variants — everything keyed by material version.
 *
 * No extraction, no segmentation and no Topic derivation happens here; those are
 * pure functions in `lib/ingest/`. This module stores what they produce.
 */

// ---------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------

interface MaterialItem extends Item {
  s3Key: string;
  filename: string;
  ext: MaterialExtension;
  bytes: number;
  status: MaterialStatus;
  stage: ProcessingStage;
  charCount: number;
  unitCount: number;
  poolStatus: PoolStatus;
}

interface UnitItem extends Item {
  text: string;
  refKind: SourceRef["kind"];
  refValue: string;
}

interface TopicItem extends Item {
  name: string;
  unitIdxs: number[];
}

interface RecapItem extends Item {
  takeaways: string[];
  sections: RecapSection[];
  mode: Recap["mode"];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Lecture_Material
// ---------------------------------------------------------------------------

function materialKey(sessionId: string, version: number) {
  return { PK: sessionPk(sessionId), SK: materialSk(version) };
}

export async function putMaterial(
  sessionId: string,
  material: LectureMaterial,
): Promise<void> {
  const item: MaterialItem = {
    PK: sessionPk(sessionId),
    SK: materialSk(material.version),
    s3Key: material.s3Key,
    filename: material.filename,
    ext: material.ext,
    bytes: material.bytes,
    status: material.status,
    stage: material.stage,
    charCount: material.charCount,
    unitCount: material.unitCount,
    poolStatus: material.poolStatus,
  };

  await putItem(item);
}

export async function getMaterial(
  sessionId: string,
  version: number,
): Promise<LectureMaterial | null> {
  const item = await getItem<MaterialItem>(sessionPk(sessionId), materialSk(version));
  if (!item) return null;

  return {
    sessionId,
    version,
    s3Key: item.s3Key,
    filename: item.filename,
    ext: item.ext,
    bytes: item.bytes,
    status: item.status,
    stage: item.stage,
    charCount: item.charCount,
    unitCount: item.unitCount,
    poolStatus: item.poolStatus,
  };
}

/** Advances the named processing stage the client polls for. */
export async function setMaterialStage(
  sessionId: string,
  version: number,
  stage: ProcessingStage,
): Promise<void> {
  await updateItem(materialKey(sessionId, version), { set: { stage } });
}

/** Records the outcome of extraction: status plus the measured counts. */
export async function setMaterialStatus(
  sessionId: string,
  version: number,
  update: {
    status: MaterialStatus;
    stage?: ProcessingStage;
    charCount?: number;
    unitCount?: number;
  },
): Promise<void> {
  const set: Record<string, unknown> = { status: update.status };
  if (update.stage !== undefined) set.stage = update.stage;
  if (update.charCount !== undefined) set.charCount = update.charCount;
  if (update.unitCount !== undefined) set.unitCount = update.unitCount;

  await updateItem(materialKey(sessionId, version), { set });
}

/**
 * Moves `poolStatus` only when it currently holds `from`, returning false when
 * it does not.
 *
 * This conditional transition is what makes Quiz_Pool generation idempotent: two
 * callers racing to generate the pool both attempt the same move and exactly one
 * wins, so the pool cannot be generated twice.
 */
export async function transitionPoolStatus(
  sessionId: string,
  version: number,
  transition: { from: PoolStatus; to: PoolStatus },
): Promise<boolean> {
  try {
    await updateItem(
      materialKey(sessionId, version),
      { set: { poolStatus: transition.to } },
      { equals: { poolStatus: transition.from } },
    );
    return true;
  } catch (error) {
    if (isConditionalCheckFailure(error)) return false;
    throw error;
  }
}

/** Sets `poolStatus` unconditionally, for the terminal outcome of generation. */
export async function setPoolStatus(
  sessionId: string,
  version: number,
  poolStatus: PoolStatus,
): Promise<void> {
  await updateItem(materialKey(sessionId, version), { set: { poolStatus } });
}

// ---------------------------------------------------------------------------
// Source units
// ---------------------------------------------------------------------------

/** Persists every source unit of a material version, chunked into batches of 25. */
export async function putSourceUnits(
  sessionId: string,
  units: readonly SourceUnit[],
): Promise<void> {
  const items: UnitItem[] = units.map((unit) => ({
    PK: sessionPk(sessionId),
    SK: unitSk(unit.materialVersion, unit.index),
    text: unit.text,
    refKind: unit.ref.kind,
    refValue: unit.ref.value,
  }));

  await putAll(items);
}

/** Every source unit of a material version, in ascending index order. */
export async function listSourceUnits(
  sessionId: string,
  version: number,
): Promise<SourceUnit[]> {
  const items = await queryPrefix<UnitItem>(sessionId, prefixes.units(version));

  return items.flatMap((item) => {
    const parsed = parseUnitSk(String(item.SK));
    if (!parsed) return [];

    return [
      {
        materialVersion: parsed.version,
        index: parsed.index,
        text: item.text,
        ref: { kind: item.refKind, value: item.refValue },
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

/** Persists the Topic set of a material version, chunked into batches of 25. */
export async function putTopics(
  sessionId: string,
  topics: readonly Topic[],
): Promise<void> {
  const items: TopicItem[] = topics.map((topic) => ({
    PK: sessionPk(sessionId),
    SK: topicSk(topic.materialVersion, topic.order, topic.topicId),
    name: topic.name,
    unitIdxs: topic.unitIdxs,
  }));

  await putAll(items);
}

/** Every Topic of a material version, in the persisted order. */
export async function listTopics(
  sessionId: string,
  version: number,
): Promise<Topic[]> {
  const items = await queryPrefix<TopicItem>(sessionId, prefixes.topics(version));

  return items.flatMap((item) => {
    const parsed = parseTopicSk(String(item.SK));
    if (!parsed) return [];

    return [
      {
        topicId: parsed.topicId,
        materialVersion: parsed.version,
        order: parsed.order,
        name: item.name,
        unitIdxs: item.unitIdxs,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Retained Recap variants
// ---------------------------------------------------------------------------

/**
 * The retained Recap for one profile combination, or null on a cache miss.
 *
 * The key is a total function of (Class_Session, material version,
 * Understanding_Level, Explanation_Style), so one combination can never resolve
 * to two different Recaps.
 */
export async function getRecap(
  sessionId: string,
  version: number,
  understandingLevel: UnderstandingLevel,
  explanationStyle: ExplanationStyle,
): Promise<Recap | null> {
  const item = await getItem<RecapItem>(
    sessionPk(sessionId),
    recapSk(version, understandingLevel, explanationStyle),
  );
  if (!item) return null;

  return {
    sessionId,
    materialVersion: version,
    understandingLevel,
    explanationStyle,
    mode: item.mode,
    takeaways: item.takeaways,
    sections: item.sections,
    generatedAt: item.generatedAt,
  };
}

/** Retains a generated Recap under its profile-combination key. */
export async function putRecap(recap: Recap): Promise<void> {
  const item: RecapItem = {
    PK: sessionPk(recap.sessionId),
    SK: recapSk(
      recap.materialVersion,
      recap.understandingLevel,
      recap.explanationStyle,
    ),
    takeaways: recap.takeaways,
    sections: recap.sections,
    mode: recap.mode,
    generatedAt: recap.generatedAt,
  };

  await putItem(item);
}

/**
 * Removes everything derived from one Lecture_Material version: the Quiz_Pool,
 * every retained Recap variant and every cached misconception clarification.
 *
 * The material record, its source units and its Topics are left in place — they
 * are rewritten by key, so they replace themselves.
 *
 * This is what makes regeneration idempotent. A Quiz_Item's id is derived from
 * its own text, so regenerating a pool from changed source text produces items
 * under *new* keys and the previous generation stays behind: the pool grows on
 * every run, and a Learner can be served a question built from source text that
 * no longer exists. The same applies to a retained Recap, which would otherwise
 * keep serving prose grounded in the superseded extraction.
 */
export async function purgeGeneratedForVersion(
  sessionId: string,
  version: number,
): Promise<number> {
  const groups = [
    prefixes.quizItems(version),
    prefixes.recaps(version),
    prefixes.misconceptions(version),
  ];

  const keys: { PK: string; SK: string }[] = [];

  for (const prefix of groups) {
    for (const item of await queryPrefix(sessionId, prefix)) {
      keys.push({ PK: String(item.PK), SK: String(item.SK) });
    }
  }

  if (keys.length > 0) await deleteAll(keys);

  return keys.length;
}
