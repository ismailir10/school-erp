import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { findUnique, updateMany: update, programFindFirst, writeConsent } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  programFindFirst: vi.fn(),
  writeConsent: vi.fn(),
}));

vi.mock("@/lib/enrollment/json-merge", () => ({ writeConsentPreservingSignatures: writeConsent }));

vi.mock("@/lib/db", () => ({
  prisma: {
    enrollmentApplication: { findUnique, updateMany: update },
    program: { findFirst: programFindFirst },
  },
}));

import { PATCH } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/enrollments/token/tok", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ token: "tok" }) };
const future = new Date(Date.now() + 86_400_000);

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  update.mockResolvedValue({ count: 1 });
  writeConsent.mockResolvedValue(true);
  programFindFirst.mockResolvedValue({ id: "c" + "a".repeat(24) });
});

describe("PATCH /api/enrollments/token/[token] (draft save)", () => {
  it("404 for an unknown token", async () => {
    findUnique.mockResolvedValue(null);
    const res = await PATCH(req({ studentData: { childName: "X" } }), ctx);
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("410 for an expired token", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: new Date(Date.now() - 1000) });
    const res = await PATCH(req({ studentData: {} }), ctx);
    expect(res.status).toBe(410);
  });

  it("409 when already submitted", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "SUBMITTED", tokenExpiresAt: future });
    const res = await PATCH(req({ studentData: {} }), ctx);
    expect(res.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("saves only the provided blobs and mirrors childName", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });
    const res = await PATCH(req({ studentData: { childName: "  Aisyah  " }, dcareAddon: true }), ctx);
    expect(res.status).toBe(200);
    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "a", status: "INVITED" });
    expect(arg.data.studentData).toEqual({ childName: "  Aisyah  " });
    expect(arg.data.childName).toBe("Aisyah");
    expect(arg.data.dcareAddon).toBe(true);
    expect("ayahData" in arg.data).toBe(false);
  });

  it("normalizes empty programId to null", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });
    await PATCH(req({ programId: "" }), ctx);
    expect(update.mock.calls[0][0].data.programId).toBeNull();
  });

  it("persists a prefixed (non-cuid) programId that belongs to the tenant", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });
    programFindFirst.mockResolvedValue({ id: "program_ab57fd0432e25d5b3013" });
    await PATCH(req({ programId: "program_ab57fd0432e25d5b3013" }), ctx);
    expect(update.mock.calls[0][0].data.programId).toBe("program_ab57fd0432e25d5b3013");
  });

  it("drops (does not persist) a programId that fails the tenant-ownership check", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });
    programFindFirst.mockResolvedValue(null);
    const res = await PATCH(req({ programId: "program_from-another-tenant" }), ctx);
    expect(res.status).toBe(200);
    // Nothing left to write, so no update at all (and certainly no programId).
    expect(update).not.toHaveBeenCalled();
  });
});

describe("PATCH — consentData and signatures", () => {
  const invited = () =>
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });

  it("writes consentData through the signature-preserving helper, never via prisma.update", async () => {
    invited();
    const res = await PATCH(req({ consentData: { agreed: true, ayah: { name: "A" }, ibu: { name: "B" } } }), ctx);
    expect(res.status).toBe(200);
    expect(writeConsent).toHaveBeenCalledWith("a", { agreed: true, ayah: { name: "A" }, ibu: { name: "B" } });
    expect(update).not.toHaveBeenCalled(); // nothing else to write
  });

  it("strips the staff-recorded marker so a token holder cannot pre-seed it", async () => {
    invited();
    await PATCH(
      req({ consentData: { agreed: true, staffRecorded: true, note: "Disetujui langsung di sekolah", by: "u-1", at: "2026-10-11T00:00:00.000Z" } }),
      ctx,
    );
    expect(writeConsent.mock.calls[0][1]).toEqual({ agreed: true, ayah: {}, ibu: {} });
  });

  it("strips client-sent signatureToken/signedAt and forces ayah/ibu to objects", async () => {
    invited();
    await PATCH(
      req({
        consentData: {
          agreed: false,
          ayah: { name: "A", signatureToken: "", signedAt: "2020-01-01" },
          ibu: "not-an-object",
        },
      }),
      ctx,
    );
    const [, incoming] = writeConsent.mock.calls[0];
    expect(incoming).toEqual({ agreed: false, ayah: { name: "A" }, ibu: {} });
    expect(JSON.stringify(incoming)).not.toContain("signatureToken");
  });

  it("keeps the single-parent flag (R2-P-10) in the saved consent blob so resume can restore it", async () => {
    invited();
    await PATCH(req({ consentData: { agreed: false, onlyParent: "ibu", ayah: { name: "" }, ibu: { name: "Siti" } } }), ctx);
    expect(writeConsent.mock.calls[0][1]).toEqual({
      agreed: false,
      onlyParent: "ibu",
      ayah: { name: "" },
      ibu: { name: "Siti" },
    });
  });

  it("creates ayah/ibu objects when the client sends consentData without them", async () => {
    invited();
    await PATCH(req({ consentData: { agreed: true } }), ctx);
    expect(writeConsent.mock.calls[0][1]).toEqual({ agreed: true, ayah: {}, ibu: {} });
  });

  it("409 and no other write when the INVITED-guarded consent write matches no row", async () => {
    invited();
    writeConsent.mockResolvedValue(false);
    const res = await PATCH(req({ consentData: { agreed: true }, dcareAddon: true }), ctx);
    expect(res.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("still updates the remaining fields alongside consentData", async () => {
    invited();
    await PATCH(req({ consentData: { agreed: true }, dcareAddon: true }), ctx);
    expect(writeConsent).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toEqual({ dcareAddon: true });
    expect("consentData" in update.mock.calls[0][0].data).toBe(false);
  });

  it("skips prisma.update entirely for an empty patch", async () => {
    invited();
    const res = await PATCH(req({}), ctx);
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
    expect(writeConsent).not.toHaveBeenCalled();
  });

  it("ignores a client-sent `documents` key (zod strips it; documents are never written here)", async () => {
    invited();
    const res = await PATCH(req({ documents: { akta: { fileToken: "evil" } }, dcareAddon: true }), ctx);
    expect(res.status).toBe(200);
    expect(JSON.stringify(update.mock.calls[0][0])).not.toContain("evil");
    expect("documents" in update.mock.calls[0][0].data).toBe(false);
    // a body with ONLY documents degrades to a no-op
    update.mockClear();
    await PATCH(req({ documents: { akta: { fileToken: "evil" } } }), ctx);
    expect(update).not.toHaveBeenCalled();
    expect(writeConsent).not.toHaveBeenCalled();
  });

  it("409 ALREADY_SUBMITTED when the INVITED-guarded update matches no row", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });
    update.mockResolvedValue({ count: 0 });
    const res = await PATCH(req({ dcareAddon: true }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ALREADY_SUBMITTED");
  });
});
