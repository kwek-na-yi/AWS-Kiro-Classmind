import { describe, expect, it } from "vitest";

import type { RecapOutput, RecapSectionOutput } from "@/lib/ai/provider";
import { buildFallbackRecap, buildRecap } from "@/lib/ai/tasks/recap";
import type { ExplanationStyle, SourceUnit, Topic } from "@/lib/types";

const UNITS: SourceUnit[] = [
  {
    materialVersion: 1,
    index: 0,
    text: "Normalisation removes redundancy from a relational schema.",
    ref: { kind: "page", value: "p. 1" },
  },
  {
    materialVersion: 1,
    index: 1,
    text: "An index speeds up reads and slows down writes.",
    ref: { kind: "page", value: "p. 2" },
  },
];

const TOPICS: Topic[] = [
  { topicId: "alpha", materialVersion: 1, order: 0, name: "Alpha", unitIdxs: [0] },
  { topicId: "beta", materialVersion: 1, order: 1, name: "Beta", unitIdxs: [1] },
];

const NOW = () => "2026-01-01T00:00:00.000Z";

function section(overrides: Partial<RecapSectionOutput> = {}): RecapSectionOutput {
  return {
    topicId: "alpha",
    covered: true,
    body: "Normalisation removes redundancy from a relational schema.",
    proseBody: "Normalisation removes redundancy from a relational schema.",
    artefact: { kind: "none", content: "" },
    unitIdxs: [0],
    ...overrides,
  };
}

function output(overrides: Partial<RecapOutput> = {}): RecapOutput {
  return {
    takeaways: ["First takeaway.", "Second takeaway.", "Third takeaway."],
    sections: [section(), section({ topicId: "beta", unitIdxs: [1] })],
    ...overrides,
  };
}

function build(
  recapOutput: RecapOutput,
  explanationStyle: ExplanationStyle = "Detailed",
  topics: Topic[] = TOPICS,
) {
  return buildRecap({
    sessionId: "cs_1",
    materialVersion: 1,
    profile: { understandingLevel: "Basic_Understanding", explanationStyle },
    topics,
    units: UNITS,
    output: recapOutput,
    now: NOW,
  });
}

