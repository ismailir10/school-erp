import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { findUnique, update, getSession, isAdminRole, programFindFirst, mergeJsonKey } = vi.hoisted(() => ({
  mergeJsonKey: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
  programFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { enrollmentApplication: { findUnique, update }, program: { findFirst: programFindFirst } },
}));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));
vi.mock("@/lib/enrollment/json-merge", () => ({ mergeJsonKey }));

import { GET, PATCH } from "../route";

const ctx = (id = "ea-1") => ({ params: Promise.resolve({ id }) });
function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/enrollments/ea-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SUPER_ADMIN" });
  isAdminRole.mockReturnValue(true);
  update.mockResolvedValue({ id: "ea-1", status: "UNDER_REVIEW" });
  mergeJsonKey.mockResolvedValue(true);
});

describe("GET /api/enrollments/[id]", () => {
  it("denies custom finance and HR admins before reading an application", async () => {
    for (const permissions of [["invoices.view"], ["hr.view", "payroll.view"]]) {
      getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions });
      const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
      expect(res.status).toBe(403);
    }
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("allows an admissions read-only custom admin", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED" });
    const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "ea-1", canEdit: false });
  });

  it("returns documents as per-item state and never leaks a storage token", async () => {
    findUnique.mockResolvedValue({
      id: "ea-1",
      tenantId: "t-1",
      status: "SUBMITTED",
      documents: {
        akta: {
          fileToken: "supabase:v1:enrollment/ea-1/doc-akta-0123456789abcdef.pdf",
          fileName: "akta.pdf",
          mimeType: "application/pdf",
          size: 10,
          uploadedAt: "2026-10-06T01:00:00.000Z",
        },
        kk: { receivedPhysical: true, receivedAt: "2026-10-06T02:00:00.000Z" },
      },
    });
    const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("fileToken");
    expect(text).not.toContain("supabase:v1");
    const json = JSON.parse(text);
    expect(json.documents.akta).toMatchObject({ hasFile: true, fileName: "akta.pdf", receivedPhysical: false });
    expect(json.documents.kk).toMatchObject({ hasFile: false, receivedPhysical: true });
    expect(findUnique.mock.calls[0][0].select.documents).toBe(true);
  });

  it("returns an empty documents object when none are stored", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", documents: null });
    const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
    expect((await res.json()).documents).toEqual({});
  });

  it("403 for non-admin", async () => {
    isAdminRole.mockReturnValue(false);
    const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
    expect(res.status).toBe(403);
  });

  it("404 cross-tenant", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "other" });
    const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
    expect(res.status).toBe(404);
  });

  it("returns the application", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED" });
    const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "ea-1", canEdit: true });
  });
});

