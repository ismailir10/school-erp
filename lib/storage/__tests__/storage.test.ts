import { describe, it, expect, beforeEach, vi } from "vitest";

// The adapter delegates upload/download/remove to `./supabase`. Mock the
// whole module so the tests stay backend-agnostic — we exercise the adapter
// contract (token format, path-traversal defense, legacy handling), not
// Supabase-SDK semantics (covered separately in supabase.test.ts).
const { uploadObjectMock, downloadObjectMock, removeObjectMock } = vi.hoisted(() => ({
  uploadObjectMock: vi.fn(),
  downloadObjectMock: vi.fn(),
  removeObjectMock: vi.fn(),
}));

vi.mock("../supabase", () => ({
  uploadObject: uploadObjectMock,
  downloadObject: downloadObjectMock,
  removeObject: removeObjectMock,
}));

import { saveFile, streamFile, deleteFile, __internal } from "../index";

async function consumeStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

// In-memory "bucket" so saveFile then streamFile round-trips. Keyed by path.
const fakeBucket = new Map<string, Buffer>();

beforeEach(() => {
  fakeBucket.clear();
  uploadObjectMock.mockReset();
  downloadObjectMock.mockReset();
  removeObjectMock.mockReset();

  uploadObjectMock.mockImplementation(async ({ path, bytes }: { path: string; bytes: Buffer }) => {
    fakeBucket.set(path, bytes);
  });
  downloadObjectMock.mockImplementation(async (path: string) => {
    const bytes = fakeBucket.get(path);
    if (!bytes) throw new Error("ENOENT");
    return { bytes, mimeType: "application/octet-stream" };
  });
  removeObjectMock.mockImplementation(async (path: string) => {
    fakeBucket.delete(path);
  });
});

describe("storage adapter — round-trip", () => {
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]);

  it("saves a file and streams it back with the same bytes + correct mime", async () => {
    const { token } = await saveFile({
      entity: "students",
      entityId: "stu_abc123",
      field: "photo",
      file: { bytes: jpegBytes, mimeType: "image/jpeg", ext: "jpg" },
    });
    expect(token).toMatch(/^supabase:v1:students\/stu_abc123\/photo-[a-f0-9]{16}\.jpg$/);
    expect(uploadObjectMock).toHaveBeenCalledTimes(1);
    const call = uploadObjectMock.mock.calls[0][0];
    expect(call.path).toMatch(/^students\/stu_abc123\/photo-[a-f0-9]{16}\.jpg$/);
    expect(call.mimeType).toBe("image/jpeg");
    expect(Buffer.isBuffer(call.bytes)).toBe(true);

    const { stream, mimeType, filename } = await streamFile(token);
    expect(mimeType).toBe("image/jpeg");
    expect(filename).toMatch(/^photo-[a-f0-9]{16}\.jpg$/);
    const back = await consumeStream(stream);
    expect(back.equals(jpegBytes)).toBe(true);
  });

  it("delete removes the file; second delete is a no-op", async () => {
    const { token } = await saveFile({
      entity: "students",
      entityId: "stu_delete",
      field: "photo",
      file: { bytes: jpegBytes, mimeType: "image/jpeg", ext: "jpg" },
    });
    await deleteFile(token);
    await expect(streamFile(token)).rejects.toThrow();
    // ENOENT on a second delete must not throw — emulate Supabase "not found".
    removeObjectMock.mockResolvedValueOnce(undefined);
    await expect(deleteFile(token)).resolves.toBeUndefined();
  });

  it("same bytes produce the same token (content-addressed)", async () => {
    const a = await saveFile({
      entity: "students",
      entityId: "stu_idemp",
      field: "photo",
      file: { bytes: jpegBytes, mimeType: "image/jpeg", ext: "jpg" },
    });
    const b = await saveFile({
      entity: "students",
      entityId: "stu_idemp",
      field: "photo",
      file: { bytes: jpegBytes, mimeType: "image/jpeg", ext: "jpg" },
    });
    expect(a.token).toBe(b.token);
  });

  it("works for a different entity + field (entity-generic, no hardcoded 'students'/'photo')", async () => {
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const { token } = await saveFile({
      entity: "parents",
      entityId: "par_xyz",
      field: "ktp",
      file: { bytes: pdfBytes, mimeType: "application/pdf", ext: "pdf" },
    });
    expect(token).toMatch(/^supabase:v1:parents\/par_xyz\/ktp-[a-f0-9]{16}\.pdf$/);
    const { mimeType } = await streamFile(token);
    expect(mimeType).toBe("application/pdf");
  });
});

