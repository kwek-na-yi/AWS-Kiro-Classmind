import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CLASS_MAP_FIELDS,
  MISCONCEPTION_FIELDS,
  projectClassMap,
  projectClassMapEntry,
  projectMisconception,
  projectMisconceptions,
} from "@/lib/domain/anonymise";
import type { ClassMapEntry } from "@/lib/domain/classmap";

/** Every string appearing anywhere in a serialised value, at any depth. */
function allStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) allStrings(entry, found);
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      found.push(key);
      allStrings(entry, found);
    }
  } else if (value !== undefined && value !== null) {
    found.push(String(value));
  }

  return found;
}

const published = (overrides: Partial<ClassMapEntry> = {}): ClassMapEntry =>
  ({
    topicId: "t1",
    topicName: "Normalisation",
    status: "published",
    classMastery: 62,
    band: "developing",
    bandLabel: "Developing",
    respondingLearners: 5,
    answered: 13,
    correct: 8,
    ...overrides,
  }) as ClassMapEntry;

const suppressed: ClassMapEntry = {
  topicId: "t2",
  topicName: "Indexing",
  status: "insufficient-data",
};

describe("the Class_Understanding_Map projection", () => {
  it("emits only allow-listed keys for a published row", () => {
    const projected = projectClassMapEntry(published());

    expect(Object.keys(projected).every((key) => CLASS_MAP_FIELDS.includes(key as never))).toBe(
      true,
    );
    expect(projected).toEqual({
      topicId: "t1",
      topicName: "Normalisation",
      status: "published",
      classMastery: 62,
      band: "developing",
      bandLabel: "Developing",
      respondingLearners: 5,
    });
  });

  it("drops the raw aggregate counts", () => {
    const projected = projectClassMapEntry(published());

    expect(projected).not.toHaveProperty("answered");
    expect(projected).not.toHaveProperty("correct");
  });

  it("emits three keys and no measurement for a suppressed row", () => {
    expect(projectClassMapEntry(suppressed)).toEqual({
      topicId: "t2",
      topicName: "Indexing",
      status: "insufficient-data",
    });
  });

  it("cannot carry a field that was never allow-listed", () => {
    // A field added upstream later must not reach the client structurally.
    const tainted = {
      ...published(),
      learnerId: "learner-abc123",
      displayName: "Ada Lovelace",
      submittedAt: "2026-01-01T10:00:00.000Z",
      responses: [{ learnerId: "learner-abc123", isCorrect: true }],
    } as unknown as ClassMapEntry;

    const projected = projectClassMapEntry(tainted);

    expect(projected).not.toHaveProperty("learnerId");
    expect(projected).not.toHaveProperty("displayName");
    expect(projected).not.toHaveProperty("submittedAt");
    expect(projected).not.toHaveProperty("responses");
  });

  it("returns a new object sharing no reference with its input", () => {
    const entry = published();
    const projected = projectClassMapEntry(entry);

    expect(projected).not.toBe(entry);
  });

  it("projects a whole map", () => {
    const projected = projectClassMap([published(), suppressed]);

    expect(projected).toHaveLength(2);
    expect(projected[1].status).toBe("insufficient-data");
  });
});

