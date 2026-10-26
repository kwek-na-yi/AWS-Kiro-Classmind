import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  asSentence,
  contentTerms,
  hashString,
  keyTerms,
  negationCount,
  normalise,
  numbersIn,
  overlapCount,
  shapeOf,
  splitSentences,
  truncateChars,
  truncateWords,
  wordCount,
} from "@/lib/ai/demo/text";

describe("splitSentences", () => {
  it("splits on terminal punctuation and line breaks", () => {
    expect(splitSentences("One thing. Two things! Three?\nFour")).toEqual([
      "One thing.",
      "Two things!",
      "Three?",
      "Four",
    ]);
  });

  it("strips list markers and leading numbering", () => {
    expect(splitSentences("- First point\n2. Second point\n• Third point")).toEqual([
      "First point",
      "Second point",
      "Third point",
    ]);
  });

  it("rejoins a sentence a writer hard-wrapped across lines", () => {
    const wrapped =
      "A table is in first normal\nform when every column holds a single atomic\nvalue.";

    expect(splitSentences(wrapped)).toEqual([
      "A table is in first normal form when every column holds a single atomic value.",
    ]);
  });

  it("never joins a heading to the paragraph beneath it", () => {
    // Gluing these produces "Normalisation Normalisation organises …", which
    // reads as a stutter and names its own topic in the first word.
    const text = "# Normalisation\nNormalisation organises the columns and tables.";

    expect(splitSentences(text)).toEqual([
      "# Normalisation",
      "Normalisation organises the columns and tables.",
    ]);
  });

  it("keeps blocks apart when unwrapping", () => {
    const text = "Intro line\ncontinues here.\n\n- A bullet\n- Another bullet\n# Heading";

    expect(splitSentences(text)).toEqual([
      "Intro line continues here.",
      "A bullet",
      "Another bullet",
      "# Heading",
    ]);
  });

  it("returns nothing for empty or whitespace text", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n\t  ")).toEqual([]);
  });
});

describe("terms", () => {
  it("drops stopwords and very short tokens", () => {
    expect(contentTerms("The table is in a normal form")).toEqual(["table", "normal", "form"]);
  });

  it("ranks key terms by frequency, breaking ties alphabetically", () => {
    const terms = keyTerms(
      ["index index index", "table table", "column"],
      3,
    );

    expect(terms).toEqual(["index", "table", "column"]);
  });

  it("is unaffected by the order of the input texts", () => {
    const texts = ["alpha beta", "beta gamma", "gamma gamma"];

    expect(keyTerms([...texts].reverse(), 3)).toEqual(keyTerms(texts, 3));
  });
});

describe("sentence shape", () => {
  it("recognises the shapes the profiles select on", () => {
    expect(shapeOf("A key is a column that is unique.").definitional).toBe(true);
    expect(shapeOf("It splits because the key is composite.").relational).toBe(true);
    expect(shapeOf("This holds unless the column is null.").qualifying).toBe(true);
    expect(shapeOf("For example, a phone list.").exemplifying).toBe(true);
    expect(shapeOf("First normalise, then index.").sequential).toBe(true);
  });
});

describe("truncation", () => {
  it("keeps text under the word budget", () => {
    expect(wordCount(truncateWords("one two three four five", 3))).toBeLessThanOrEqual(4);
    expect(truncateWords("one two three", 5)).toBe("one two three");
  });

  it("keeps text under the character budget", () => {
    const long = "x".repeat(500);
    expect(truncateChars(long, 300).length).toBeLessThanOrEqual(300);
    expect(truncateChars("short", 300)).toBe("short");
  });

  it("never exceeds the budget for arbitrary input", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 900 }), fc.integer({ min: 10, max: 300 }), (text, limit) => {
        expect(truncateChars(text, limit).length).toBeLessThanOrEqual(limit);
      }),
    );
  });

  it("closes a fragment with a full stop", () => {
    expect(asSentence("no stop here")).toBe("no stop here.");
    expect(asSentence("already stopped.")).toBe("already stopped.");
    expect(asSentence("")).toBe("");
  });
});

describe("comparison helpers", () => {
  it("counts shared terms once each", () => {
    expect(overlapCount(["table", "index"], "The table lists the table names")).toBe(1);
    expect(overlapCount(["table", "index"], "The table has an index")).toBe(2);
  });

  it("detects negation and numbers", () => {
    expect(negationCount("This is not the case and never was")).toBe(2);
    expect(negationCount("This is the case")).toBe(0);
    expect(numbersIn("first normal form has 1 value, not 2")).toEqual(["1", "2"]);
  });

  it("normalises text for equivalence", () => {
    expect(normalise("The Table's Index!")).toBe(normalise("the table s index"));
  });
});

describe("hashString", () => {
  it("is stable across calls", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(hashString(value)).toBe(hashString(value));
      }),
    );
  });

  it("returns an unsigned 32-bit integer", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const hash = hashString(value);
        expect(Number.isInteger(hash)).toBe(true);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThanOrEqual(0xffffffff);
      }),
    );
  });

  it("separates different strings in practice", () => {
    const hashes = new Set(
      Array.from({ length: 200 }, (_, i) => hashString(`option-text-${i}`)),
    );

    expect(hashes.size).toBe(200);
  });
});