describe("storage adapter — path-traversal defense", () => {
  const cases = [
    "supabase:v1:../etc/passwd",
    "supabase:v1:students/../../../etc/passwd",
    "supabase:v1:students/stu/..%2fphoto.jpg",
    "supabase:v1:students/stu/photo\0.jpg",
    "supabase:v1:/etc/passwd",
    "supabase:v1:students\\stu\\photo.jpg",
    "wrong-prefix:students/stu/photo.jpg",
    "supabase:v1:students/stu/photo.exe", // ext not whitelisted
    "supabase:v1:students/stu/photo", // no ext
    "supabase:v1:students/stu/photo/extra/segment.jpg", // too many segments
  ];

  for (const token of cases) {
    it(`rejects malicious token: ${token}`, async () => {
      expect(() => __internal.parseToken(token)).toThrow();
      await expect(streamFile(token)).rejects.toThrow();
      expect(downloadObjectMock).not.toHaveBeenCalled();
    });
  }
});

describe("storage adapter — input validation", () => {
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]);

  it("rejects entity with path-traversal chars", async () => {
    await expect(
      saveFile({
        entity: "../etc",
        entityId: "x",
        field: "photo",
        file: { bytes: jpegBytes, mimeType: "image/jpeg", ext: "jpg" },
      }),
    ).rejects.toThrow();
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported ext", async () => {
    await expect(
      saveFile({
        entity: "students",
        entityId: "x",
        field: "photo",
        file: { bytes: jpegBytes, mimeType: "application/x-msdownload", ext: "exe" },
      }),
    ).rejects.toThrow();
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });
});

describe("storage adapter — missing object handling", () => {
  it("streamFile propagates ENOENT for a valid token whose object is absent", async () => {
    // Hand-craft a token that passes validation but points at no object.
    const token = "supabase:v1:students/stu_missing/photo-deadbeefdeadbeef.jpg";
    await expect(streamFile(token)).rejects.toThrow(/ENOENT/);
  });

  it("saveFile propagates upload errors from the backend", async () => {
    uploadObjectMock.mockRejectedValueOnce(new Error("bucket misconfigured"));
    await expect(
      saveFile({
        entity: "students",
        entityId: "stu_err",
        field: "photo",
        file: { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), mimeType: "image/jpeg", ext: "jpg" },
      }),
    ).rejects.toThrow(/bucket misconfigured/);
  });
});

describe("storage adapter — legacy local:v1 token degrade", () => {
  it("streamFile on a syntactically-valid legacy token throws 'Legacy local-disk token'", async () => {
    const legacy = "local:v1:parents/par_legacy/ktp-deadbeefdeadbeef.jpg";
    expect(() => __internal.parseToken(legacy)).not.toThrow();
    await expect(streamFile(legacy)).rejects.toThrow(/Legacy local-disk token/);
    expect(downloadObjectMock).not.toHaveBeenCalled();
  });

  it("deleteFile on a legacy token is a no-op (no Supabase call)", async () => {
    const legacy = "local:v1:parents/par_legacy/kk-deadbeefdeadbeef.jpg";
    await expect(deleteFile(legacy)).resolves.toBeUndefined();
    expect(removeObjectMock).not.toHaveBeenCalled();
  });

  it("legacy token with traversal payload is rejected even before backend dispatch", async () => {
    const malicious = "local:v1:../etc/passwd";
    await expect(streamFile(malicious)).rejects.toThrow();
    expect(downloadObjectMock).not.toHaveBeenCalled();
  });
});
