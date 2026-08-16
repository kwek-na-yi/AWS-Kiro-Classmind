import type { SourceUnit, Topic } from "@/lib/types";

/**
 * Deterministic Topic derivation.
 *
 * Topics are derived from the structure the document already carries — its
 * headings, or failing that its shape — with no generation step of any kind.
 * This module performs no I/O and makes no network call: given the same units
 * it returns the same Topics, in the same order, with the same identifiers,
 * every time.
 *
 * It serves two purposes at once. It is the testable baseline for the ingest
 * pipeline, and it is the path taken when Topic identification degrades, which
 * is why it must always succeed: Recap, Quiz and Class Insight all key off
 * Topics, so returning none would take the whole session down.
 */

export const MIN_TOPICS = 3;
export const MAX_TOPICS = 8;
export const MAX_TOPIC_NAME_CHARS = 60;

/** Roughly how many units should sit behind one Topic before adding another. */
const UNITS_PER_TOPIC = 3;

/** A line longer than this is prose, not a heading. */
const MAX_HEADING_CHARS = 80;

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

function firstNonEmptyLine(text: string): string {
  return text.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
}

/** Trims to the name budget on a word boundary where one is available. */
function trimName(name: string): string {
  const collapsed = name.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_TOPIC_NAME_CHARS) return collapsed;

  const cut = collapsed.slice(0, MAX_TOPIC_NAME_CHARS);
  const lastSpace = cut.lastIndexOf(" ");

  return (lastSpace > MAX_TOPIC_NAME_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Strips the reference decoration a section unit carries: `§ Name (a)`. */
function headingFromSectionRef(value: string): string {
  return value
    .replace(/^§\s*/, "")
    .replace(/\s*\([a-z]+\)$/, "")
    .trim();
}

/**
 * The heading a unit announces, or null when it opens with prose.
 *
 * A Markdown unit states its heading in its own reference, so that is taken as
 * authoritative. For a page or a line block the first line is treated as a
 * heading only when it reads like one — short, and not a sentence.
 */
function headingOf(unit: SourceUnit): string | null {
  if (unit.ref.kind === "section") {
    const heading = headingFromSectionRef(unit.ref.value);
    return heading.length > 0 ? trimName(heading) : null;
  }

  const first = firstNonEmptyLine(unit.text);
  if (first.length === 0 || first.length > MAX_HEADING_CHARS) return null;
  if (/[.,;:]$/.test(first)) return null;
  if (!/[A-Za-z0-9]/.test(first)) return null;

  return trimName(first);
}

/** A name from arbitrary text: its first line, or its opening words. */
function nameFromText(text: string): string {
  const line = firstNonEmptyLine(text);
  if (line.length === 0) return "";

  const candidate = line.length <= MAX_HEADING_CHARS ? line : line.split(/\s+/).slice(0, 8).join(" ");

  return trimName(candidate.replace(/[.,;:]+$/, ""));
}

function slugify(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

  return slug.length > 0 ? slug : fallback;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

interface Group {
  name: string;
  unitIdxs: number[];
}

/**
 * Groups consecutive units under the heading in force, so a heading and the
 * prose beneath it become one Topic. Units before the first heading form their
 * own group named from their own opening line.
 */
function groupByHeading(units: readonly SourceUnit[]): Group[] {
  const groups: Group[] = [];

  for (const unit of units) {
    const heading = headingOf(unit);

    if (heading === null && groups.length > 0) {
      groups[groups.length - 1].unitIdxs.push(unit.index);
      continue;
    }

    const name = heading ?? nameFromText(unit.text);
    const previous = groups[groups.length - 1];

    // A heading repeated across consecutive units — the two halves of a split
    // section — continues the same group rather than opening a new one.
    if (previous && previous.name === name) {
      previous.unitIdxs.push(unit.index);
      continue;
    }

    groups.push({ name, unitIdxs: [unit.index] });
  }

  return groups;
}

/** Merges groups sharing a name, keeping the position of the first occurrence. */
function mergeDuplicateNames(groups: Group[]): Group[] {
  const merged: Group[] = [];
  const byKey = new Map<string, Group>();

  for (const group of groups) {
    const key = group.name.toLowerCase();
    const existing = byKey.get(key);

    if (existing) {
      existing.unitIdxs.push(...group.unitIdxs);
      continue;
    }

    const copy: Group = { name: group.name, unitIdxs: [...group.unitIdxs] };
    byKey.set(key, copy);
    merged.push(copy);
  }

  return merged;
}

/** Distributes ordered groups into `count` contiguous buckets of even size. */
function bucketGroups(groups: Group[], count: number): Group[] {
  const base = Math.floor(groups.length / count);
  const remainder = groups.length % count;

  const buckets: Group[] = [];
  let cursor = 0;

  for (let i = 0; i < count; i += 1) {
    const size = base + (i < remainder ? 1 : 0);
    const slice = groups.slice(cursor, cursor + size);
    cursor += size;

    buckets.push({
      name: slice[0].name,
      unitIdxs: slice.flatMap((group) => group.unitIdxs),
    });
  }

  return buckets;
}

/**
 * Splits the material into `count` parts of roughly equal length, ignoring
 * headings entirely.
 *
 * This is the path for a document whose headings are weak, absent or too few to
 * describe it — a PDF of slides with no titles, a wall of unbroken prose. Parts
 * are cut by character position rather than by unit count, so each Topic covers
 * a comparable amount of material even when unit sizes vary. A part always
 * carries at least one unit index, including when the whole document is one
 * unit and every part points at it.
 */
function partitionByLength(units: readonly SourceUnit[], count: number): Group[] {
  const starts: number[] = [];
  let total = 0;

  for (const unit of units) {
    starts.push(total);
    total += unit.text.length;
  }

  const locate = (offset: number): number => {
    let position = 0;
    for (let i = 0; i < units.length; i += 1) {
      if (starts[i] <= offset) position = i;
    }
    return position;
  };

  const parts: Group[] = [];

  for (let part = 0; part < count; part += 1) {
    const startOffset = Math.floor((part * total) / count);
    const endOffset =
      part === count - 1 ? total : Math.floor(((part + 1) * total) / count);

    const startPosition = locate(startOffset);
    const endPosition = locate(Math.max(startOffset, endOffset - 1));

    const covered = units.slice(startPosition, endPosition + 1);
    const seed = units[startPosition].text.slice(startOffset - starts[startPosition]);

    parts.push({
      name: nameFromText(seed) || nameFromText(units[startPosition].text),
      unitIdxs: covered.map((unit) => unit.index),
    });
  }

  return parts;
}

/**
 * Makes names unique by numbering repeats.
 *
 * Used only on the fallback path: there, distinct parts of the document may
 * legitimately open with the same words, and merging them would drop the Topic
 * count below the floor the rest of the product relies on.
 */
function disambiguate(groups: Group[]): Group[] {
  const used = new Map<string, number>();

  return groups.map((group, index) => {
    const base = group.name.length > 0 ? group.name : `Part ${index + 1}`;
    const key = base.toLowerCase();
    const seen = used.get(key) ?? 0;
    used.set(key, seen + 1);

    return {
      name: seen === 0 ? base : trimName(`${base} (${seen + 1})`),
      unitIdxs: group.unitIdxs,
    };
  });
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** How many Topics a document of this size should have. */
function targetTopicCount(unitCount: number): number {
  const proportional = Math.ceil(unitCount / UNITS_PER_TOPIC);
  return Math.min(MAX_TOPICS, Math.max(MIN_TOPICS, proportional));
}

/**
 * Derives 3–8 Topics from source units.
 *
 * Headings are used when the document offers at least `MIN_TOPICS` of them;
 * otherwise the material is partitioned by length. Either way the result is
 * between 3 and 8 Topics, each carrying at least one in-range unit index, with
 * unique names and unique identifiers.
 *
 * Returns an empty list only for an empty unit set, which the caller has
 * already rejected as unprocessable.
 */
export function deriveTopics(
  units: readonly SourceUnit[],
  materialVersion?: number,
): Topic[] {
  if (units.length === 0) return [];

  const version = materialVersion ?? units[0].materialVersion;

  const headed = mergeDuplicateNames(groupByHeading(units)).filter(
    (group) => group.name.length > 0,
  );

  let groups: Group[];

  if (headed.length >= MIN_TOPICS) {
    groups =
      headed.length > MAX_TOPICS ? bucketGroups(headed, MAX_TOPICS) : headed;
  } else {
    groups = disambiguate(partitionByLength(units, targetTopicCount(units.length)));
  }

  const usedSlugs = new Set<string>();

  return groups.map((group, order) => {
    const name = trimName(group.name) || `Part ${order + 1}`;

    let topicId = slugify(name, `topic-${order + 1}`);
    if (usedSlugs.has(topicId)) {
      let suffix = 2;
      while (usedSlugs.has(`${topicId}-${suffix}`)) suffix += 1;
      topicId = `${topicId}-${suffix}`;
    }
    usedSlugs.add(topicId);

    return {
      topicId,
      materialVersion: version,
      order,
      name,
      unitIdxs: [...new Set(group.unitIdxs)].sort((a, b) => a - b),
    };
  });
}
