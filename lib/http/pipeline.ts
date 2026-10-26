import "server-only";

import { randomUUID } from "node:crypto";

import { logError } from "@/lib/aws/logger";
import {
  asAwsError,
  errorResponse,
  internalEnvelope,
  isAppError,
} from "@/lib/http/errors";

/**
 * The uniform handler pipeline.
 *
 * Every Route Handler runs the same named stages, in this order:
 *
 *   parse → authorise → validate → read → compute → generate → write → project
 *
 * Each stage receives the previous stage's value and the request context, and a
 * handler names only the stages it needs. Two properties make this worth having
 * over ad-hoc code in each route:
 *
 * 1. **`project` is the only terminal stage.** It is the sole method that
 *    produces a `Response`, so a handler physically cannot return a repository
 *    object or a domain object to the client — every field that leaves the
 *    server passes through a named projection, which is where the anonymity
 *    allow-list and the ownership checks are applied.
 * 2. **One error path.** Anything thrown in any stage becomes the single error
 *    envelope: a coded `AppError` keeps its code and status, and anything else
 *    becomes `INTERNAL` carrying a request id, with the detail going to the log
 *    rather than to the client.
 */

export interface RequestContext {
  readonly request: Request;
  /** Correlates the client's `INTERNAL` response with the logged detail. */
  readonly requestId: string;
}

type Stage<In, Out> = (value: In, ctx: RequestContext) => Out | Promise<Out>;

export interface ProjectOptions {
  /** Response status. Defaults to 200; use 201 when a handler creates a resource. */
  status?: number;
  headers?: HeadersInit;
}

class Pipeline<T> {
  constructor(
    private readonly ctx: RequestContext,
    private readonly value: Promise<T>,
  ) {
    // A stage may reject before `project` attaches its handler. Marking the
    // rejection handled here keeps an abandoned chain from surfacing as an
    // unhandled rejection; `project` still sees and handles the same rejection.
    void this.value.catch(() => undefined);
  }

  private next<U>(stage: Stage<T, U>): Pipeline<U> {
    return new Pipeline(
      this.ctx,
      this.value.then((value) => stage(value, this.ctx)),
    );
  }

  /** Reads the request body and route parameters into a typed shape. */
  parse<U>(stage: Stage<T, U>): Pipeline<U> {
    return this.next(stage);
  }

  /** Establishes who is calling: Learner membership, Instructor token, ownership. */
  authorise<U>(stage: Stage<T, U>): Pipeline<U> {
    return this.next(stage);
  }

  /** Checks every client-supplied value against `lib/domain/validate-input.ts`. */
  validate<U>(stage: Stage<T, U>): Pipeline<U> {
    return this.next(stage);
  }

  /** Loads persisted state through `lib/repo/`. */
  read<U>(stage: Stage<T, U>): Pipeline<U> {
    return this.next(stage);
  }

  /** Applies pure domain functions. No I/O belongs in this stage. */
  compute<U>(stage: Stage<T, U>): Pipeline<U> {
    return this.next(stage);
  }

  /** Produces generated content. Absent until a generation provider is chosen. */
  generate<U>(stage: Stage<T, U>): Pipeline<U> {
    return this.next(stage);
  }

  /** Persists the result through `lib/repo/`. */
  write<U>(stage: Stage<T, U>): Pipeline<U> {
    return this.next(stage);
  }

  /**
   * Selects exactly the fields the client may see and responds.
   *
   * Mandatory: this is the only stage that yields a `Response`, so nothing can
   * be returned to a client without passing through a projection.
   */
  async project<U>(
    stage: Stage<T, U>,
    options: ProjectOptions = {},
  ): Promise<Response> {
    try {
      const value = await this.value;
      const projected = await stage(value, this.ctx);

      return Response.json(projected, {
        status: options.status ?? 200,
        headers: options.headers,
      });
    } catch (error) {
      return this.toErrorResponse(error);
    }
  }

  private toErrorResponse(error: unknown): Response {
    if (isAppError(error)) return errorResponse(error);

    // An unusable AWS session is an operational condition, not a bug in a
    // handler: it is reported with the sentence that fixes it, and still logged
    // in full so the cause is not lost.
    const awsError = asAwsError(error);

    if (awsError) {
      logError({
        event: "aws_unavailable",
        requestId: this.ctx.requestId,
        error,
        context: { path: new URL(this.ctx.request.url).pathname },
      });

      return errorResponse(awsError);
    }

    logError({
      event: "unhandled_error",
      requestId: this.ctx.requestId,
      error,
      context: { path: new URL(this.ctx.request.url).pathname },
    });

    return Response.json(internalEnvelope(this.ctx.requestId), { status: 500 });
  }
}

/** Starts a pipeline for one request. */
export function pipeline(request: Request): Pipeline<RequestContext> {
  const ctx: RequestContext = { request, requestId: randomUUID() };
  return new Pipeline(ctx, Promise.resolve(ctx));
}

/**
 * The request body as a plain object, or `{}` when there is no body or it is
 * not valid JSON.
 *
 * A malformed body is not its own error code: the validators that follow report
 * the specific missing or invalid field, which is the message a Learner can act
 * on, rather than a generic parse failure.
 */
export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Awaits a Next.js route's params, which arrive as a promise. */
export async function readParams<T extends Record<string, string>>(
  context: { params: Promise<T> },
): Promise<T> {
  return context.params;
}
