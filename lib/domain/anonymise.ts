import type { ClassMapEntry } from "@/lib/domain/classmap";
import type { SourceRef } from "@/lib/types";

/**
 * The anonymisation allow-list.
 *
 * Every class-level response is **constructed** here from permitted fields,
 * rather than being produced by deleting fields from a Learner-level object.
 * The difference matters: a deny-list silently leaks whatever field someone adds
 * upstream later, while an allow-list cannot pass through a field nobody wrote
 * down here. A Learner_Id, a Display_Name, a timestamp or an individual response
 * row therefore cannot reach a class-level response structurally, not merely by
 * convention.
 *
 * Pure and free of I/O; every function returns fresh objects that share no
 * reference with their input.
 */

/** Exactly the keys a Class_Understanding_Map row may expose. */
export const CLASS_MAP_FIELDS = [
  "topicId",
  "topicName",
  "status",
  "classMastery",
  "band",
  "bandLabel",
  "respondingLearners",
] as const;

/** Exactly the keys a Misconception_Report may expose. */
export const MISCONCEPTION_FIELDS = [
  "topicId",
  "topicName",
  "sharePercent",
  "misconceptionLabel",
  "clarification",
  "sourceRef",
] as const;

export interface AnonymousClassMapEntry {
  topicId: string;
  topicName: string;
  status: "published" | "insufficient-data";
  classMastery?: number;
  band?: string;
  bandLabel?: string;
  respondingLearners?: number;
}

export interface AnonymousMisconception {
  topicId: string;
  topicName: string;
  sharePercent: number;
  misconceptionLabel: string;
  clarification?: string;
  sourceRef?: SourceRef;
}

/** What a Misconception_Report is assembled from before projection. */
export interface MisconceptionInput {
  topicId: string;
  topicName: string;
  sharePercent: number;
  misconceptionLabel: string;
  clarification?: string;
  sourceRef?: SourceRef;
}

/**
 * Projects one Class_Understanding_Map row.
 *
 * A suppressed row yields three fields and nothing else — no percentage, no
 * band, no responding-learner count — so the absence of the value is what the
 * client receives, not a value it is trusted to hide.
 */
export function projectClassMapEntry(entry: ClassMapEntry): AnonymousClassMapEntry {
  if (entry.status === "insufficient-data") {
    return {
      topicId: entry.topicId,
      topicName: entry.topicName,
      status: "insufficient-data",
    };
  }

  return {
    topicId: entry.topicId,
    topicName: entry.topicName,
    status: "published",
    classMastery: entry.classMastery,
    band: entry.band,
    bandLabel: entry.bandLabel,
    respondingLearners: entry.respondingLearners,
  };
}

export function projectClassMap(
  entries: readonly ClassMapEntry[],
): AnonymousClassMapEntry[] {
  return entries.map(projectClassMapEntry);
}

/**
 * Projects one Misconception_Report.
 *
 * The Source_Reference is rebuilt field by field rather than passed along, so a
 * reference object carrying anything extra cannot smuggle it through.
 */
export function projectMisconception(
  input: MisconceptionInput,
): AnonymousMisconception {
  const projected: AnonymousMisconception = {
    topicId: input.topicId,
    topicName: input.topicName,
    sharePercent: input.sharePercent,
    misconceptionLabel: input.misconceptionLabel,
  };

  if (input.clarification !== undefined) {
    projected.clarification = input.clarification;
  }

  if (input.sourceRef !== undefined) {
    projected.sourceRef = {
      kind: input.sourceRef.kind,
      value: input.sourceRef.value,
    };
  }

  return projected;
}

export function projectMisconceptions(
  inputs: readonly MisconceptionInput[],
): AnonymousMisconception[] {
  return inputs.map(projectMisconception);
}
