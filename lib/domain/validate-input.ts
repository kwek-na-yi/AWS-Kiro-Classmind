/**
 * Server-side validation of every client-supplied value.
 *
 * No handler trusts the client for a length, an enum member or a byte size, so
 * each validator here takes `unknown` — the raw shape of a parsed JSON body —
 * and returns either a narrowed value or a typed failure naming the offending
 * field and the error code the envelope will carry.
 *
 * These functions are pure: no I/O, no clock, no AWS. They are the `validate`
 * stage of the handler pipeline.
 */

import {
  EXPLANATION_STYLES,
  MATERIAL_EXTENSIONS,
  UNDERSTANDING_LEVELS,
  type ExplanationStyle,
  type MaterialExtension,
  type UnderstandingLevel,
} from "@/lib/types";

/**
 * The error codes input validation can produce — a subset of the full table in
 * design.md Section 16, which `lib/http/errors.ts` declares with its HTTP
 * statuses. Every code here appears in that table; none is invented.
 */
export type ValidationErrorCode =
  | "INVALID_DISPLAY_NAME"
  | "SESSION_NOT_FOUND"
  | "INVALID_PROFILE"
  | "UNSUPPORTED_EXTENSION"
  | "MATERIAL_TOO_LARGE"
  | "EXPLANATION_LENGTH";

export interface ValidationFailure {
  ok: false;
  /** The request field that failed, echoed as `error.field` in the envelope. */
  field: string;
  code: ValidationErrorCode;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | ValidationFailure;

// ---------------------------------------------------------------------------
// Bounds, declared once and exported so tests and messages cannot drift
// ---------------------------------------------------------------------------

export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 30;
export const JOIN_CODE_LENGTH = 6;
export const EXPLANATION_MIN = 20;
export const EXPLANATION_MAX = 1500;
/** 20 MB, the declared-size ceiling for a Lecture_Material (Requirement 2.3). */
export const MATERIAL_MAX_BYTES = 20 * 1024 * 1024;

function fail(
  field: string,
  code: ValidationErrorCode,
  message: string,
): ValidationFailure {
  return { ok: false, field, code, message };
}

/**
 * Counts code points rather than UTF-16 units, so an emoji or an accented
 * character costs a Learner one character rather than two.
 */
function charLength(value: string): number {
  return [...value].length;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Display_Name: 1–30 characters after trimming (Requirement 1.3). */
export function validateDisplayName(raw: unknown): ValidationResult<string> {
  const invalid = fail(
    "displayName",
    "INVALID_DISPLAY_NAME",
    `Display name must be between ${DISPLAY_NAME_MIN} and ${DISPLAY_NAME_MAX} characters.`,
  );

  if (typeof raw !== "string") return invalid;

  const value = raw.trim();
  const length = charLength(value);
  if (length < DISPLAY_NAME_MIN || length > DISPLAY_NAME_MAX) return invalid;

  return { ok: true, value };
}

/**
 * Join_Code: exactly 6 alphanumeric characters, normalised to upper case.
 *
 * A malformed code carries `SESSION_NOT_FOUND` because it can match no
 * Class_Session, which is the outcome Requirement 1.4 specifies — the shape
 * check simply reaches that answer without a database read.
 */
export function validateJoinCode(raw: unknown): ValidationResult<string> {
  const invalid = fail(
    "joinCode",
    "SESSION_NOT_FOUND",
    "That class code was not recognised.",
  );

  if (typeof raw !== "string") return invalid;

  const value = raw.trim().toUpperCase();
  if (!new RegExp(`^[A-Z0-9]{${JOIN_CODE_LENGTH}}$`).test(value)) return invalid;

  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Learner_Profile
// ---------------------------------------------------------------------------

export function validateUnderstandingLevel(
  raw: unknown,
): ValidationResult<UnderstandingLevel> {
  const value = UNDERSTANDING_LEVELS.find((level) => level === raw);
  if (!value) {
    return fail(
      "understandingLevel",
      "INVALID_PROFILE",
      `Understanding level must be one of: ${UNDERSTANDING_LEVELS.join(", ")}.`,
    );
  }
  return { ok: true, value };
}

export function validateExplanationStyle(
  raw: unknown,
): ValidationResult<ExplanationStyle> {
  const value = EXPLANATION_STYLES.find((style) => style === raw);
  if (!value) {
    return fail(
      "explanationStyle",
      "INVALID_PROFILE",
      `Explanation style must be one of: ${EXPLANATION_STYLES.join(", ")}.`,
    );
  }
  return { ok: true, value };
}

export interface ValidatedProfile {
  understandingLevel: UnderstandingLevel;
  explanationStyle: ExplanationStyle;
}

/**
 * Both halves of a Learner_Profile. The Understanding_Level is checked first, so
 * a request with two bad values names the first offending field.
 */
export function validateProfile(
  rawUnderstandingLevel: unknown,
  rawExplanationStyle: unknown,
): ValidationResult<ValidatedProfile> {
  const level = validateUnderstandingLevel(rawUnderstandingLevel);
  if (!level.ok) return level;

  const style = validateExplanationStyle(rawExplanationStyle);
  if (!style.ok) return style;

  return {
    ok: true,
    value: { understandingLevel: level.value, explanationStyle: style.value },
  };
}

// ---------------------------------------------------------------------------
// Lecture_Material upload
// ---------------------------------------------------------------------------

/**
 * File extension, normalised to lower case with any leading dot removed.
 * The message lists the accepted set, as Requirement 2.2 requires.
 */
export function validateMaterialExtension(
  raw: unknown,
): ValidationResult<MaterialExtension> {
  const invalid = fail(
    "ext",
    "UNSUPPORTED_EXTENSION",
    `Accepted file types are: ${MATERIAL_EXTENSIONS.join(", ")}.`,
  );

  if (typeof raw !== "string") return invalid;

  const normalised = raw.trim().toLowerCase().replace(/^\./, "");
  const value = MATERIAL_EXTENSIONS.find((ext) => ext === normalised);
  if (!value) return invalid;

  return { ok: true, value };
}

/**
 * Declared byte size: an integer from 1 byte to 20 MB inclusive.
 *
 * A size of zero or below is not "too large", but design.md Section 16 declares
 * no separate code for it, so rather than invent one the failure reuses
 * `MATERIAL_TOO_LARGE` with a message stating the whole accepted range. The
 * presigned PUT carries the same 1 byte–20 MB `content-length-range`, so the
 * declared size and the enforced size agree.
 */
export function validateDeclaredBytes(raw: unknown): ValidationResult<number> {
  const invalid = fail(
    "bytes",
    "MATERIAL_TOO_LARGE",
    `File size must be between 1 byte and ${MATERIAL_MAX_BYTES} bytes (20 MB).`,
  );

  if (typeof raw !== "number" || !Number.isInteger(raw)) return invalid;
  if (raw < 1 || raw > MATERIAL_MAX_BYTES) return invalid;

  return { ok: true, value: raw };
}

// ---------------------------------------------------------------------------
// Peer_Explanation
// ---------------------------------------------------------------------------

/** Peer_Explanation text: 20–1500 characters after trimming (Requirement 10.3). */
export function validateExplanationText(raw: unknown): ValidationResult<string> {
  const invalid = fail(
    "text",
    "EXPLANATION_LENGTH",
    `An explanation must be between ${EXPLANATION_MIN} and ${EXPLANATION_MAX} characters.`,
  );

  if (typeof raw !== "string") return invalid;

  const value = raw.trim();
  const length = charLength(value);
  if (length < EXPLANATION_MIN || length > EXPLANATION_MAX) return invalid;

  return { ok: true, value };
}
