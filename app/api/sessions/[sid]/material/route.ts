import { isPublicDemo } from "@/lib/demo/public";
import {
  validateDeclaredBytes,
  validateMaterialExtension,
} from "@/lib/domain/validate-input";
import { requireLearner } from "@/lib/http/auth";
import { AppError, type ErrorCode } from "@/lib/http/errors";
import { pipeline, readParams } from "@/lib/http/pipeline";
import { enforceRateLimit, LIMITS } from "@/lib/http/rate-limit";
import { uploadLimitBytes } from "@/lib/ingest/limits";
import { ingestUploadedMaterial, type UploadFailureReason } from "@/lib/ingest/upload";
import { getSession } from "@/lib/repo/session";

/**
 * `POST /api/sessions/{sid}/material`
 *
 * Uploads the Learner's own lecture file and turns it into the class's current
 * Lecture_Material. The body is `multipart/form-data` with one `file` part.
 *
 * The handler does no ingestion of its own. It reads the part, checks the two
 * things a client controls — the extension and the size — against
 * `lib/domain/validate-input.ts`, and hands the bytes to
 * `ingestUploadedMaterial`, which owns storing, extracting, segmenting,
 * persisting and pool generation. Everything this file adds is the mapping from
 * an ingestion outcome to an HTTP answer.
 */

/** Node, explicitly: this path parses a PDF in process and calls the AWS SDK. */
export const runtime = "nodejs";

/** Every way ingestion can decline a file, and the code each is reported as. */
const FAILURE_CODES: Record<UploadFailureReason, ErrorCode> = {
  // design.md Section 16 declares no code for a zero-byte file, and
  // `validateDeclaredBytes` already reuses MATERIAL_TOO_LARGE for one rather
  // than inventing one, so the same code is used here.
  empty_file: "MATERIAL_TOO_LARGE",
  unreadable: "NO_READABLE_TEXT",
  no_readable_text: "NO_READABLE_TEXT",
};

/**
 * Multipart framing — the boundaries, the part headers, the filename — costs a
 * little over the file itself, so the early `Content-Length` check allows for it
 * rather than rejecting a file that is legal once unwrapped. It is only a cheap
 * first gate; the exact size is checked against the same ceiling below.
 */
const MULTIPART_OVERHEAD_BYTES = 8 * 1024;

export async function POST(
  request: Request,
  context: { params: Promise<{ sid: string }> },
) {
  return pipeline(request)
    .parse(async () => {
      await enforceRateLimit(request, LIMITS.upload);
      return readParams(context);
    })
    .authorise(async (params) => ({
      params,
      learnerId: await requireLearner(request, params.sid),
    }))
    .validate(async (state) => {
      // Read the body only after the caller is known to be in this class, so an
      // unauthenticated request cannot push 20 MB through the server first.
      const declared = Number(request.headers.get("content-length"));
      const maxBytes = uploadLimitBytes();

      if (Number.isFinite(declared) && declared > maxBytes + MULTIPART_OVERHEAD_BYTES) {
        const tooLarge = validateDeclaredBytes(maxBytes + 1, maxBytes);
        throw new AppError("MATERIAL_TOO_LARGE", tooLarge.ok ? "" : tooLarge.message, "file");
      }

      const form = await request.formData().catch(() => null);
      const file = form?.get("file");

      if (!(file instanceof File)) {
        throw new AppError(
          "UNSUPPORTED_EXTENSION",
          "Attach the lecture file as the `file` part of a multipart form.",
          "file",
        );
      }

      const filename = file.name.trim();
      // `dot > 0` rather than `>= 0`: a leading dot is a hidden file, not an
      // extension, and a name with no dot at all has none to read.
      const dot = filename.lastIndexOf(".");
      const ext = validateMaterialExtension(dot > 0 ? filename.slice(dot + 1) : "");
      if (!ext.ok) throw new AppError(ext.code, ext.message, "file");

      const size = validateDeclaredBytes(file.size, maxBytes);
      if (!size.ok) throw new AppError(size.code, size.message, "file");

      return { ...state, filename, ext: ext.value, file };
    })
    .read(async (state) => {
      const session = await getSession(state.params.sid);

      if (!session) {
        throw new AppError("SESSION_NOT_FOUND", "This class session was not found.");
      }

      // On the public demo the seeded lecture is shared by every visitor, so it
      // is never replaced; uploads go to the UPLOAD class instead.
      if (isPublicDemo() && session.isDemo) {
        throw new AppError(
          "DEMO_READ_ONLY",
          "The demo lecture can't be replaced on the public demo. Join with class code UPLOAD to try your own file.",
          "file",
        );
      }

      return { ...state, session };
    })
    .write(async (state, ctx) => {
      const result = await ingestUploadedMaterial({
        sessionId: state.session.sessionId,
        currentVersion: state.session.materialVersion,
        filename: state.filename,
        ext: state.ext,
        bytes: new Uint8Array(await state.file.arrayBuffer()),
        requestId: ctx.requestId,
      });

      if (!result.ok) {
        throw new AppError(FAILURE_CODES[result.reason], result.message, "file");
      }

      return result;
    })
    .project(
      (result) => ({
        materialVersion: result.material.version,
        filename: result.material.filename,
        ext: result.material.ext,
        bytes: result.material.bytes,
        status: result.material.status,
        stage: result.material.stage,
        charCount: result.material.charCount,
        unitCount: result.material.unitCount,
        // `s3` or `local` — never the key itself, which names a bucket path.
        storage: result.storage,
        poolStatus: result.pool.poolStatus,
        quizReady: result.pool.meetsEngineMinimum,
        topics: result.topics.map((topic) => ({
          topicId: topic.topicId,
          name: topic.name,
        })),
      }),
      { status: 201 },
    );
}
