import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LectureMaterial,
  QuizItem,
  SourceUnit,
  Topic,
} from "@/lib/types";

/**
 * The upload ingestion pipeline, exercised over real files.
 *
 * S3 and DynamoDB are the only things faked, and they are faked as *stores*
 * rather than as assertions: the object put is the object read back, so the
 * text this suite extracts is genuinely the text that round-tripped through
 * storage. Everything between — extraction, segmentation, Topic derivation,
 * Quiz_Pool generation — is the real implementation.
 */

// ---------------------------------------------------------------------------
// In-memory S3
// ---------------------------------------------------------------------------

const objects = new Map<string, Uint8Array>();

const s3 = vi.hoisted(() => ({
  putObject: vi.fn(),
  getObject: vi.fn(),
  objectExists: vi.fn(),
  deletePrefix: vi.fn(),
  listObjectKeys: vi.fn(),
  materialObjectKey: vi.fn(
    (sessionId: string, version: number, objectId: string, ext: string) =>
      `sessions/${sessionId}/material/v${version}/${objectId}.${ext}`,
  ),
  materialVersionPrefix: vi.fn(
    (sessionId: string, version: number) =>
      `sessions/${sessionId}/material/v${version}/`,
  ),
  sessionObjectPrefix: vi.fn((sessionId: string) => `sessions/${sessionId}/`),
}));

// ---------------------------------------------------------------------------
// In-memory DynamoDB, one entry per material version
// ---------------------------------------------------------------------------

interface VersionState {
  material: LectureMaterial;
  units: SourceUnit[];
  topics: Topic[];
  items: QuizItem[];
}

const versions = new Map<number, VersionState>();
let pointerVersion = 1;

const materialRepo = vi.hoisted(() => ({
  putMaterial: vi.fn(),
  getMaterial: vi.fn(),
  setMaterialStage: vi.fn(),
  setMaterialStatus: vi.fn(),
  putSourceUnits: vi.fn(),
  listSourceUnits: vi.fn(),
  putTopics: vi.fn(),
  listTopics: vi.fn(),
  setPoolStatus: vi.fn(),
  transitionPoolStatus: vi.fn(),
  purgeGeneratedForVersion: vi.fn(),
}));

const poolRepo = vi.hoisted(() => ({
  putQuizItems: vi.fn(),
  listQuizItems: vi.fn(),
}));

const sessionRepo = vi.hoisted(() => ({ setMaterialVersion: vi.fn() }));

