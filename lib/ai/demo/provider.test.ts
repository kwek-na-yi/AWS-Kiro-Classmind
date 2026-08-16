import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DemoAIProvider } from "@/lib/ai/demo/provider";
import { contentTerms, normalise } from "@/lib/ai/demo/text";
import type {
  GenerationContext,
  RecapOutput,
  SourceCorpus,
} from "@/lib/ai/provider";
import { extractSourceText } from "@/lib/ingest/extract";
import { deriveTopics } from "@/lib/ingest/topics";
import { segmentUnits } from "@/lib/ingest/units";
import {
  EXPLANATION_STYLES,
  UNDERSTANDING_LEVELS,
  type ExplanationStyle,
  type UnderstandingLevel,
} from "@/lib/types";

const provider = new DemoAIProvider();

const context: GenerationContext = { sessionId: "cs_1", materialVersion: 1 };

/**
 * The corpus is built through the real ingest pipeline from the Markdown
 * fixture, so these tests exercise the same shapes the application will hand the
 * provider at runtime.
 */
async function fixtureCorpus(
  name = "lecture-sample.md",
  ext = "md",
): Promise<SourceCorpus> {
  const bytes = new Uint8Array(
    readFileSync(path.resolve(process.cwd(), "tests/fixtures", name)),
  );

  const extraction = await extractSourceText({ ext, bytes });
  if (!extraction.ok) throw new Error("fixture failed to extract");

  const units = segmentUnits(extraction.blocks, 1);
  return { units, topics: deriveTopics(units, 1) };
}

const EMPTY_CORPUS: SourceCorpus = { units: [], topics: [] };

function profile(
  understandingLevel: UnderstandingLevel,
  explanationStyle: ExplanationStyle,
) {
  return { understandingLevel, explanationStyle };
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw new Error(`expected success, got ${result.reason}`);
  return result.value;
}

/** Every word the source corpus contains, for grounding checks. */
function corpusVocabulary(corpus: SourceCorpus): Set<string> {
  return new Set(corpus.units.flatMap((unit) => contentTerms(unit.text)));
}

