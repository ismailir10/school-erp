import { describe, it, expect } from "vitest";
import {
  DOCUMENT_ITEMS,
  DOCUMENT_KEYS,
  MAX_DOCUMENT_BYTES,
  REQUIRED_DOCUMENT_COUNT,
  documentProgress,
  isDocumentKey,
  missingRequiredDocuments,
  missingUploads,
  sanitizeDocumentFileName,
  sanitizeDocumentLabel,
  toAdminDocuments,
  toPublicDocuments,
} from "./documents";

const file = (over: Record<string, unknown> = {}) => ({
  fileToken: "supabase:v1:enrollment/ea/doc-akta-0123456789abcdef.pdf",
  fileName: "akta.pdf",
  mimeType: "application/pdf",
  size: 1234,
  uploadedAt: "2026-10-06T01:00:00.000Z",
  ...over,
});

describe("document items", () => {
  it("lists the paper form in order with 9 required items", () => {
    expect(DOCUMENT_KEYS).toEqual([
      "akta", "kk", "kia", "ktp_ayah", "ktp_ibu", "foto_anak", "foto_ayah", "foto_ibu",
      "surat_sehat", "surat_pindah", "lainnya",
    ]);
    expect(REQUIRED_DOCUMENT_COUNT).toBe(9);
    expect(DOCUMENT_ITEMS.filter((i) => !i.required).map((i) => i.key)).toEqual(["surat_pindah", "lainnya"]);
    expect(MAX_DOCUMENT_BYTES).toBe(4 * 1024 * 1024);
  });

  it("isDocumentKey is a strict whitelist", () => {
    expect(isDocumentKey("kk")).toBe(true);
    for (const bad of ["", "KK", "__proto__", "constructor", "toString", 1, null, undefined, {}]) {
      expect(isDocumentKey(bad)).toBe(false);
    }
  });
});

describe("toPublicDocuments", () => {
  it("never exposes fileToken and drops unknown keys", () => {
    const out = toPublicDocuments({ akta: file(), hacker: file(), lainnya: file({ label: "Ijazah TK" }) });
    expect(Object.keys(out)).toEqual(["akta", "lainnya"]);
    expect(JSON.stringify(out)).not.toContain("fileToken");
    expect(JSON.stringify(out)).not.toContain("supabase:v1");
    expect(out.lainnya?.label).toBe("Ijazah TK");
    expect(out.akta).toEqual({
      fileName: "akta.pdf",
      mimeType: "application/pdf",
      size: 1234,
      uploadedAt: "2026-10-06T01:00:00.000Z",
    });
  });

  it("skips entries without a file (physical-only or removed uploads)", () => {
    expect(toPublicDocuments({ kk: { receivedPhysical: true }, akta: { fileName: "x.pdf" } })).toEqual({});
  });

  it("is defensive against arbitrary JSON", () => {
    for (const raw of [null, undefined, "str", 5, [], [file()], { akta: "oops" }, { akta: [1] }, { akta: null }]) {
      expect(toPublicDocuments(raw)).toEqual({});
    }
    const out = toPublicDocuments({ akta: file({ size: "big", mimeType: 7, uploadedAt: {} }) });
    expect(out.akta).toEqual({ fileName: "akta.pdf", mimeType: "application/octet-stream", size: 0, uploadedAt: "" });
  });
});

describe("toAdminDocuments", () => {
  it("redacts the token and reports file + physical state", () => {
    const out = toAdminDocuments({
      akta: file(),
      kk: { receivedPhysical: true, receivedAt: "2026-10-06T02:00:00.000Z" },
      kia: { receivedPhysical: false, receivedAt: null },
      unknown: file(),
    });
    expect(JSON.stringify(out)).not.toContain("fileToken");
    expect(out.akta).toMatchObject({ hasFile: true, fileName: "akta.pdf", receivedPhysical: false, receivedAt: null });
    expect(out.kk).toEqual({
      hasFile: false, fileName: null, mimeType: null, size: null, uploadedAt: null,
      receivedPhysical: true, receivedAt: "2026-10-06T02:00:00.000Z",
    });
    expect(out.kia).toBeUndefined();
    expect("unknown" in out).toBe(false);
  });

  it("keeps a file and a physical tick together", () => {
    const out = toAdminDocuments({ akta: file({ receivedPhysical: true, receivedAt: "2026-10-06T03:00:00.000Z" }) });
    expect(out.akta).toMatchObject({ hasFile: true, receivedPhysical: true, receivedAt: "2026-10-06T03:00:00.000Z" });
  });

  it("is defensive against arbitrary JSON", () => {
    for (const raw of [null, "x", 1, [], { akta: 3 }, { akta: { fileToken: 5, receivedPhysical: "yes" } }]) {
      expect(toAdminDocuments(raw)).toEqual({});
    }
  });
});