const logger = vi.hoisted(() => ({ logFallback: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/aws/s3", () => s3);
vi.mock("@/lib/repo/material", () => materialRepo);
vi.mock("@/lib/repo/pool", () => poolRepo);
vi.mock("@/lib/repo/session", () => sessionRepo);
vi.mock("@/lib/aws/logger", () => logger);

const { ingestUploadedMaterial } = await import("@/lib/ingest/upload");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(path.resolve(process.cwd(), "tests/fixtures", name)));

const MARKDOWN = new Uint8Array(
  readFileSync(path.resolve(process.cwd(), "lib/demo/demo-lecture.md")),
);
const TXT = fixture("lecture-sample.txt");
const PDF = fixture("lecture-sample.pdf");
const SCANNED_PDF = fixture("scanned-no-text.pdf");

/** A file with a PDF header and nothing a parser can do with it. */
const MALFORMED_PDF = new TextEncoder().encode(
  "%PDF-1.7\nthis is not a pdf body, it is just some text pretending to be one\n%%EOF",
);

const ORIGINAL_TARGET = process.env.CLASSMIND_TARGET;

/** The local target writes uploaded bytes to disk; keep them out of the tree. */
const LOCAL_ROOT = mkdtempSync(path.join(tmpdir(), "classmind-upload-"));
process.env.CLASSMIND_LOCAL_MATERIAL_DIR = LOCAL_ROOT;

afterAll(() => {
  delete process.env.CLASSMIND_LOCAL_MATERIAL_DIR;
  rmSync(LOCAL_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  objects.clear();
  versions.clear();
  pointerVersion = 1;

  process.env.CLASSMIND_TARGET = "aws";

  s3.putObject.mockImplementation(async (key: string, bytes: Uint8Array) => {
    objects.set(key, bytes);
  });
  s3.getObject.mockImplementation(async (key: string) => {
    const bytes = objects.get(key);
    if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    return bytes;
  });
  s3.objectExists.mockImplementation(async (key: string) => objects.has(key));
  s3.deletePrefix.mockImplementation(async (prefix: string) => {
    let removed = 0;
    for (const key of [...objects.keys()]) {
      if (key.startsWith(prefix)) {
        objects.delete(key);
        removed += 1;
      }
    }
    return removed;
  });

  const state = (version: number): VersionState => {
    const existing = versions.get(version);
    if (existing) return existing;
    throw new Error(`No material at version ${version}`);
  };

  materialRepo.putMaterial.mockImplementation(
    async (_sessionId: string, material: LectureMaterial) => {
      versions.set(material.version, {
        material: { ...material },
        units: [],
        topics: [],
        items: [],
      });
    },
  );
  materialRepo.getMaterial.mockImplementation(
    async (_sessionId: string, version: number) =>
      versions.get(version)?.material ?? null,
  );
  materialRepo.setMaterialStatus.mockImplementation(
    async (
      _sessionId: string,
      version: number,
      update: Partial<LectureMaterial>,
    ) => {
      Object.assign(state(version).material, update);
    },
  );
  materialRepo.setMaterialStage.mockImplementation(
    async (_sessionId: string, version: number, stage: LectureMaterial["stage"]) => {
      state(version).material.stage = stage;
    },
  );
  materialRepo.putSourceUnits.mockImplementation(
    async (_sessionId: string, units: SourceUnit[]) => {
      state(units[0].materialVersion).units = [...units];
    },
  );
  materialRepo.listSourceUnits.mockImplementation(
    async (_sessionId: string, version: number) => versions.get(version)?.units ?? [],
  );
  materialRepo.putTopics.mockImplementation(
    async (_sessionId: string, topics: Topic[]) => {
      state(topics[0].materialVersion).topics = [...topics];
    },
  );
  materialRepo.listTopics.mockImplementation(
    async (_sessionId: string, version: number) => versions.get(version)?.topics ?? [],
  );
  materialRepo.setPoolStatus.mockImplementation(
    async (_sessionId: string, version: number, poolStatus: string) => {
      state(version).material.poolStatus = poolStatus as LectureMaterial["poolStatus"];
    },
  );
  materialRepo.transitionPoolStatus.mockImplementation(
    async (
      _sessionId: string,
      version: number,
      transition: { from: string; to: string },
    ) => {
      const material = state(version).material;
      if (material.poolStatus !== transition.from) return false;
      material.poolStatus = transition.to as LectureMaterial["poolStatus"];
      return true;
    },
  );
  materialRepo.purgeGeneratedForVersion.mockResolvedValue(0);

  poolRepo.putQuizItems.mockImplementation(
    async (_sessionId: string, items: QuizItem[]) => {
      if (items.length > 0) state(items[0].materialVersion).items = [...items];
    },
  );
  poolRepo.listQuizItems.mockImplementation(
    async (_sessionId: string, version: number) => versions.get(version)?.items ?? [],
  );

  sessionRepo.setMaterialVersion.mockImplementation(
    async (_sessionId: string, version: number) => {
      pointerVersion = version;
    },
  );
});

afterEach(() => {
  if (ORIGINAL_TARGET === undefined) delete process.env.CLASSMIND_TARGET;
  else process.env.CLASSMIND_TARGET = ORIGINAL_TARGET;
});

function upload(
  overrides: Partial<Parameters<typeof ingestUploadedMaterial>[0]> = {},
) {
  return ingestUploadedMaterial({
    sessionId: "demo",
    currentVersion: 1,
    filename: "week-4.md",
    ext: "md",
    bytes: MARKDOWN,
    requestId: "test",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------

describe("supported formats", () => {
  it("ingests Markdown end to end", async () => {
    const result = await upload();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.material.filename).toBe("week-4.md");
    expect(result.material.status).toBe("ready");
    expect(result.material.charCount).toBeGreaterThan(200);
    expect(result.material.unitCount).toBeGreaterThan(0);
    expect(result.topics.length).toBeGreaterThanOrEqual(3);
  });

  it("ingests plain text", async () => {
    const result = await upload({ filename: "notes.txt", ext: "txt", bytes: TXT });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.material.ext).toBe("txt");
    expect(result.topics.length).toBeGreaterThanOrEqual(3);
    // TXT cites line ranges, which is the reference kind its units must carry.
    expect(versions.get(2)?.units.every((unit) => unit.ref.kind === "lines")).toBe(true);
  });

  it("ingests a PDF, citing pages", async () => {
    const result = await upload({ filename: "slides.pdf", ext: "pdf", bytes: PDF });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.material.ext).toBe("pdf");
    expect(versions.get(2)?.units.every((unit) => unit.ref.kind === "page")).toBe(true);
  });
});

describe("storage", () => {
  it("puts the original file in S3 under the session and version prefix", async () => {
    await upload();

    const keys = [...objects.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^sessions\/demo\/material\/v2\/[0-9a-f-]+\.md$/);
    expect(objects.get(keys[0])).toEqual(MARKDOWN);
  });

  it("extracts from what came back out of storage, not from the input buffer", async () => {
    // The stored object is replaced before it is read back, so the source text
    // can only have come from the read.
    const replacement = new TextEncoder().encode(
      "# Sedimentation\n\n" +
        "Sediment settles out of still water in order of grain size. ".repeat(12),
    );

    s3.getObject.mockImplementation(async () => replacement);

    const result = await upload();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.topics.some((topic) => topic.name === "Sedimentation")).toBe(true);
  });

  it("records the object key on the material", async () => {
    const result = await upload();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.material.s3Key).toBe([...objects.keys()][0]);
    expect(result.storage).toBe("s3");
  });

  it("keeps uploaded bytes on disk when there is no bucket", async () => {
    process.env.CLASSMIND_TARGET = "local";

    const result = await upload();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.storage).toBe("local");
    expect(result.material.s3Key.startsWith("file://")).toBe(true);
    expect(s3.putObject).not.toHaveBeenCalled();
    expect(result.topics.length).toBeGreaterThanOrEqual(3);
  });
});