describe("the provider declares what it is", () => {
  it("identifies itself as deterministic, not as a model", () => {
    expect(provider.id).toBe("demo");
    expect(provider.kind).toBe("deterministic");
    expect(provider.label).toMatch(/no model/i);
  });

  it("makes no network call and holds no credential", () => {
    for (const file of ["provider.ts", "recap.ts", "quiz.ts", "assess.ts", "corpus.ts"]) {
      const source = readFileSync(
        path.resolve(process.cwd(), "lib/ai/demo", file),
        "utf8",
      );

      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/https?:\/\//);
      expect(source).not.toMatch(/apiKey|API_KEY|Authorization/);
      expect(source).not.toMatch(/from\s+["']@aws-sdk/);
    }
  });
});

describe("generateRecap", () => {
  it("returns one section per Topic, in Topic order", async () => {
    const corpus = await fixtureCorpus();
    const recap = unwrap(
      await provider.generateRecap({
        context,
        corpus,
        profile: profile("Basic_Understanding", "Detailed"),
      }),
    );

    expect(recap.sections).toHaveLength(corpus.topics.length);
    expect(recap.sections.map((section) => section.topicId)).toEqual(
      corpus.topics.map((topic) => topic.topicId),
    );
  });

  it("returns 3 to 7 single-sentence takeaways", async () => {
    const corpus = await fixtureCorpus();
    const recap = unwrap(
      await provider.generateRecap({
        context,
        corpus,
        profile: profile("Basic_Understanding", "Detailed"),
      }),
    );

    expect(recap.takeaways.length).toBeGreaterThanOrEqual(3);
    expect(recap.takeaways.length).toBeLessThanOrEqual(7);

    for (const takeaway of recap.takeaways) {
      expect(takeaway.length).toBeGreaterThan(0);
      // One sentence: no internal terminal punctuation followed by more text.
      expect(takeaway.replace(/…$/, "")).not.toMatch(/[.!?]\s+\S/);
    }
  });

  it("cites at least one in-range unit for every covered section", async () => {
    const corpus = await fixtureCorpus();
    const validIndexes = new Set(corpus.units.map((unit) => unit.index));

    for (const level of UNDERSTANDING_LEVELS) {
      for (const style of EXPLANATION_STYLES) {
        const recap = unwrap(
          await provider.generateRecap({
            context,
            corpus,
            profile: profile(level, style),
          }),
        );

        for (const section of recap.sections) {
          if (!section.covered) continue;

          expect(section.unitIdxs.length).toBeGreaterThanOrEqual(1);
          for (const index of section.unitIdxs) {
            expect(validIndexes.has(index)).toBe(true);
          }
        }
      }
    }
  });

  it("draws its wording from the source and invents no vocabulary", async () => {
    const corpus = await fixtureCorpus();
    const vocabulary = corpusVocabulary(corpus);

    const recap = unwrap(
      await provider.generateRecap({
        context,
        corpus,
        profile: profile("Basic_Understanding", "Detailed"),
      }),
    );

    // Words the provider is allowed to contribute: structural framing only.
    const framing = new Set(
      contentTerms(
        [
          "in plain terms from the lecture material how the parts of fit together",
          "conditions and qualifications stated for",
          "worked example",
          "term what the says",
          "does not cover",
          "re-read the cited source unit for the full wording",
        ].join(" "),
      ),
    );

    for (const takeaway of recap.takeaways) {
      for (const term of contentTerms(takeaway)) {
        expect(vocabulary.has(term) || framing.has(term)).toBe(true);
      }
    }

    for (const section of recap.sections) {
      if (!section.covered) continue;

      for (const term of contentTerms(section.body)) {
        expect(vocabulary.has(term) || framing.has(term)).toBe(true);
      }
    }
  });

  it("reports an uncovered Topic instead of filling it in", async () => {
    const corpus = await fixtureCorpus();
    const withGhost: SourceCorpus = {
      units: corpus.units,
      topics: [
        ...corpus.topics,
        {
          topicId: "ghost",
          materialVersion: 1,
          order: corpus.topics.length,
          name: "Sharding",
          unitIdxs: [9999],
        },
      ],
    };

    const recap = unwrap(
      await provider.generateRecap({
        context,
        corpus: withGhost,
        profile: profile("Basic_Understanding", "Detailed"),
      }),
    );

    const ghost = recap.sections.find((section) => section.topicId === "ghost");
    expect(ghost?.covered).toBe(false);
    expect(ghost?.unitIdxs).toEqual([]);
    expect(ghost?.body).toMatch(/does not cover/i);
  });

  it("fails rather than inventing when there is no source", async () => {
    const result = await provider.generateRecap({
      context,
      corpus: EMPTY_CORPUS,
      profile: profile("Basic_Understanding", "Detailed"),
    });

    expect(result).toEqual({ ok: false, reason: "unresolvable_citation" });
  });

  it("fails when the units hold only whitespace", async () => {
    const result = await provider.generateRecap({
      context,
      corpus: {
        units: [
          { materialVersion: 1, index: 0, text: "   \n  ", ref: { kind: "page", value: "p. 1" } },
        ],
        topics: [
          { topicId: "t", materialVersion: 1, order: 0, name: "T", unitIdxs: [0] },
        ],
      },
      profile: profile("Basic_Understanding", "Detailed"),
    });

    expect(result.ok).toBe(false);
  });
});

describe("understanding-level variation", () => {
  it("produces different bodies for the three levels", async () => {
    const corpus = await fixtureCorpus();

    const bodies = await Promise.all(
      UNDERSTANDING_LEVELS.map(async (level) => {
        const recap = unwrap(
          await provider.generateRecap({
            context,
            corpus,
            profile: profile(level, "Detailed"),
          }),
        );
        return recap.sections.map((section) => section.body).join("\n");
      }),
    );

    expect(new Set(bodies).size).toBe(UNDERSTANDING_LEVELS.length);
  });

  it("frames each level differently in the section lead-in", async () => {
    const corpus = await fixtureCorpus();

    const leadIns: Record<string, RegExp> = {
      No_Understanding: /in plain terms/i,
      Basic_Understanding: /fit together/i,
      Strong_Understanding: /conditions and qualifications/i,
    };

    for (const level of UNDERSTANDING_LEVELS) {
      const recap = unwrap(
        await provider.generateRecap({
          context,
          corpus,
          profile: profile(level, "Detailed"),
        }),
      );

      const covered = recap.sections.find((section) => section.covered);
      expect(covered?.body).toMatch(leadIns[level]);
    }
  });
});

describe("explanation-style variation", () => {
  let recaps: Map<ExplanationStyle, RecapOutput>;

  async function allStyles(level: UnderstandingLevel = "Basic_Understanding") {
    const corpus = await fixtureCorpus();
    recaps = new Map();

    for (const style of EXPLANATION_STYLES) {
      recaps.set(
        style,
        unwrap(
          await provider.generateRecap({
            context,
            corpus,
            profile: profile(level, style),
          }),
        ),
      );
    }

    return recaps;
  }

  it("produces a different body for each of the five styles", async () => {
    const byStyle = await allStyles();
    const bodies = [...byStyle.values()].map((recap) =>
      recap.sections.map((section) => section.body).join("\n"),
    );

    expect(new Set(bodies).size).toBe(EXPLANATION_STYLES.length);
  });

  it("keeps Concise sections to bullets within 80 words", async () => {
    const byStyle = await allStyles();

    for (const section of byStyle.get("Concise")?.sections ?? []) {
      if (!section.covered) continue;

      expect(section.body).toMatch(/\n- /);
      expect(section.body.split(/\s+/).length).toBeLessThanOrEqual(80);
    }
  });

  it("keeps Detailed sections to prose within 250 words", async () => {
    const byStyle = await allStyles();

    for (const section of byStyle.get("Detailed")?.sections ?? []) {
      if (!section.covered) continue;

      expect(section.body).not.toMatch(/\n- /);
      expect(section.body.split(/\s+/).length).toBeLessThanOrEqual(250);
    }
  });

  it("marks a worked example in the Examples style", async () => {
    const byStyle = await allStyles();

    for (const section of byStyle.get("Examples")?.sections ?? []) {
      if (!section.covered) continue;
      expect(section.body).toMatch(/Worked example/);
    }
  });

  it("numbers at least two steps in the Step_By_Step style", async () => {
    const byStyle = await allStyles();

    for (const section of byStyle.get("Step_By_Step")?.sections ?? []) {
      if (!section.covered) continue;

      expect(section.body).toMatch(/\n1\. /);
      expect(section.body).toMatch(/\n2\. /);
    }
  });

  it("attaches a structured artefact and a prose form in Visual_Structured", async () => {
    const byStyle = await allStyles();

    for (const section of byStyle.get("Visual_Structured")?.sections ?? []) {
      if (!section.covered) continue;

      expect(["table", "pipeline", "mermaid"]).toContain(section.artefact.kind);
      expect(section.artefact.content.length).toBeGreaterThan(0);
      // Requirement 4.13: the artefact is always accompanied by prose.
      expect(section.proseBody.length).toBeGreaterThan(0);
    }
  });

  it("leaves other styles without an artefact but still with prose", async () => {
    const byStyle = await allStyles();

    for (const style of ["Concise", "Detailed", "Examples", "Step_By_Step"] as const) {
      for (const section of byStyle.get(style)?.sections ?? []) {
        expect(section.artefact.kind).toBe("none");
        expect(section.proseBody.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("generateQuizPool", () => {
  it("returns well-formed items across all three difficulties", async () => {
    const corpus = await fixtureCorpus();
    const topicIds = new Set(corpus.topics.map((topic) => topic.topicId));
    const validIndexes = new Set(corpus.units.map((unit) => unit.index));

    const pool = unwrap(await provider.generateQuizPool({ context, corpus }));

    expect(pool.items.length).toBeGreaterThan(0);

    for (const item of pool.items) {
      expect(item.options).toHaveLength(4);
      expect(item.options.filter((option) => option.isCorrect)).toHaveLength(1);
      expect(topicIds.has(item.topicId)).toBe(true);
      expect(validIndexes.has(item.unitIdx)).toBe(true);
      expect([1, 2, 3]).toContain(item.difficulty);
      expect(item.stem.length).toBeGreaterThan(0);

      // Every Distractor names the belief it represents; the correct option
      // carries no label.
      for (const option of item.options) {
        expect(option.text.trim().length).toBeGreaterThan(0);

        if (option.isCorrect) {
          expect(option.misconceptionLabel).toBeNull();
        } else {
          expect(option.misconceptionLabel).toBeTruthy();
        }
      }

      // No two options may say the same thing.
      const texts = item.options.map((option) => normalise(option.text));
      expect(new Set(texts).size).toBe(4);
    }
  });

  it("covers every difficulty level requested", async () => {
    const corpus = await fixtureCorpus();
    const pool = unwrap(await provider.generateQuizPool({ context, corpus }));

    const levels = new Set(pool.items.map((item) => item.difficulty));
    expect([...levels].sort()).toEqual([1, 2, 3]);
  });

  it("honours a level-scoped request", async () => {
    const corpus = await fixtureCorpus();
    const pool = unwrap(
      await provider.generateQuizPool({ context, corpus, difficulties: [2] }),
    );

    expect(pool.items.length).toBeGreaterThan(0);
    expect(pool.items.every((item) => item.difficulty === 2)).toBe(true);
  });

  it("aims for the requested number of items per level", async () => {
    const corpus = await fixtureCorpus();
    const pool = unwrap(
      await provider.generateQuizPool({ context, corpus, itemsPerDifficulty: 2 }),
    );

    for (const difficulty of [1, 2, 3]) {
      const count = pool.items.filter((item) => item.difficulty === difficulty).length;
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("draws every option's wording from the source", async () => {
    const corpus = await fixtureCorpus();
    const vocabulary = corpusVocabulary(corpus);
    const pool = unwrap(await provider.generateQuizPool({ context, corpus }));

    for (const item of pool.items) {
      for (const option of item.options) {
        for (const term of contentTerms(option.text)) {
          expect(vocabulary.has(term)).toBe(true);
        }
      }
    }
  });

  it("does not always place the correct option first", async () => {
    const corpus = await fixtureCorpus();
    const pool = unwrap(await provider.generateQuizPool({ context, corpus }));

    const positions = new Set(
      pool.items.map((item) => item.options.findIndex((option) => option.isCorrect)),
    );

    expect(positions.size).toBeGreaterThan(1);
  });

  it("fails rather than returning an empty pool when there is no source", async () => {
    const result = await provider.generateQuizPool({ context, corpus: EMPTY_CORPUS });
    expect(result).toEqual({ ok: false, reason: "unresolvable_citation" });
  });
});

describe("determinism", () => {
  it("returns byte-identical recaps for identical input", async () => {
    const corpus = await fixtureCorpus();

    for (const level of UNDERSTANDING_LEVELS) {
      for (const style of EXPLANATION_STYLES) {
        const first = await provider.generateRecap({
          context,
          corpus,
          profile: profile(level, style),
        });
        const second = await provider.generateRecap({
          context,
          corpus,
          profile: profile(level, style),
        });

        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      }
    }
  });

  it("returns byte-identical pools for identical input", async () => {
    const corpus = await fixtureCorpus();

    const first = await provider.generateQuizPool({ context, corpus });
    const second = await provider.generateQuizPool({ context, corpus });

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("is unaffected by a fresh provider instance", async () => {
    const corpus = await fixtureCorpus();
    const request = {
      context,
      corpus,
      profile: profile("No_Understanding", "Concise"),
    };

    const first = await new DemoAIProvider().generateRecap(request);
    const second = await new DemoAIProvider().generateRecap(request);

    expect(second).toEqual(first);
  });

  it("holds across the other fixture formats", async () => {
    for (const [name, ext] of [
      ["lecture-sample.txt", "txt"],
      ["lecture-sample.pdf", "pdf"],
    ] as const) {
      const corpus = await fixtureCorpus(name, ext);

      const first = await provider.generateRecap({
        context,
        corpus,
        profile: profile("Strong_Understanding", "Step_By_Step"),
      });
      const second = await provider.generateRecap({
        context,
        corpus,
        profile: profile("Strong_Understanding", "Step_By_Step"),
      });

      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(first.ok).toBe(true);
    }
  });
});