describe("PATCH /api/enrollments/[id]", () => {
  it("requires admissions.edit even when the custom admin can read", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    const res = await PATCH(patchReq({ status: "UNDER_REVIEW" }), ctx());
    expect(res.status).toBe(403);
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("allows admissions.edit for a custom admin without widening tenant scope", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.edit"] });
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "other", status: "SUBMITTED", studentId: null });
    expect((await PATCH(patchReq({ status: "UNDER_REVIEW" }), ctx())).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("409 when already converted", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "ACCEPTED", studentId: "s-1" });
    const res = await PATCH(patchReq({ status: "REJECTED" }), ctx());
    expect(res.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("allows a valid transition SUBMITTED → UNDER_REVIEW", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    const res = await PATCH(patchReq({ status: "UNDER_REVIEW" }), ctx());
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data.status).toBe("UNDER_REVIEW");
  });

  it("rejects an illegal transition REJECTED → ACCEPTED", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "REJECTED", studentId: null });
    const res = await PATCH(patchReq({ status: "ACCEPTED" }), ctx());
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("edits blobs and mirrors childName", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    const res = await PATCH(patchReq({ studentData: { childName: "  Budi  " } }), ctx());
    expect(res.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data.childName).toBe("Budi");
    expect(data.studentData).toEqual({ childName: "  Budi  " });
  });

  it("400 on empty patch body", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    const res = await PATCH(patchReq({}), ctx());
    expect(res.status).toBe(400);
  });

  it("accepts a prefixed (non-cuid) programId that belongs to the tenant", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    programFindFirst.mockResolvedValue({ id: "program_ab57fd0432e25d5b3013" });
    const res = await PATCH(patchReq({ programId: "program_ab57fd0432e25d5b3013" }), ctx());
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data.programId).toBe("program_ab57fd0432e25d5b3013");
  });

  it("400 when the chosen program is not in the admin's tenant (IDOR guard)", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    programFindFirst.mockResolvedValue(null);
    const res = await PATCH(patchReq({ programId: "program_from-another-tenant" }), ctx());
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/enrollments/[id] — documentsReceived", () => {
  it("ticks a document on a converted application when it is the only field", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "ACCEPTED", studentId: "s-1" });
    const res = await PATCH(patchReq({ documentsReceived: { kk: true, akta: false } }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "ea-1", status: "ACCEPTED" });
    expect(update).not.toHaveBeenCalled(); // nothing but documents to write
    expect(mergeJsonKey).toHaveBeenCalledTimes(2);
    const [id, col, key, patch, opts] = mergeJsonKey.mock.calls[0];
    expect([id, col, key, opts]).toEqual(["ea-1", "documents", "kk", { requireInvited: false }]);
    expect(patch.receivedPhysical).toBe(true);
    expect(typeof patch.receivedAt).toBe("string");
    expect(mergeJsonKey.mock.calls[1][3]).toEqual({ receivedPhysical: false, receivedAt: null });
  });

  it("409 on a converted application when documentsReceived rides with any other field", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "ACCEPTED", studentId: "s-1" });
    for (const extra of [{ status: "REJECTED" }, { dcareAddon: true }, { studentData: { childName: "X" } }]) {
      const res = await PATCH(patchReq({ documentsReceived: { kk: true }, ...extra }), ctx());
      expect(res.status).toBe(409);
    }
    expect(mergeJsonKey).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("400 for an unknown document key, converted or not, and writes nothing", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    expect((await PATCH(patchReq({ documentsReceived: { passport: true } }), ctx())).status).toBe(400);
    expect((await PATCH(patchReq({ documentsReceived: { kk: true, __proto__x: true } }), ctx())).status).toBe(400);
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "ACCEPTED", studentId: "s-1" });
    expect((await PATCH(patchReq({ documentsReceived: { passport: true } }), ctx())).status).toBe(400);
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });

  it("400 for non-boolean values", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    expect((await PATCH(patchReq({ documentsReceived: { kk: "yes" } }), ctx())).status).toBe(400);
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });

  it("combines with other fields on an unconverted application", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    const res = await PATCH(patchReq({ status: "UNDER_REVIEW", documentsReceived: { ktp_ayah: true } }), ctx());
    expect(res.status).toBe(200);
    expect(mergeJsonKey).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toEqual({ status: "UNDER_REVIEW" });
    expect(await res.json()).toEqual({ id: "ea-1", status: "UNDER_REVIEW" });
  });

  it("does not write documents when another field fails validation (no partial write)", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "REJECTED", studentId: null });
    const res = await PATCH(patchReq({ status: "ACCEPTED", documentsReceived: { kk: true } }), ctx());
    expect(res.status).toBe(400);
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });

  it("requires admissions.edit and the same tenant", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    expect((await PATCH(patchReq({ documentsReceived: { kk: true } }), ctx())).status).toBe(403);
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SUPER_ADMIN" });
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "other", status: "ACCEPTED", studentId: "s-1" });
    expect((await PATCH(patchReq({ documentsReceived: { kk: true } }), ctx())).status).toBe(404);
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/enrollments/[id] — consentData never touches signatures", () => {
  const TOK_A = "supabase:v1:enrollment/ea-1/ayah-signature-0123456789abcdef.png";
  const TOK_I = "supabase:v1:enrollment/ea-1/ibu-signature-0123456789abcdef.png";
  const stored = {
    agreed: true,
    ayah: { name: "Bapak", signatureToken: TOK_A, signedAt: "2026-10-01T00:00:00.000Z" },
    ibu: { name: "Ibu", signatureToken: TOK_I, signedAt: "2026-10-01T00:00:00.000Z" },
  };

  it("drops client-sent signatureToken/signedAt and carries the stored ones over", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null, consentData: stored });
    const res = await PATCH(
      patchReq({
        consentData: {
          agreed: true,
          ayah: { name: "Bapak Edit", signatureToken: "FORGED", signedAt: "2000-01-01" },
          ibu: { name: "Ibu Edit", signatureToken: "" },
        },
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const consent = update.mock.calls[0][0].data.consentData;
    expect(consent.ayah).toEqual({ name: "Bapak Edit", signatureToken: TOK_A, signedAt: "2026-10-01T00:00:00.000Z" });
    expect(consent.ibu).toEqual({ name: "Ibu Edit", signatureToken: TOK_I, signedAt: "2026-10-01T00:00:00.000Z" });
    expect(JSON.stringify(consent)).not.toContain("FORGED");
  });

  it("cannot clear a signature by omitting ayah/ibu, and cannot invent one when none is stored", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null, consentData: stored });
    await PATCH(patchReq({ consentData: { agreed: true } }), ctx());
    const kept = update.mock.calls[0][0].data.consentData;
    expect(kept.ayah.signatureToken).toBe(TOK_A);
    expect(kept.ibu.signatureToken).toBe(TOK_I);

    update.mockClear();
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null, consentData: null });
    await PATCH(patchReq({ consentData: { ayah: { name: "A", signatureToken: "FORGED" } } }), ctx());
    const none = update.mock.calls[0][0].data.consentData;
    expect(none.ayah).toEqual({ name: "A" });
    expect(none.ibu).toEqual({});
  });
});