describe("persistence", () => {
  it("persists the material, its source units and its topics", async () => {
    const result = await upload();
    expect(result.ok).toBe(true);

    const stored = versions.get(2);
    expect(stored).toBeDefined();
    expect(stored?.units.length).toBeGreaterThan(0);
    expect(stored?.topics.length).toBeGreaterThanOrEqual(3);
    expect(stored?.material.status).toBe("ready");
  });

  it("numbers every source unit against the new material version", async () => {
    await upload({ currentVersion: 3 });

    const stored = versions.get(4);
    expect(stored?.units.every((unit) => unit.materialVersion === 4)).toBe(true);
    expect(stored?.topics.every((topic) => topic.materialVersion === 4)).toBe(true);
  });

  it("every topic points at source units that exist", async () => {
    await upload();

    const stored = versions.get(2);
    const indexes = new Set(stored?.units.map((unit) => unit.index));

    for (const topic of stored?.topics ?? []) {
      expect(topic.unitIdxs.length).toBeGreaterThan(0);
      for (const index of topic.unitIdxs) expect(indexes.has(index)).toBe(true);
    }
  });

  it("builds the quiz pool from the uploaded material", async () => {
    const result = await upload();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pool.poolStatus).toBe("ready");
    expect(result.pool.meetsEngineMinimum).toBe(true);

    const items = versions.get(2)?.items ?? [];
    const topicIds = new Set(result.topics.map((topic) => topic.topicId));

    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.every((item) => item.materialVersion === 2)).toBe(true);
    expect(items.every((item) => topicIds.has(item.topicId))).toBe(true);
  });

  it("points the class session at the new version, last", async () => {
    await upload();

    expect(sessionRepo.setMaterialVersion).toHaveBeenCalledWith("demo", 2);
    expect(pointerVersion).toBe(2);

    // Ordering: the pointer moves after the pool is durable, so a reader
    // resolving the version can never find a material without its quiz.
    const pointerCall = sessionRepo.setMaterialVersion.mock.invocationCallOrder[0];
    const itemsCall = poolRepo.putQuizItems.mock.invocationCallOrder[0];
    expect(pointerCall).toBeGreaterThan(itemsCall);
  });
});

describe("the previous material is left intact", () => {
  it("does not touch the version the class is currently on", async () => {
    // A seeded v1, exactly as the demo has one.
    versions.set(1, {
      material: {
        sessionId: "demo",
        version: 1,
        s3Key: "sessions/demo/material/v1/demo-lecture.md",
        filename: "demo-lecture.md",
        ext: "md",
        bytes: 2163,
        status: "ready",
        stage: "Generating quiz",
        charCount: 2000,
        unitCount: 5,
        poolStatus: "ready",
      },
      units: [],
      topics: [],
      items: [],
    });
    objects.set("sessions/demo/material/v1/demo-lecture.md", MARKDOWN);

    await upload();

    expect(versions.get(1)?.material.status).toBe("ready");
    expect(versions.get(1)?.material.filename).toBe("demo-lecture.md");
    expect(objects.has("sessions/demo/material/v1/demo-lecture.md")).toBe(true);
    expect(materialRepo.purgeGeneratedForVersion).not.toHaveBeenCalled();
  });
});

describe("files that cannot become a lecture", () => {
  it("declines an empty file", async () => {
    const result = await upload({ bytes: new Uint8Array(0) });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("empty_file");
    expect(objects.size).toBe(0);
  });

  it("declines a malformed PDF", async () => {
    const result = await upload({
      filename: "broken.pdf",
      ext: "pdf",
      bytes: MALFORMED_PDF,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unreadable");
  });

  it("declines a scanned PDF with no text layer", async () => {
    const result = await upload({
      filename: "scan.pdf",
      ext: "pdf",
      bytes: SCANNED_PDF,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Either outcome is correct for an image-only page: the parser may return
    // no text at all, or too little of it to build a class from.
    expect(["unreadable", "no_readable_text"]).toContain(result.reason);
  });

  it("declines a file with too little text to teach from", async () => {
    const result = await upload({
      filename: "stub.md",
      ext: "md",
      bytes: new TextEncoder().encode("# Hi\n\nToo short."),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_readable_text");
    expect(result.message).toContain("200");
  });

  it("writes nothing, and leaves no orphan object, when a file is declined", async () => {
    const result = await upload({
      filename: "broken.pdf",
      ext: "pdf",
      bytes: MALFORMED_PDF,
    });

    expect(result.ok).toBe(false);
    expect(objects.size).toBe(0);
    expect(materialRepo.putMaterial).not.toHaveBeenCalled();
    expect(materialRepo.putSourceUnits).not.toHaveBeenCalled();
    expect(materialRepo.putTopics).not.toHaveBeenCalled();
    expect(sessionRepo.setMaterialVersion).not.toHaveBeenCalled();
    // The class is still reading whatever it was reading before.
    expect(pointerVersion).toBe(1);
  });
});