describe("documentProgress / missingRequiredDocuments", () => {
  it("counts required items with a file OR a physical tick; ignores optional ones", () => {
    const raw = {
      akta: file(),
      kk: { receivedPhysical: true },
      surat_pindah: file(),
      lainnya: file(),
    };
    expect(documentProgress(raw)).toEqual({ done: 2, required: 9 });
    expect(documentProgress(toAdminDocuments(raw))).toEqual({ done: 2, required: 9 });
    expect(documentProgress(toPublicDocuments(raw))).toEqual({ done: 1, required: 9 });
  });

  it("is 0/9 for nothing and 9/9 when every required item is done", () => {
    expect(documentProgress(null)).toEqual({ done: 0, required: 9 });
    const all = Object.fromEntries(
      DOCUMENT_ITEMS.filter((i) => i.required).map((i) => [i.key, { receivedPhysical: true }]),
    );
    expect(documentProgress(all)).toEqual({ done: 9, required: 9 });
    expect(missingRequiredDocuments(all)).toEqual([]);
  });

  it("lists missing required keys in form order", () => {
    const missing = missingRequiredDocuments(toPublicDocuments({ kk: file(), foto_ibu: file() }));
    expect(missing).toEqual(["akta", "kia", "ktp_ayah", "ktp_ibu", "foto_anak", "foto_ayah", "surat_sehat"]);
  });
});

describe("sanitizeDocumentFileName / sanitizeDocumentLabel", () => {
  it("keeps the basename, drops separators and control chars", () => {
    expect(sanitizeDocumentFileName("C:\\scans\\../KK\u0000 asli.pdf", "kk", "pdf")).toBe("KK asli.pdf");
    expect(sanitizeDocumentFileName("/etc/passwd", "kk", "pdf")).toBe("passwd");
  });

  it("falls back to <key>.<ext> for empty, dots-only or non-string names", () => {
    for (const bad of ["", "   ", "..", "...", "a/", undefined, null, 42]) {
      expect(sanitizeDocumentFileName(bad, "kk", "jpg")).toBe("kk.jpg");
    }
  });

  it("caps at 120 chars and keeps a short extension", () => {
    const out = sanitizeDocumentFileName(`${"x".repeat(400)}.jpeg`, "kk", "jpg");
    expect(out).toHaveLength(120);
    expect(out.endsWith(".jpeg")).toBe(true);
  });

  it("label: trims, collapses whitespace, caps at 80, null when empty", () => {
    expect(sanitizeDocumentLabel("  Ijazah \n TK  ")).toBe("Ijazah TK");
    expect(sanitizeDocumentLabel("y".repeat(200))).toHaveLength(80);
    for (const bad of ["", "  \t ", null, 3]) expect(sanitizeDocumentLabel(bad)).toBeNull();
  });
});

describe("missingUploads", () => {
  it("returns required keys with no uploaded file, in form order", () => {
    const raw = { kk: file(), akta: { receivedPhysical: true, receivedAt: "2026-10-06T01:00:00.000Z" } };
    expect(missingUploads(raw, ["surat_sehat", "kk", "akta"])).toEqual(["akta", "surat_sehat"]);
  });

  it("is empty when nothing is required or everything required is uploaded", () => {
    expect(missingUploads(null, [])).toEqual([]);
    expect(missingUploads({ kk: file() }, ["kk"])).toEqual([]);
  });

  it("treats a missing / malformed column as everything missing", () => {
    for (const bad of [null, undefined, "x", [], 5]) expect(missingUploads(bad, ["kk"])).toEqual(["kk"]);
    expect(missingUploads({ kk: { fileToken: "" } }, ["kk"])).toEqual(["kk"]);
    expect(missingUploads({ kk: "nope" }, ["kk"])).toEqual(["kk"]);
  });

  it("a physical-receipt tick never counts, in any shape", () => {
    expect(missingUploads({ kk: { receivedPhysical: true } }, ["kk"])).toEqual(["kk"]);
    expect(missingUploads({ kk: { hasFile: false, receivedPhysical: true } }, ["kk"])).toEqual(["kk"]);
  });

  it("accepts the admin and public views as well as the raw column", () => {
    expect(missingUploads(toAdminDocuments({ kk: file() }), ["kk", "akta"])).toEqual(["akta"]);
    expect(missingUploads(toPublicDocuments({ kk: file() }), ["kk", "akta"])).toEqual(["akta"]);
  });

  it("ignores keys that are not document keys", () => {
    expect(missingUploads({}, ["kk", "paspor" as never])).toEqual(["kk"]);
  });
});