describe("the Misconception_Report projection", () => {
  it("emits only allow-listed keys", () => {
    const projected = projectMisconception({
      topicId: "t1",
      topicName: "Normalisation",
      sharePercent: 45,
      misconceptionLabel: "Confuses 2NF with 3NF",
      clarification: "Second normal form removes partial dependencies.",
      sourceRef: { kind: "page", value: "p. 4" },
    });

    expect(
      Object.keys(projected).every((key) => MISCONCEPTION_FIELDS.includes(key as never)),
    ).toBe(true);
    expect(projected.sourceRef).toEqual({ kind: "page", value: "p. 4" });
  });

  it("omits the optional keys entirely when absent", () => {
    const projected = projectMisconception({
      topicId: "t1",
      topicName: "Normalisation",
      sharePercent: 45,
      misconceptionLabel: "Confuses 2NF with 3NF",
    });

    expect(Object.keys(projected).sort()).toEqual([
      "misconceptionLabel",
      "sharePercent",
      "topicId",
      "topicName",
    ]);
  });

  it("rebuilds the Source_Reference rather than passing it through", () => {
    const sourceRef = {
      kind: "page" as const,
      value: "p. 4",
      learnerId: "learner-abc123",
    };

    const projected = projectMisconception({
      topicId: "t1",
      topicName: "Normalisation",
      sharePercent: 45,
      misconceptionLabel: "Label",
      sourceRef,
    });

    expect(projected.sourceRef).toEqual({ kind: "page", value: "p. 4" });
    expect(projected.sourceRef).not.toBe(sourceRef);
    expect(projected.sourceRef).not.toHaveProperty("learnerId");
  });

  it("projects a whole list", () => {
    const projected = projectMisconceptions([
      { topicId: "t1", topicName: "A", sharePercent: 40, misconceptionLabel: "L1" },
      { topicId: "t2", topicName: "B", sharePercent: 30, misconceptionLabel: "L2" },
    ]);

    expect(projected.map((entry) => entry.topicId)).toEqual(["t1", "t2"]);
  });
});

describe("Property 14: identifier absence", () => {
  const taintArb = fc.record({
    learnerId: fc.string({ minLength: 8, maxLength: 20 }).map((s) => `learner-${s}`),
    displayName: fc.string({ minLength: 3, maxLength: 20 }).map((s) => `Name ${s}`),
    submittedAt: fc.date().map((d) => d.toISOString()),
  });

  it("lets no Learner_Id, Display_Name or timestamp through the map projection", () => {
    fc.assert(
      fc.property(taintArb, fc.integer({ min: 0, max: 100 }), (taint, mastery) => {
        const tainted = {
          ...published({ classMastery: mastery }),
          ...taint,
          rows: [{ ...taint, isCorrect: true }],
        } as unknown as ClassMapEntry;

        const serialised = JSON.stringify(projectClassMapEntry(tainted));
        const strings = allStrings(JSON.parse(serialised));

        expect(strings).not.toContain(taint.learnerId);
        expect(strings).not.toContain(taint.displayName);
        expect(strings).not.toContain(taint.submittedAt);
        expect(serialised).not.toContain(taint.learnerId);
        expect(serialised).not.toContain(taint.displayName);
      }),
    );
  });

  it("lets none through the misconception projection either", () => {
    fc.assert(
      fc.property(taintArb, (taint) => {
        const tainted = {
          topicId: "t1",
          topicName: "Normalisation",
          sharePercent: 40,
          misconceptionLabel: "Belief",
          ...taint,
          sourceRef: { kind: "page" as const, value: "p. 1", ...taint },
        };

        const serialised = JSON.stringify(projectMisconception(tainted));

        expect(serialised).not.toContain(taint.learnerId);
        expect(serialised).not.toContain(taint.displayName);
        expect(serialised).not.toContain(taint.submittedAt);
      }),
    );
  });

  it("keeps the output key set inside the allow-list at every depth", () => {
    fc.assert(
      fc.property(taintArb, (taint) => {
        const entry = projectClassMapEntry({
          ...published(),
          ...taint,
        } as unknown as ClassMapEntry);

        for (const key of Object.keys(entry)) {
          expect(CLASS_MAP_FIELDS).toContain(key);
        }

        const report = projectMisconception({
          topicId: "t1",
          topicName: "N",
          sharePercent: 40,
          misconceptionLabel: "Belief",
          sourceRef: { kind: "lines", value: "lines 1–4" },
          ...taint,
        });

        for (const key of Object.keys(report)) {
          expect(MISCONCEPTION_FIELDS).toContain(key);
        }

        for (const key of Object.keys(report.sourceRef ?? {})) {
          expect(["kind", "value"]).toContain(key);
        }
      }),
    );
  });
});
