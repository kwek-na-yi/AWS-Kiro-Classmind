import { beforeEach, describe, expect, it, vi } from "vitest";

import { MATERIAL_MAX_BYTES } from "@/lib/domain/validate-input";
import type { ClassSession } from "@/lib/types";

/**
 * `POST /api/sessions/{sid}/material` — the HTTP contract of the upload.
 *
 * Ingestion itself is mocked here and tested for real in
 * `lib/ingest/upload.test.ts`. What this file pins down is everything the
 * handler owns: who may upload, what a multipart body must look like, which
 * files are refused before a byte reaches storage, and how an ingestion outcome
 * becomes a status code and an envelope.
 */

const session = vi.hoisted(() => ({
  getSession: vi.fn(),
  assertLearnerInSession: vi.fn(),
}));

const upload = vi.hoisted(() => ({ ingestUploadedMaterial: vi.fn() }));

const logger = vi.hoisted(() => ({ logFallback: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/repo/session", () => session);
vi.mock("@/lib/ingest/upload", () => upload);
vi.mock("@/lib/aws/logger", () => logger);

const { POST } = await import("@/app/api/sessions/[sid]/material/route");

const DEMO: ClassSession = {
  sessionId: "demo",
  name: "Relational Databases",
  joinCode: "CM2026",
  instructorTokenHash: "hash",
  materialVersion: 1,
  isDemo: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const LECTURE_TEXT = "Normalisation removes redundancy from a schema. ".repeat(20);

const SUCCESS = {
  ok: true as const,
  material: {
    sessionId: "demo",
    version: 2,
    s3Key: "sessions/demo/material/v2/abc.md",
    filename: "week-4.md",
    ext: "md" as const,
    bytes: 940,
    status: "ready" as const,
    stage: "Generating quiz" as const,
    charCount: 940,
    unitCount: 4,
    poolStatus: "ready" as const,
  },
  topics: [
    { topicId: "normalisation", materialVersion: 2, order: 0, name: "Normalisation", unitIdxs: [0] },
    { topicId: "indexing", materialVersion: 2, order: 1, name: "Indexing", unitIdxs: [1] },
    { topicId: "joins", materialVersion: 2, order: 2, name: "Joins", unitIdxs: [2] },
  ],
  storage: "s3" as const,
  pool: { poolStatus: "ready" as const, itemCount: 12, meetsEngineMinimum: true },
};

const context = { params: Promise.resolve({ sid: "demo" }) };

function post(file: File | null, learnerId: string | null = "learner-1"): Request {
  const form = new FormData();
  if (file) form.append("file", file);

  return new Request("http://localhost/api/sessions/demo/material", {
    method: "POST",
    headers: learnerId ? { "x-learner-id": learnerId } : {},
    body: form,
  });
}

const textFile = (name: string, body = LECTURE_TEXT) =>
  new File([body], name, { type: "text/plain" });

beforeEach(() => {
  vi.clearAllMocks();
  session.assertLearnerInSession.mockResolvedValue(true);
  session.getSession.mockResolvedValue(DEMO);
  upload.ingestUploadedMaterial.mockResolvedValue(SUCCESS);
});

describe("a successful upload", () => {
  it("accepts the file and reports the material it produced", async () => {
    const response = await POST(post(textFile("week-4.md")), context);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.materialVersion).toBe(2);
    expect(body.filename).toBe("week-4.md");
    expect(body.status).toBe("ready");
    expect(body.storage).toBe("s3");
    expect(body.poolStatus).toBe("ready");
    expect(body.quizReady).toBe(true);
    expect(body.topics.map((topic: { name: string }) => topic.name)).toEqual([
      "Normalisation",
      "Indexing",
      "Joins",
    ]);
  });

  it("hands ingestion the session's current version, the filename and the bytes", async () => {
    await POST(post(textFile("week-4.md")), context);

    const input = upload.ingestUploadedMaterial.mock.calls[0][0];

    expect(input.sessionId).toBe("demo");
    expect(input.currentVersion).toBe(1);
    expect(input.filename).toBe("week-4.md");
    expect(input.ext).toBe("md");
    expect(new TextDecoder().decode(input.bytes)).toBe(LECTURE_TEXT);
  });

  it("never returns the storage key", async () => {
    const response = await POST(post(textFile("week-4.md")), context);
    const body = await response.text();

    expect(body).not.toContain("sessions/demo/material");
    expect(body).not.toContain("s3Key");
  });

  it.each(["notes.pdf", "notes.txt", "notes.md", "notes.markdown", "NOTES.PDF"])(
    "accepts %s",
    async (filename) => {
      const response = await POST(post(textFile(filename)), context);
      expect(response.status).toBe(201);
    },
  );
});

describe("access", () => {
  it("refuses a learner who is not in the session", async () => {
    session.assertLearnerInSession.mockResolvedValue(false);

    const response = await POST(post(textFile("week-4.md"), "stranger"), context);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("LEARNER_NOT_IN_SESSION");
    expect(upload.ingestUploadedMaterial).not.toHaveBeenCalled();
  });

  it("refuses a request with no Learner_Id", async () => {
    const response = await POST(post(textFile("week-4.md"), null), context);

    expect(response.status).toBe(403);
    expect(upload.ingestUploadedMaterial).not.toHaveBeenCalled();
  });

  it("returns 404 for a session that does not exist", async () => {
    session.getSession.mockResolvedValue(null);

    const response = await POST(post(textFile("week-4.md")), context);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("keeps the shared demo lecture read-only on the public demo", async () => {
    process.env.NEXT_PUBLIC_CLASSMIND_PUBLIC_DEMO = "1";
    try {
      const response = await POST(post(textFile("week-4.md")), context);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("DEMO_READ_ONLY");
      expect(body.error.message).toContain("UPLOAD");
      expect(upload.ingestUploadedMaterial).not.toHaveBeenCalled();
    } finally {
      delete process.env.NEXT_PUBLIC_CLASSMIND_PUBLIC_DEMO;
    }
  });
});

describe("validation", () => {
  it("rejects an unsupported extension", async () => {
    const response = await POST(post(textFile("slides.pptx")), context);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("UNSUPPORTED_EXTENSION");
    expect(body.error.message).toContain("pdf");
    expect(upload.ingestUploadedMaterial).not.toHaveBeenCalled();
  });

  it("rejects a filename with no extension at all", async () => {
    const response = await POST(post(textFile("lecture")), context);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("UNSUPPORTED_EXTENSION");
  });

  it("rejects an oversized file", async () => {
    const oversized = new File(
      [new Uint8Array(MATERIAL_MAX_BYTES + 1)],
      "huge.pdf",
      { type: "application/pdf" },
    );

    const response = await POST(post(oversized), context);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("MATERIAL_TOO_LARGE");
    expect(upload.ingestUploadedMaterial).not.toHaveBeenCalled();
  });

  it("enforces the lower 4 MB ceiling on a serverless host", async () => {
    process.env.VERCEL = "1";
    try {
      const fiveMb = new File([new Uint8Array(5 * 1024 * 1024)], "notes.txt", {
        type: "text/plain",
      });
      const response = await POST(post(fiveMb), context);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("MATERIAL_TOO_LARGE");
      expect(body.error.message).toContain("4 MB");
    } finally {
      delete process.env.VERCEL;
    }
  });

  it("rejects an empty file", async () => {
    const response = await POST(post(new File([], "empty.txt")), context);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("MATERIAL_TOO_LARGE");
    expect(body.error.message).toContain("1 byte");
    expect(upload.ingestUploadedMaterial).not.toHaveBeenCalled();
  });

  it("rejects a body with no file part", async () => {
    const response = await POST(post(null), context);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("UNSUPPORTED_EXTENSION");
    expect(body.error.field).toBe("file");
  });
});

describe("files ingestion cannot use", () => {
  it("reports a malformed PDF as unreadable", async () => {
    upload.ingestUploadedMaterial.mockResolvedValue({
      ok: false,
      reason: "unreadable",
      message: "This PDF could not be read.",
    });

    const response = await POST(post(textFile("broken.pdf")), context);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("NO_READABLE_TEXT");
    expect(body.error.message).toBe("This PDF could not be read.");
  });

  it("reports a scanned PDF as carrying too little text", async () => {
    upload.ingestUploadedMaterial.mockResolvedValue({
      ok: false,
      reason: "no_readable_text",
      message: "Only 12 characters of text could be read from this file.",
    });

    const response = await POST(post(textFile("scan.pdf")), context);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("NO_READABLE_TEXT");
  });

  it("reports a file ingestion found empty as a size failure", async () => {
    upload.ingestUploadedMaterial.mockResolvedValue({
      ok: false,
      reason: "empty_file",
      message: "The uploaded file is empty.",
    });

    const response = await POST(post(textFile("odd.txt")), context);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("MATERIAL_TOO_LARGE");
  });

  it("turns an unexpected failure into one INTERNAL envelope", async () => {
    upload.ingestUploadedMaterial.mockRejectedValue(new Error("bucket exploded"));

    const response = await POST(post(textFile("week-4.md")), context);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("bucket exploded");
  });
});
