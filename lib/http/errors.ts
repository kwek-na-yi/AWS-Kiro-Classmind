/**
 * The error code table and the single failure envelope.
 *
 * Every failure any endpoint can produce is named here with its HTTP status, and
 * every failure serialises to the same shape:
 *
 * ```json
 * { "error": { "code": "MATERIAL_TOO_LARGE", "message": "...", "field": "bytes" } }
 * ```
 *
 * One shape means one renderer in the Web_App: a view shows its own error inline
 * and navigation to the other views is unaffected.
 *
 * This module is pure and imports nothing from `lib/aws/`, so a Client Component
 * may import the types to render an envelope it received.
 */

import type { ValidationErrorCode } from "@/lib/domain/validate-input";

/** Every error code, with the status it is returned as. */
export const ERROR_STATUS = {
  SESSION_NOT_FOUND: 404,
  INVALID_DISPLAY_NAME: 400,
  UNSUPPORTED_EXTENSION: 400,
  MATERIAL_TOO_LARGE: 400,
  NO_READABLE_TEXT: 422,
  PROFILE_REQUIRED: 400,
  INVALID_PROFILE: 400,
  POOL_UNAVAILABLE: 409,
  EXPLANATION_LENGTH: 400,
  NOT_YOUR_REPORT: 403,
  LEARNER_NOT_IN_SESSION: 403,
  INSTRUCTOR_TOKEN_REQUIRED: 403,
  INTERNAL: 500,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_STATUS;

/**
 * Compile-time proof that input validation can only produce codes from the
 * table above. If a validator ever invents a code, this assignment fails.
 */
const _validationCodesAreKnown: Record<ValidationErrorCode, ErrorCode> = {
  INVALID_DISPLAY_NAME: "INVALID_DISPLAY_NAME",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  INVALID_PROFILE: "INVALID_PROFILE",
  UNSUPPORTED_EXTENSION: "UNSUPPORTED_EXTENSION",
  MATERIAL_TOO_LARGE: "MATERIAL_TOO_LARGE",
  EXPLANATION_LENGTH: "EXPLANATION_LENGTH",
};
void _validationCodesAreKnown;

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    /** The offending request field, when the failure names one. */
    field?: string;
  };
}

/**
 * A failure with a code from the table. Thrown anywhere in a handler; the
 * pipeline turns it into the envelope.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly field?: string;

  constructor(code: ErrorCode, message: string, field?: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.field = field;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Builds the envelope body for a coded failure. */
export function errorEnvelope(
  code: ErrorCode,
  message: string,
  field?: string,
): ErrorEnvelope {
  return { error: { code, message, ...(field ? { field } : {}) } };
}

/**
 * The envelope for an unexpected failure.
 *
 * It carries the request id and nothing else: no exception message, no stack,
 * no table or bucket name. The detail is written to the log under the same id,
 * so an operator can join the two without the client ever seeing internals.
 */
export function internalEnvelope(requestId: string): ErrorEnvelope {
  return {
    error: {
      code: "INTERNAL",
      message: `Something went wrong. Reference: ${requestId}`,
    },
  };
}

/** Serialises a coded failure as a JSON `Response`. */
export function errorResponse(error: AppError): Response {
  return Response.json(errorEnvelope(error.code, error.message, error.field), {
    status: error.status,
  });
}
