import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { findFirst, updateMany, streamFile, saveFile, deleteFile } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  streamFile: vi.fn(),
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { parent: { findFirst, updateMany } } }));
vi.mock("@/lib/storage", () => ({ streamFile, saveFile, deleteFile }));

import { copyEnrollmentDocsToGuardians } from "./guardian-copy";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = Buffer.from("%PDF-1.4 hello");

const SRC = {
  ktp_ayah: { fileToken: "supabase:v1:enrollment/ea/doc-ktp_ayah-1.png", fileName: "ktp.png" },
  ktp_ibu: { fileToken: "supabase:v1:enrollment/ea/doc-ktp_ibu-2.png", fileName: "ktp2.png" },
  kk: { fileToken: "supabase:v1:enrollment/ea/doc-kk-3.pdf", fileName: "kk.pdf" },
};

function streamOf(bytes: Buffer) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(bytes));
      c.close();
    },
  });
}

/** Which Parent columns currently hold a token, keyed `${id}:${col}`. */
let columns: Record<string, string | null>;

beforeEach(() => {
  vi.clearAllMocks();
  columns = {};
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  findFirst.mockImplementation(async (arg: { where: { id: string }; select: Record<string, true> }) => {
    const col = Object.keys(arg.select)[0];
    return { [col]: columns[`${arg.where.id}:${col}`] ?? null };
  });
  streamFile.mockImplementation(async (token: string) => ({
    stream: streamOf(token.endsWith(".pdf") ? PDF : PNG),
    mimeType: "application/octet-stream",
    filename: "x",
  }));
  saveFile.mockImplementation(async (a: { entityId: string; field: string; file: { ext: string } }) => ({
    token: `supabase:v1:parents/${a.entityId}/${a.field}-abc.${a.file.ext}`,
  }));
  updateMany.mockResolvedValue({ count: 1 });
  deleteFile.mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

const run = (over: Record<string, unknown> = {}) =>
  copyEnrollmentDocsToGuardians({
    tenantId: "t-1",
    applicationDocuments: SRC,
    ayahId: "p-ayah",
    ibuId: "p-ibu",
    ...over,
  });

describe("copyEnrollmentDocsToGuardians", () => {
  it("copies KTP Ayah, KTP Ibu and KK (to Ayah) into each guardian's own parents/ path", async () => {
    expect(await run()).toEqual({ ktpAyah: "copied", ktpIbu: "copied", kk: "copied" });

    const saves = saveFile.mock.calls.map((c) => c[0]);
    expect(saves).toEqual([
      expect.objectContaining({ entity: "parents", entityId: "p-ayah", field: "ktp" }),
      expect.objectContaining({ entity: "parents", entityId: "p-ibu", field: "ktp" }),
      expect.objectContaining({ entity: "parents", entityId: "p-ayah", field: "kk" }),
    ]);
    expect(saves[0].file.ext).toBe("png");
    expect(saves[2].file.ext).toBe("pdf"); // ext comes from the bytes, not the claimed type
    expect(Buffer.isBuffer(saves[0].file.bytes)).toBe(true);

    expect(updateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: "p-ayah", tenantId: "t-1", ktpUrl: null }, data: { ktpUrl: "supabase:v1:parents/p-ayah/ktp-abc.png" } },
      { where: { id: "p-ibu", tenantId: "t-1", ktpUrl: null }, data: { ktpUrl: "supabase:v1:parents/p-ibu/ktp-abc.png" } },
      { where: { id: "p-ayah", tenantId: "t-1", kkUrl: null }, data: { kkUrl: "supabase:v1:parents/p-ayah/kk-abc.pdf" } },
    ]);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("puts the KK on the Ibu when the family has no Ayah", async () => {
    const out = await run({ ayahId: null });
    expect(out).toEqual({ ktpAyah: "missing", ktpIbu: "copied", kk: "copied" });
    expect(updateMany.mock.calls.at(-1)![0].where).toEqual({ id: "p-ibu", tenantId: "t-1", kkUrl: null });
  });

  it("reports missing when the source has no file token, or there is no parent", async () => {
    const out = await run({ applicationDocuments: { kk: { receivedPhysical: true }, ktp_ibu: { fileToken: "" } }, ibuId: null });
    expect(out).toEqual({ ktpAyah: "missing", ktpIbu: "missing", kk: "missing" });
    expect(streamFile).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("is missing-safe on a null / malformed documents column", async () => {
    for (const bad of [null, undefined, "x", [], { kk: "nope" }]) {
      expect(await run({ applicationDocuments: bad })).toEqual({ ktpAyah: "missing", ktpIbu: "missing", kk: "missing" });
    }
  });

  it("never overwrites a document the guardian already has", async () => {
    columns["p-ayah:ktpUrl"] = "supabase:v1:parents/p-ayah/ktp-old.jpg";
    const out = await run();
    expect(out).toEqual({ ktpAyah: "skipped_existing", ktpIbu: "copied", kk: "copied" });
    expect(saveFile.mock.calls.some((c) => c[0].entityId === "p-ayah" && c[0].field === "ktp")).toBe(false);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("deletes the copied object when the conditional write loses a race", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    columns["p-ayah:ktpUrl"] = null; // still empty when re-read ⇒ our object is orphaned
    const out = await run();
    expect(out.ktpAyah).toBe("skipped_existing");
    expect(deleteFile).toHaveBeenCalledWith("supabase:v1:parents/p-ayah/ktp-abc.png");
  });

  it("keeps the object when the race winner references the identical stored token", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    // First read (pre-copy) sees null, the re-read after the lost write sees the winner.
    findFirst.mockResolvedValueOnce({ ktpUrl: null }).mockResolvedValueOnce({ ktpUrl: "supabase:v1:parents/p-ayah/ktp-abc.png" });
    const out = await run();
    expect(out.ktpAyah).toBe("skipped_existing");
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("marks a copy failed (and carries on) when the source object cannot be read", async () => {
    streamFile.mockRejectedValueOnce(new Error("not found"));
    const out = await run();
    expect(out).toEqual({ ktpAyah: "failed", ktpIbu: "copied", kk: "copied" });
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("marks a copy failed when saving or the DB write throws, and never throws itself", async () => {
    saveFile.mockRejectedValue(new Error("storage down"));
    expect(await run()).toEqual({ ktpAyah: "failed", ktpIbu: "failed", kk: "failed" });
    saveFile.mockReset();
    findFirst.mockRejectedValue(new Error("db down"));
    await expect(run()).resolves.toEqual({ ktpAyah: "failed", ktpIbu: "failed", kk: "failed" });
  });

  it("a failed save leaves nothing to clean up", async () => {
    saveFile.mockRejectedValue(new Error("storage down"));
    await run();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("deletes the saved object when the conditional write throws (no sensitive orphan)", async () => {
    updateMany.mockRejectedValueOnce(new Error("db down"));
    const out = await run();
    expect(out).toEqual({ ktpAyah: "failed", ktpIbu: "copied", kk: "copied" });
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith("supabase:v1:parents/p-ayah/ktp-abc.png");
  });

  it("keeps the object when the write actually landed before throwing (column now references it)", async () => {
    updateMany.mockImplementationOnce(async () => {
      columns["p-ayah:ktpUrl"] = "supabase:v1:parents/p-ayah/ktp-abc.png";
      throw new Error("connection reset after commit");
    });
    const out = await run();
    expect(out.ktpAyah).toBe("failed");
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("does not delete when the cleanup re-read itself fails (cannot tell whether it is referenced)", async () => {
    updateMany.mockRejectedValueOnce(new Error("db down"));
    findFirst
      .mockResolvedValueOnce({ ktpUrl: null }) // pre-copy read
      .mockRejectedValueOnce(new Error("db still down")); // cleanup re-read
    const out = await run();
    expect(out.ktpAyah).toBe("failed");
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("swallows an error from the cleanup delete itself", async () => {
    updateMany.mockRejectedValueOnce(new Error("db down"));
    deleteFile.mockRejectedValueOnce(new Error("storage down"));
    await expect(run()).resolves.toEqual({ ktpAyah: "failed", ktpIbu: "copied", kk: "copied" });
    expect(deleteFile).toHaveBeenCalledTimes(1);
  });

  it("a throwing re-read after a lost race still reports skipped_existing and keeps the object", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    findFirst
      .mockResolvedValueOnce({ ktpUrl: null })
      .mockRejectedValueOnce(new Error("db down"));
    const out = await run();
    expect(out.ktpAyah).toBe("skipped_existing");
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("marks a copy failed when the bytes are not a JPEG, PNG or PDF", async () => {
    streamFile.mockImplementation(async () => ({ stream: streamOf(Buffer.from("MZ not an image")), mimeType: "image/png", filename: "x" }));
    expect(await run()).toEqual({ ktpAyah: "failed", ktpIbu: "failed", kk: "failed" });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("failed when the parent row is not in this tenant", async () => {
    findFirst.mockResolvedValue(null);
    expect((await run()).ktpAyah).toBe("failed");
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("logs failures without tokens or ids", async () => {
    streamFile.mockRejectedValue(new Error("boom supabase:v1:enrollment/ea/doc-kk-3.pdf"));
    await run();
    const logged = JSON.stringify((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls);
    expect(logged).not.toContain("supabase:v1");
    expect(logged).not.toContain("p-ayah");
  });
});