describe("a valid Recap", () => {
  it("builds the domain object with resolved references", () => {
    const result = build(output());
    if (!result.ok) throw new Error(`expected success, got ${result.reason}`);

    expect(result.recap.mode).toBe("generated");
    expect(result.recap.sessionId).toBe("cs_1");
    expect(result.recap.generatedAt).toBe(NOW());
    expect(result.recap.sections).toHaveLength(2);
    expect(result.recap.sections[0].sourceRefs).toEqual([
      { kind: "page", value: "p. 1" },
    ]);
    expect(result.recap.sections[0].unverified).toBe(false);
  });

  it("returns one section per Topic, in Topic order", () => {
    const reordered = output({
      sections: [section({ topicId: "beta", unitIdxs: [1] }), section()],
    });

    const result = build(reordered);
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections.map((entry) => entry.topicId)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("carries the Topic name from the persisted Topic, not the provider", () => {
    const result = build(output());
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections.map((entry) => entry.topicName)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });
});

describe("Key_Takeaways", () => {
  it("reduces a multi-sentence takeaway to its first sentence", () => {
    const result = build(
      output({
        takeaways: ["One. Two. Three.", "Second takeaway.", "Third takeaway."],
      }),
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.takeaways[0]).toBe("One.");
  });

  it("caps at seven", () => {
    const result = build(
      output({
        takeaways: Array.from({ length: 12 }, (_, i) => `Takeaway number ${i}.`),
      }),
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.takeaways).toHaveLength(7);
  });

  it("drops duplicates and blanks", () => {
    const result = build(
      output({
        takeaways: ["Same one.", "same ONE.", "  ", "Second.", "Third.", "Fourth."],
      }),
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.takeaways).toEqual([
      "Same one.",
      "Second.",
      "Third.",
      "Fourth.",
    ]);
  });

  it("fails when fewer than three survive", () => {
    expect(build(output({ takeaways: ["Only one."] }))).toEqual({
      ok: false,
      reason: "schema_invalid_after_repair",
    });

    expect(build(output({ takeaways: [] }))).toEqual({
      ok: false,
      reason: "schema_invalid_after_repair",
    });
  });
});

describe("grounding", () => {
  it("marks a section with no resolvable citation as unverified, keeping it", () => {
    const result = build(
      output({
        sections: [
          section({ unitIdxs: [99] }),
          section({ topicId: "beta", unitIdxs: [1] }),
        ],
      }),
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections[0].unverified).toBe(true);
    expect(result.recap.sections[0].sourceRefs).toEqual([]);
    expect(result.recap.sections).toHaveLength(2);
  });

  it("keeps only the resolvable half of a mixed citation list", () => {
    const result = build(
      output({ sections: [section({ unitIdxs: [0, 99] }), section({ topicId: "beta" })] }),
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections[0].sourceRefs).toEqual([
      { kind: "page", value: "p. 1" },
    ]);
  });

  it("fails when nothing in the whole Recap resolves", () => {
    const result = build(
      output({
        sections: [
          section({ unitIdxs: [98] }),
          section({ topicId: "beta", unitIdxs: [99] }),
        ],
      }),
    );

    expect(result).toEqual({ ok: false, reason: "unresolvable_citation" });
  });

  it("fails when there are no Topics to build sections for", () => {
    expect(build(output(), "Detailed", [])).toEqual({
      ok: false,
      reason: "unresolvable_citation",
    });
  });
});

describe("uncovered Topics", () => {
  it("reports a Topic the provider omitted", () => {
    const result = build(output({ sections: [section()] }));
    if (!result.ok) throw new Error("expected success");

    const beta = result.recap.sections[1];
    expect(beta.uncovered).toBe(true);
    expect(beta.unverified).toBe(true);
    expect(beta.body).toMatch(/does not cover Beta/);
  });

  it("respects a section the provider itself marked uncovered", () => {
    const result = build(
      output({
        sections: [
          section(),
          section({ topicId: "beta", covered: false, body: "Not in the material." }),
        ],
      }),
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections[1].uncovered).toBe(true);
    expect(result.recap.sections[1].body).toBe("Not in the material.");
  });
});

describe("style post-checks", () => {
  it("warns rather than dropping when Concise runs long", () => {
    const long = Array.from({ length: 120 }, () => "word").join(" ");
    const result = build(
      output({ sections: [section({ body: long }), section({ topicId: "beta" })] }),
      "Concise",
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections[0].styleWarning).toMatch(/80 words/);
    expect(result.recap.sections).toHaveLength(2);
    expect(result.warnings[0]).toContain("alpha");
  });

  it("warns when Detailed runs past 250 words", () => {
    const long = Array.from({ length: 300 }, () => "word").join(" ");
    const result = build(
      output({ sections: [section({ body: long }), section({ topicId: "beta" })] }),
      "Detailed",
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections[0].styleWarning).toMatch(/250 words/);
  });

  it("warns when Examples has no example marker", () => {
    const result = build(output(), "Examples");
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections[0].styleWarning).toMatch(/worked example/i);
  });

  it("accepts an Examples section that carries a marker", () => {
    const result = build(
      output({
        sections: [
          section({ body: "Worked example: normalisation splits a table." }),
          section({ topicId: "beta" }),
        ],
      }),
      "Examples",
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections[0].styleWarning).toBeUndefined();
  });

  it("warns when Step_By_Step has fewer than two numbered steps", () => {
    const result = build(
      output({ sections: [section({ body: "1. Only one step." }), section({ topicId: "beta" })] }),
      "Step_By_Step",
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections[0].styleWarning).toMatch(/two numbered steps/);
  });

  it("accepts two numbered steps", () => {
    const result = build(
      output({
        sections: [
          section({ body: "1. First step.\n2. Second step." }),
          section({ topicId: "beta" }),
        ],
      }),
      "Step_By_Step",
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections[0].styleWarning).toBeUndefined();
  });

  it("keeps a Visual_Structured artefact only when prose accompanies it", () => {
    const withProse = build(
      output({
        sections: [
          section({
            artefact: { kind: "table", content: "| a | b |" },
            proseBody: "The prose form.",
          }),
          section({ topicId: "beta" }),
        ],
      }),
      "Visual_Structured",
    );
    if (!withProse.ok) throw new Error("expected success");

    expect(withProse.recap.sections[0].artefact).toEqual({
      kind: "table",
      content: "| a | b |",
      prose: "The prose form.",
    });

    const withoutProse = build(
      output({
        sections: [
          section({ artefact: { kind: "table", content: "| a | b |" }, proseBody: "" }),
          section({ topicId: "beta" }),
        ],
      }),
      "Visual_Structured",
    );
    if (!withoutProse.ok) throw new Error("expected success");

    // The artefact is dropped, the section is kept, and the miss is flagged.
    expect(withoutProse.recap.sections[0].artefact).toBeUndefined();
    expect(withoutProse.recap.sections[0].styleWarning).toBeTruthy();
  });
});

describe("malformed provider output", () => {
  it("does not throw on missing fields", () => {
    const result = buildRecap({
      sessionId: "cs_1",
      materialVersion: 1,
      profile: {
        understandingLevel: "Basic_Understanding",
        explanationStyle: "Detailed",
      },
      topics: TOPICS,
      units: UNITS,
      output: {} as RecapOutput,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "schema_invalid_after_repair" });
  });

  it("ignores sections naming an unknown Topic", () => {
    const result = build(
      output({
        sections: [
          section(),
          section({ topicId: "ghost" }),
          section({ topicId: "beta", unitIdxs: [1] }),
        ],
      }),
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections.map((entry) => entry.topicId)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("takes the first section when a Topic appears twice", () => {
    const result = build(
      output({
        sections: [
          section({ body: "First body." }),
          section({ body: "Second body." }),
          section({ topicId: "beta", unitIdxs: [1] }),
        ],
      }),
    );
    if (!result.ok) throw new Error("expected success");

    expect(result.recap.sections[0].body).toBe("First body.");
  });
});

describe("the Fallback_Mode source extract", () => {
  const fallback = buildFallbackRecap({
    sessionId: "cs_1",
    materialVersion: 1,
    profile: {
      understandingLevel: "Basic_Understanding",
      explanationStyle: "Visual_Structured",
    },
    topics: TOPICS,
    units: UNITS,
    now: NOW,
  });

  it("is labelled a source extract, not a Recap", () => {
    expect(fallback.mode).toBe("source_extract");
  });

  it("quotes the source units verbatim with their real references", () => {
    expect(fallback.sections[0].body).toBe(UNITS[0].text);
    expect(fallback.sections[0].sourceRefs).toEqual([{ kind: "page", value: "p. 1" }]);
  });

  it("suppresses artefacts even under Visual_Structured", () => {
    for (const entry of fallback.sections) {
      expect(entry.artefact).toBeUndefined();
    }
  });

  it("covers every Topic", () => {
    expect(fallback.sections.map((entry) => entry.topicId)).toEqual(["alpha", "beta"]);
    expect(fallback.takeaways.length).toBeGreaterThan(0);
  });

  it("reports a Topic with no resolvable units as uncovered", () => {
    const extract = buildFallbackRecap({
      sessionId: "cs_1",
      materialVersion: 1,
      profile: {
        understandingLevel: "No_Understanding",
        explanationStyle: "Concise",
      },
      topics: [
        { topicId: "ghost", materialVersion: 1, order: 0, name: "Ghost", unitIdxs: [99] },
      ],
      units: UNITS,
      now: NOW,
    });

    expect(extract.sections[0].uncovered).toBe(true);
    expect(extract.sections[0].sourceRefs).toEqual([]);
  });
});
