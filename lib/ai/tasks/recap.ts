import type {
  GenerationFailureReason,
  LearnerProfileInput,
  RecapOutput,
  RecapSectionOutput,
} from "@/lib/ai/provider";
import { indexUnits, resolveRefs } from "@/lib/ai/resolve";
import type {
  ExplanationStyle,
  Recap,
  RecapSection,
  SourceUnit,
  Topic,
} from "@/lib/types";

/**
 * Server-side validation of a generated Recap.
 *
 * Nothing a provider returns is trusted. This module rebuilds the Recap from
 * scratch, keeping only what survives the checks, so a malformed or partial
 * response degrades into something correct rather than being persisted as-is.
 *
 * Two kinds of check, treated very differently:
 *
 * - **Grounding is a hard rule.** A section whose citations resolve to nothing
 *   is marked unverified. It is never dropped, because one section per Topic is
 *   itself a requirement — a missing section would be a worse failure than an
 *   uncited one.
 * - **Style is advisory.** A section that misses its style constraint carries a
 *   `styleWarning` and is kept. Dropping it would break the same rule.
 */

const MIN_TAKEAWAYS = 3;
const MAX_TAKEAWAYS = 7;
const CONCISE_WORD_LIMIT = 80;
const DETAILED_WORD_LIMIT = 250;

export interface RecapBuildInput {
  sessionId: string;
  materialVersion: number;
  profile: LearnerProfileInput;
  topics: readonly Topic[];
  units: readonly SourceUnit[];
  output: RecapOutput;
  /** Injectable clock, so a build is reproducible in tests. */
  now?: () => string;
}

export type RecapBuildResult =
  | { ok: true; recap: Recap; warnings: string[] }
  | { ok: false; reason: GenerationFailureReason };

