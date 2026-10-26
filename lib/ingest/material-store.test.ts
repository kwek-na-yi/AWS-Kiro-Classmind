import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The material store, exercised on both targets.
 *
 * S3 is mocked throughout — object storage is never required to run the tests,
 * so the local fixture path stays the one the suite depends on.
 */

const s3 = vi.hoisted(() => ({
  putObject: vi.fn(),
  getObject: vi.fn(),
  objectExists: vi.fn(),
  deletePrefix: vi.fn(),
  materialObjectKey: vi.fn(
    (sessionId: string, version: number, objectId: string, ext: string) =>
      `sessions/${sessionId}/material/v${version}/${objectId}.${ext}`,
  ),
  materialVersionPrefix: vi.fn(
    (sessionId: string, version: number) =>
      `sessions/${sessionId}/material/v${version}/`,
  ),
}));

vi.mock("@/lib/aws/s3", () => s3);

const {
  contentTypeFor,
  isObjectKey,
  loadMaterialBytes,
  localMaterialKey,
  materialExists,
  purgeLocalSessionFiles,
  purgeMaterialVersion,
  storeMaterialBytes,
} = await import("@/lib/ingest/material-store");

const FIXTURE = path.resolve(process.cwd(), "lib/demo/demo-lecture.md");
const FIXTURE_BYTES = new Uint8Array(readFileSync(FIXTURE));

const ORIGINAL_TARGET = process.env.CLASSMIND_TARGET;

/** A throwaway root, so an uploaded-material test never writes into the tree. */
const LOCAL_ROOT = mkdtempSync(path.join(tmpdir(), "classmind-material-"));
process.env.CLASSMIND_LOCAL_MATERIAL_DIR = LOCAL_ROOT;

afterAll(() => {
  delete process.env.CLASSMIND_LOCAL_MATERIAL_DIR;
  rmSync(LOCAL_ROOT, { recursive: true, force: true });
});

function target(value: "local" | "aws"): void {
  process.env.CLASSMIND_TARGET = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  s3.putObject.mockResolvedValue(undefined);
  s3.getObject.mockResolvedValue(FIXTURE_BYTES);
  s3.objectExists.mockResolvedValue(true);
  s3.deletePrefix.mockResolvedValue(3);
});

afterEach(() => {
  if (ORIGINAL_TARGET === undefined) delete process.env.CLASSMIND_TARGET;
  else process.env.CLASSMIND_TARGET = ORIGINAL_TARGET;
});

describe("on the AWS target", () => {
  beforeEach(() => target("aws"));

  it("uploads to S3 and returns the object key", async () => {
    const stored = await storeMaterialBytes({
      sessionId: "demo",
      version: 1,
      ext: "md",
      bytes: FIXTURE_BYTES,
      objectId: "demo-lecture",
      contentType: "text/markdown",
    });

    expect(stored.storage).toBe("s3");
    expect(stored.key).toBe("sessions/demo/material/v1/demo-lecture.md");
    expect(stored.bytes).toBe(FIXTURE_BYTES.byteLength);

    expect(s3.putObject).toHaveBeenCalledWith(
      "sessions/demo/material/v1/demo-lecture.md",
      FIXTURE_BYTES,
      "text/markdown",
    );
  });

  it("reads the bytes back through S3", async () => {
    const bytes = await loadMaterialBytes("sessions/demo/material/v1/demo-lecture.md");

    expect(s3.getObject).toHaveBeenCalledWith(
      "sessions/demo/material/v1/demo-lecture.md",
    );
    expect(bytes.byteLength).toBe(FIXTURE_BYTES.byteLength);
  });

  it("uses a stable key, so a reseed replaces the object", async () => {
    const first = await storeMaterialBytes({
      sessionId: "demo",
      version: 1,
      ext: "md",
      bytes: FIXTURE_BYTES,
      objectId: "demo-lecture",
    });

    const second = await storeMaterialBytes({
      sessionId: "demo",
      version: 1,
      ext: "md",
      bytes: FIXTURE_BYTES,
      objectId: "demo-lecture",
    });

    expect(second.key).toBe(first.key);
  });

  it("checks existence through S3", async () => {
    await expect(materialExists("sessions/demo/material/v1/x.md")).resolves.toBe(true);
    expect(s3.objectExists).toHaveBeenCalled();
  });

  it("purges a material version's objects", async () => {
    await expect(purgeMaterialVersion("demo", 1)).resolves.toBe(3);
    expect(s3.deletePrefix).toHaveBeenCalledWith("sessions/demo/material/v1/");
  });
});

