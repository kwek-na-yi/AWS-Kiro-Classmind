import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  EXPLANATION_MAX,
  EXPLANATION_MIN,
  MATERIAL_MAX_BYTES,
  validateDeclaredBytes,
  validateDisplayName,
  validateExplanationStyle,
  validateExplanationText,
  validateJoinCode,
  validateMaterialExtension,
  validateProfile,
  validateUnderstandingLevel,
} from "@/lib/domain/validate-input";
import { EXPLANATION_STYLES, UNDERSTANDING_LEVELS } from "@/lib/types";

/** `n` characters that survive trimming. */
const chars = (n: number) => "a".repeat(n);

describe("validateDisplayName", () => {
  it("rejects 0 characters", () => {
    const result = validateDisplayName(chars(0));
    expect(result).toMatchObject({
      ok: false,
      field: "displayName",
      code: "INVALID_DISPLAY_NAME",
    });
  });

  it("accepts the lower boundary of 1 character", () => {
    expect(validateDisplayName(chars(DISPLAY_NAME_MIN))).toEqual({
      ok: true,
      value: "a",
    });
  });

  it("accepts the upper boundary of 30 characters", () => {
    expect(validateDisplayName(chars(DISPLAY_NAME_MAX))).toEqual({
      ok: true,
      value: chars(30),
    });
  });

  it("rejects 31 characters", () => {
    expect(validateDisplayName(chars(DISPLAY_NAME_MAX + 1))).toMatchObject({
      ok: false,
      code: "INVALID_DISPLAY_NAME",
    });
  });

  it("trims before measuring, so whitespace alone is rejected", () => {
    expect(validateDisplayName("   ")).toMatchObject({ ok: false });
    expect(validateDisplayName("  Ada  ")).toEqual({ ok: true, value: "Ada" });
  });

  it("counts an emoji as one character", () => {
    expect(validateDisplayName("🎓".repeat(DISPLAY_NAME_MAX))).toMatchObject({
      ok: true,
    });
    expect(validateDisplayName("🎓".repeat(DISPLAY_NAME_MAX + 1))).toMatchObject({
      ok: false,
    });
  });

  it("rejects a non-string body value", () => {
    for (const raw of [undefined, null, 42, {}, ["Ada"]]) {
      expect(validateDisplayName(raw)).toMatchObject({ ok: false });
    }
  });

  it("accepts every length inside the range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: DISPLAY_NAME_MIN, max: DISPLAY_NAME_MAX }),
        (length) => {
          expect(validateDisplayName(chars(length)).ok).toBe(true);
        },
      ),
    );
  });
});

describe("validateJoinCode", () => {
  it("accepts exactly 6 alphanumeric characters", () => {
    expect(validateJoinCode("CM2026")).toEqual({ ok: true, value: "CM2026" });
  });

  it("normalises case and surrounding whitespace", () => {
    expect(validateJoinCode(" cm2026 ")).toEqual({ ok: true, value: "CM2026" });
  });

  it("rejects 5 and 7 characters", () => {
    expect(validateJoinCode("CM202")).toMatchObject({
      ok: false,
      field: "joinCode",
      code: "SESSION_NOT_FOUND",
    });
    expect(validateJoinCode("CM20266")).toMatchObject({ ok: false });
  });

  it("rejects non-alphanumeric characters", () => {
    for (const raw of ["CM-206", "CM 206", "CM#206", "CM20é"]) {
      expect(validateJoinCode(raw)).toMatchObject({ ok: false });
    }
  });

  it("rejects a non-string body value", () => {
    expect(validateJoinCode(202626)).toMatchObject({ ok: false });
  });
});

describe("Learner_Profile validation", () => {
  it("accepts each of the three Understanding_Levels", () => {
    for (const level of UNDERSTANDING_LEVELS) {
      expect(validateUnderstandingLevel(level)).toEqual({ ok: true, value: level });
    }
  });

  it("accepts each of the five Explanation_Styles", () => {
    for (const style of EXPLANATION_STYLES) {
      expect(validateExplanationStyle(style)).toEqual({ ok: true, value: style });
    }
  });

  it("rejects a value outside either set with INVALID_PROFILE", () => {
    expect(validateUnderstandingLevel("Some_Understanding")).toMatchObject({
      ok: false,
      field: "understandingLevel",
      code: "INVALID_PROFILE",
    });
    expect(validateExplanationStyle("Diagrams")).toMatchObject({
      ok: false,
      field: "explanationStyle",
      code: "INVALID_PROFILE",
    });
  });

  it("is case-sensitive, so a near miss is still invalid", () => {
    expect(validateUnderstandingLevel("no_understanding")).toMatchObject({ ok: false });
  });

  it("accepts all 15 valid combinations and no others", () => {
    for (const understandingLevel of UNDERSTANDING_LEVELS) {
      for (const explanationStyle of EXPLANATION_STYLES) {
        expect(validateProfile(understandingLevel, explanationStyle)).toEqual({
          ok: true,
          value: { understandingLevel, explanationStyle },
        });
      }
    }
  });

  it("names the Understanding_Level first when both halves are invalid", () => {
    expect(validateProfile("nope", "nope")).toMatchObject({
      ok: false,
      field: "understandingLevel",
    });
  });
});

