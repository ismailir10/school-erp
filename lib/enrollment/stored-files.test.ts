import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUnique, deleteFile } = vi.hoisted(() => ({ findUnique: vi.fn(), deleteFile: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { enrollmentApplication: { findUnique } } }));
vi.mock("@/lib/storage", () => ({ deleteFile }));

import { randomSegment, deleteQuietly, discardIfUnreferenced } from "./stored-files";

beforeEach(() => {
  vi.clearAllMocks();
  deleteFile.mockResolvedValue(undefined);
});

describe("randomSegment", () => {
  it("is [a-zA-Z0-9] of the requested length (default 10), safe as a storage segment", () => {
    for (let i = 0; i < 200; i++) expect(randomSegment()).toMatch(/^[a-zA-Z0-9]{10}$/);
    expect(randomSegment(16)).toMatch(/^[a-zA-Z0-9]{16}$/);
  });

  it("does not repeat across many draws", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => randomSegment()));
    expect(seen.size).toBe(2000);
  });
});

describe("deleteQuietly", () => {
  it("ignores null and swallows storage errors", async () => {
    await deleteQuietly(null);
    expect(deleteFile).not.toHaveBeenCalled();
    deleteFile.mockRejectedValue(new Error("down"));
    await expect(deleteQuietly("supabase:v1:enrollment/a/doc-kk-x.pdf")).resolves.toBeUndefined();
  });
});

describe("discardIfUnreferenced", () => {
  const TOKEN = "supabase:v1:enrollment/a/doc-kk-abc.pdf";

  it("deletes when no key in the column references the token", async () => {
    findUnique.mockResolvedValue({ documents: { kk: { fileToken: "other" }, akta: "junk" } });
    await discardIfUnreferenced("a", "documents", TOKEN);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "a" }, select: { documents: true } });
    expect(deleteFile).toHaveBeenCalledWith(TOKEN);
  });

  it("keeps it while any key still references it (fileToken or signatureToken)", async () => {
    findUnique.mockResolvedValue({ documents: { ktp_ayah: { fileToken: TOKEN } } });
    await discardIfUnreferenced("a", "documents", TOKEN);
    findUnique.mockResolvedValue({ consentData: { ibu: { signatureToken: TOKEN } } });
    await discardIfUnreferenced("a", "consentData", TOKEN);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("treats an empty/non-object column as unreferenced, and never throws", async () => {
    for (const v of [null, "x", [], { kk: null }]) {
      findUnique.mockResolvedValue({ documents: v });
      await discardIfUnreferenced("a", "documents", TOKEN);
    }
    expect(deleteFile).toHaveBeenCalledTimes(4);
    findUnique.mockRejectedValue(new Error("db down"));
    await expect(discardIfUnreferenced("a", "documents", TOKEN)).resolves.toBeUndefined();
    await expect(discardIfUnreferenced("a", "documents", null)).resolves.toBeUndefined();
  });
});