describe("on the local target", () => {
  beforeEach(() => target("local"));

  it("records the file on disk instead of uploading", async () => {
    const stored = await storeMaterialBytes({
      sessionId: "demo",
      version: 1,
      ext: "md",
      bytes: FIXTURE_BYTES,
      objectId: "demo-lecture",
      sourcePath: FIXTURE,
    });

    expect(stored.storage).toBe("local");
    expect(stored.key.startsWith("file://")).toBe(true);
    expect(s3.putObject).not.toHaveBeenCalled();
  });

  it("reads the bytes back from disk", async () => {
    const key = localMaterialKey(FIXTURE);
    const bytes = await loadMaterialBytes(key);

    expect(bytes.byteLength).toBe(FIXTURE_BYTES.byteLength);
    expect(s3.getObject).not.toHaveBeenCalled();
  });

  it("writes uploaded bytes to the local material root", async () => {
    // An upload has no file on disk to point at, so the bytes are written under
    // the same session/version layout S3 would have used.
    const stored = await storeMaterialBytes({
      sessionId: "demo",
      version: 4,
      ext: "md",
      bytes: FIXTURE_BYTES,
      objectId: "uploaded",
    });

    expect(stored.storage).toBe("local");
    expect(stored.bytes).toBe(FIXTURE_BYTES.byteLength);
    expect(stored.key).toContain("sessions/demo/material/v4/uploaded.md");
    expect(s3.putObject).not.toHaveBeenCalled();

    // And it reads back as itself, which is what extraction depends on.
    const bytes = await loadMaterialBytes(stored.key);
    expect(bytes.byteLength).toBe(FIXTURE_BYTES.byteLength);
    expect(s3.getObject).not.toHaveBeenCalled();
  });

  it("reports an uploaded material as present", async () => {
    const stored = await storeMaterialBytes({
      sessionId: "demo",
      version: 5,
      ext: "txt",
      bytes: FIXTURE_BYTES,
      objectId: "uploaded",
    });

    await expect(materialExists(stored.key)).resolves.toBe(true);
  });

  it("reports a missing local file as absent rather than throwing", async () => {
    await expect(materialExists(localMaterialKey("no/such/file.md"))).resolves.toBe(
      false,
    );
  });

  it("refuses ids that would write outside the material root", async () => {
    for (const sessionId of ["../escape", "..", "a/b", "a\\b", ""]) {
      await expect(
        storeMaterialBytes({
          sessionId,
          version: 1,
          ext: "md",
          bytes: FIXTURE_BYTES,
          objectId: "uploaded",
        }),
      ).rejects.toThrow(RangeError);
    }

    await expect(
      storeMaterialBytes({
        sessionId: "demo",
        version: 1,
        ext: "md",
        bytes: FIXTURE_BYTES,
        objectId: "../../outside",
      }),
    ).rejects.toThrow(RangeError);
  });

  it("refuses to delete outside the material root", async () => {
    await expect(purgeLocalSessionFiles("../..")).rejects.toThrow(RangeError);
  });

  it("never reaches S3 for an object key, even one left over from the AWS target", async () => {
    await expect(loadMaterialBytes("sessions/demo/material/v1/x.md")).rejects.toThrow(
      /only available with CLASSMIND_TARGET=aws/,
    );
    await expect(materialExists("sessions/demo/material/v1/x.md")).resolves.toBe(false);
    expect(s3.getObject).not.toHaveBeenCalled();
    expect(s3.objectExists).not.toHaveBeenCalled();
  });

  it("purges nothing, because the file belongs to the developer", async () => {
    await expect(purgeMaterialVersion("demo", 1)).resolves.toBe(0);
    expect(s3.deletePrefix).not.toHaveBeenCalled();
  });
});

describe("key classification", () => {
  it("distinguishes an object key from a local one", () => {
    expect(isObjectKey("sessions/demo/material/v1/x.md")).toBe(true);
    expect(isObjectKey(localMaterialKey("C:/lectures/x.md"))).toBe(false);
  });

  it("normalises Windows separators so a key is portable", () => {
    expect(localMaterialKey("C:\\lectures\\x.md")).not.toContain("\\");
  });
});

describe("content types", () => {
  it("maps every supported extension", () => {
    expect(contentTypeFor("pdf")).toBe("application/pdf");
    expect(contentTypeFor("md")).toBe("text/markdown");
    expect(contentTypeFor("markdown")).toBe("text/markdown");
    expect(contentTypeFor("txt")).toBe("text/plain");
  });
});