function words(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/** Keeps the first sentence only, so a Key_Takeaway is a single statement. */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^(.*?[.!?])(\s|$)/.exec(trimmed);
  return (match ? match[1] : trimmed).trim();
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Key_Takeaways, reduced to single sentences and de-duplicated.
 *
 * Fewer than three surviving takeaways is treated as a schema failure rather
 * than a thin Recap: the caller then falls back to a source extract, which is a
 * more honest thing to show than a Recap missing most of its summary.
 */
function validateTakeaways(raw: readonly string[]): string[] | null {
  const takeaways: string[] = [];
  const seen = new Set<string>();

  for (const candidate of raw) {
    if (typeof candidate !== "string") continue;

    const sentence = firstSentence(candidate);
    const key = normalise(sentence);
    if (sentence.length === 0 || seen.has(key)) continue;

    seen.add(key);
    takeaways.push(sentence);

    if (takeaways.length === MAX_TAKEAWAYS) break;
  }

  return takeaways.length >= MIN_TAKEAWAYS ? takeaways : null;
}

/** The style constraint for this section, or null when it is satisfied. */
function styleWarningFor(
  style: ExplanationStyle,
  section: RecapSection,
  proseBody: string,
): string | null {
  switch (style) {
    case "Concise":
      return words(section.body) > CONCISE_WORD_LIMIT
        ? `Concise sections should be ${CONCISE_WORD_LIMIT} words or fewer.`
        : null;

    case "Detailed":
      return words(section.body) > DETAILED_WORD_LIMIT
        ? `Detailed sections should be ${DETAILED_WORD_LIMIT} words or fewer.`
        : null;

    case "Examples":
      return /worked example|for example|for instance|such as|e\.g\./i.test(section.body)
        ? null
        : "No worked example was found in this section.";

    case "Step_By_Step": {
      const steps = section.body.match(/(^|\n)\s*\d+\./g)?.length ?? 0;
      return steps >= 2 ? null : "Fewer than two numbered steps in this section.";
    }

    case "Visual_Structured": {
      if (!section.artefact) return "No table, pipeline or diagram was produced.";
      if (proseBody.trim().length === 0) {
        return "The structured artefact has no prose alternative.";
      }
      return null;
    }
  }
}

function buildSection(
  topic: Topic,
  output: RecapSectionOutput | undefined,
  units: ReadonlyMap<number, SourceUnit>,
  style: ExplanationStyle,
): { section: RecapSection; warning?: string } {
  // A Topic the provider said nothing about is reported as uncovered rather
  // than silently missing from the Recap.
  if (!output || output.covered === false || output.body?.trim().length === 0) {
    return {
      section: {
        topicId: topic.topicId,
        topicName: topic.name,
        body:
          output && output.body?.trim().length > 0
            ? output.body.trim()
            : `The lecture material does not cover ${topic.name}.`,
        sourceRefs: [],
        unverified: true,
        uncovered: true,
      },
    };
  }

  const { refs } = resolveRefs(output.unitIdxs ?? [], units);
  const proseBody = output.proseBody?.trim() ?? "";

  const section: RecapSection = {
    topicId: topic.topicId,
    topicName: topic.name,
    body: output.body.trim(),
    sourceRefs: refs,
    // Grounding is the one hard rule: no resolvable citation, no verified badge.
    unverified: refs.length === 0,
  };

  // An artefact without its prose form cannot be rendered safely, so the
  // artefact is dropped rather than the section.
  if (output.artefact && output.artefact.kind !== "none") {
    if (output.artefact.content.trim().length > 0 && proseBody.length > 0) {
      section.artefact = {
        kind: output.artefact.kind,
        content: output.artefact.content,
        prose: proseBody,
      };
    }
  }

  const warning = styleWarningFor(style, section, proseBody);
  if (warning) section.styleWarning = warning;

  return { section, warning: warning ?? undefined };
}

/**
 * Validates a provider's Recap and returns the domain object to persist.
 *
 * Exactly one section per identified Topic, in Topic order, whatever the
 * provider returned.
 */
export function buildRecap(input: RecapBuildInput): RecapBuildResult {
  const takeaways = validateTakeaways(input.output?.takeaways ?? []);
  if (!takeaways) return { ok: false, reason: "schema_invalid_after_repair" };

  if (input.topics.length === 0) return { ok: false, reason: "unresolvable_citation" };

  const units = indexUnits(input.units);
  const byTopic = new Map<string, RecapSectionOutput>();

  for (const section of input.output.sections ?? []) {
    if (section && typeof section.topicId === "string" && !byTopic.has(section.topicId)) {
      byTopic.set(section.topicId, section);
    }
  }

  const sections: RecapSection[] = [];
  const warnings: string[] = [];

  for (const topic of [...input.topics].sort((a, b) => a.order - b.order)) {
    const built = buildSection(
      topic,
      byTopic.get(topic.topicId),
      units,
      input.profile.explanationStyle,
    );

    sections.push(built.section);
    if (built.warning) warnings.push(`${topic.topicId}: ${built.warning}`);
  }

  // A Recap where nothing at all resolved is not a Recap: it would carry no
  // Source_Reference anywhere, which is the one condition grounding forbids.
  if (sections.every((section) => section.sourceRefs.length === 0)) {
    return { ok: false, reason: "unresolvable_citation" };
  }

  return {
    ok: true,
    warnings,
    recap: {
      sessionId: input.sessionId,
      materialVersion: input.materialVersion,
      understandingLevel: input.profile.understandingLevel,
      explanationStyle: input.profile.explanationStyle,
      mode: "generated",
      takeaways,
      sections,
      generatedAt: (input.now ?? (() => new Date().toISOString()))(),
    },
  };
}

export interface FallbackRecapInput {
  sessionId: string;
  materialVersion: number;
  profile: LearnerProfileInput;
  topics: readonly Topic[];
  units: readonly SourceUnit[];
  now?: () => string;
}

/** Source units per Topic in the fallback extract. */
const FALLBACK_UNITS_PER_TOPIC = 3;

/**
 * The Fallback_Mode Recap: the source itself, quoted.
 *
 * Two to three of each Topic's units verbatim, labelled as a source extract
 * rather than a Recap. Artefacts are suppressed even under Visual_Structured —
 * a diagram is a claim about structure, and the fallback exists precisely
 * because nothing is available to make claims.
 *
 * This is never written to the Recap cache, so a later successful generation
 * still populates it.
 */
export function buildFallbackRecap(input: FallbackRecapInput): Recap {
  const units = indexUnits(input.units);

  const sections: RecapSection[] = [...input.topics]
    .sort((a, b) => a.order - b.order)
    .map((topic) => {
      const cited = topic.unitIdxs
        .filter((index) => units.has(index))
        .slice(0, FALLBACK_UNITS_PER_TOPIC);

      const body = cited
        .map((index) => (units.get(index) as SourceUnit).text.trim())
        .filter((text) => text.length > 0)
        .join("\n\n");

      const { refs } = resolveRefs(cited, units);

      return {
        topicId: topic.topicId,
        topicName: topic.name,
        body:
          body.length > 0
            ? body
            : `The lecture material does not cover ${topic.name}.`,
        sourceRefs: refs,
        unverified: refs.length === 0,
        uncovered: body.length === 0 ? true : undefined,
      };
    });

  const takeaways = sections
    .filter((section) => !section.uncovered)
    .slice(0, MAX_TAKEAWAYS)
    .map(
      (section) =>
        `${section.topicName}: see ${section.sourceRefs[0]?.value ?? "the lecture material"}.`,
    );

  return {
    sessionId: input.sessionId,
    materialVersion: input.materialVersion,
    understandingLevel: input.profile.understandingLevel,
    explanationStyle: input.profile.explanationStyle,
    mode: "source_extract",
    takeaways,
    sections,
    generatedAt: (input.now ?? (() => new Date().toISOString()))(),
  };
}