describe("validateMaterialExtension", () => {
  it("accepts the four supported extensions", () => {
    for (const ext of ["pdf", "txt", "md", "markdown"]) {
      expect(validateMaterialExtension(ext)).toEqual({ ok: true, value: ext });
    }
  });

  it("normalises case and a leading dot", () => {
    expect(validateMaterialExtension(".PDF")).toEqual({ ok: true, value: "pdf" });
    expect(validateMaterialExtension("Markdown")).toEqual({
      ok: true,
      value: "markdown",
    });
  });

  it("rejects an unsupported extension and lists the accepted set", () => {
    const result = validateMaterialExtension("docx");
    expect(result).toMatchObject({
      ok: false,
      field: "ext",
      code: "UNSUPPORTED_EXTENSION",
    });
    if (!result.ok) {
      expect(result.message).toContain("pdf");
      expect(result.message).toContain("markdown");
    }
  });

  it("rejects a non-string body value", () => {
    expect(validateMaterialExtension(null)).toMatchObject({ ok: false });
  });
});

describe("validateDeclaredBytes", () => {
  it("accepts exactly 20 MB", () => {
    expect(validateDeclaredBytes(MATERIAL_MAX_BYTES)).toEqual({
      ok: true,
      value: MATERIAL_MAX_BYTES,
    });
  });

  it("rejects one byte over 20 MB and states the limit", () => {
    const result = validateDeclaredBytes(MATERIAL_MAX_BYTES + 1);
    expect(result).toMatchObject({
      ok: false,
      field: "bytes",
      code: "MATERIAL_TOO_LARGE",
    });
    if (!result.ok) expect(result.message).toContain("20 MB");
  });

  it("accepts the lower boundary of 1 byte and rejects 0", () => {
    expect(validateDeclaredBytes(1)).toEqual({ ok: true, value: 1 });
    expect(validateDeclaredBytes(0)).toMatchObject({ ok: false });
  });

  it("rejects a negative, fractional or non-numeric size", () => {
    for (const raw of [-1, 1.5, "1024", null, Number.NaN]) {
      expect(validateDeclaredBytes(raw)).toMatchObject({ ok: false });
    }
  });
});

describe("validateExplanationText", () => {
  it("rejects 19 characters", () => {
    expect(validateExplanationText(chars(EXPLANATION_MIN - 1))).toMatchObject({
      ok: false,
      field: "text",
      code: "EXPLANATION_LENGTH",
    });
  });

  it("accepts the lower boundary of 20 characters", () => {
    expect(validateExplanationText(chars(EXPLANATION_MIN))).toEqual({
      ok: true,
      value: chars(EXPLANATION_MIN),
    });
  });

  it("accepts the upper boundary of 1500 characters", () => {
    expect(validateExplanationText(chars(EXPLANATION_MAX))).toEqual({
      ok: true,
      value: chars(EXPLANATION_MAX),
    });
  });

  it("rejects 1501 characters and states the range", () => {
    const result = validateExplanationText(chars(EXPLANATION_MAX + 1));
    expect(result).toMatchObject({ ok: false, code: "EXPLANATION_LENGTH" });
    if (!result.ok) {
      expect(result.message).toContain(String(EXPLANATION_MIN));
      expect(result.message).toContain(String(EXPLANATION_MAX));
    }
  });

  it("trims before measuring", () => {
    expect(validateExplanationText(`  ${chars(EXPLANATION_MIN)}  `)).toEqual({
      ok: true,
      value: chars(EXPLANATION_MIN),
    });
    expect(
      validateExplanationText(`  ${chars(EXPLANATION_MIN - 1)}  `),
    ).toMatchObject({ ok: false });
  });

  it("accepts every length inside the range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: EXPLANATION_MIN, max: EXPLANATION_MAX }),
        (length) => {
          expect(validateExplanationText(chars(length)).ok).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });
});
