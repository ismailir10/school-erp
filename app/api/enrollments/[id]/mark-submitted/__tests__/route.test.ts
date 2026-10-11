import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { appFindUnique, appUpdateMany, getSession, isAdminRole, programFindMany, queryRaw, auditCreate, feeCreate, feeFindUnique } = vi.hoisted(() => ({
  appFindUnique: vi.fn(),
  appUpdateMany: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
  programFindMany: vi.fn(),
  queryRaw: vi.fn(),
  auditCreate: vi.fn(),
  feeCreate: vi.fn(),
  feeFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const client = {
    enrollmentApplication: { findUnique: appFindUnique, updateMany: appUpdateMany },
    program: { findMany: programFindMany },
    enrollmentFee: { create: feeCreate, findUnique: feeFindUnique },
    auditLog: { create: auditCreate },
    $queryRaw: queryRaw,
    $transaction: async (fn: (tx: unknown) => unknown) => fn(client),
  };
  return { prisma: client };
});
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));

import { POST } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const ctx = { params: Promise.resolve({ id: "ea-1" }) };
const post = () => POST(new NextRequest("http://localhost/api/enrollments/ea-1/mark-submitted", { method: "POST" }), ctx);

const PROGRAMS = [
  { id: "p-kb", code: "KB", name: "KB", enrollmentFee: 500_000 },
  { id: "p-dc", code: "DCARE", name: "Day Care", enrollmentFee: 200_000 },
  { id: "p-free", code: "FREE", name: "Gratis", enrollmentFee: 0 },
];

function appRow(over: Record<string, unknown> = {}) {
  return {
    childName: "Aisyah",
    programId: "p-kb",
    dcareAddon: false,
    studentData: { childName: "Aisyah" },
    ayahData: { name: "Bapak Ahmad" },
    ibuData: {},
    consentData: null,
    fee: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view", "admissions.edit"] });
  isAdminRole.mockReturnValue(true);
  queryRaw.mockResolvedValue([{ studentId: null, status: "INVITED" }]);
  appFindUnique.mockResolvedValue(appRow());
  appUpdateMany.mockResolvedValue({ count: 1 });
  programFindMany.mockResolvedValue(PROGRAMS);
  feeFindUnique.mockResolvedValue(null);
});

const nothingWritten = () => {
  expect(appUpdateMany).not.toHaveBeenCalled();
  expect(feeCreate).not.toHaveBeenCalled();
  expect(auditCreate).not.toHaveBeenCalled();
};

describe("POST /api/enrollments/[id]/mark-submitted", () => {
  it("INVITED → SUBMITTED with a consent note, no fabricated signature, a fee snapshot and an audit row", async () => {
    feeFindUnique.mockResolvedValue({
      status: "UNPAID", method: null, baseAmount: 500_000, discountPercent: 0, discountReason: null, amount: 500_000,
      paidAt: null, note: null, linkError: null, lastCheckedAt: null, paymentUrl: null, sessionExpiresAt: null,
    });
    const res = await post();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ id: "ea-1", status: "SUBMITTED", fee: { status: "UNPAID", amount: 500_000 } });
    expect(typeof json.submittedAt).toBe("string");

    const upd = appUpdateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "ea-1", tenantId: "t-1", status: "INVITED" });
    expect(upd.data.status).toBe("SUBMITTED");
    expect(upd.data.submittedAt).toBeInstanceOf(Date);
    expect(upd.data.consentData).toMatchObject({ staffRecorded: true, note: "Disetujui langsung di sekolah", by: "u-1" });
    expect(Number.isNaN(Date.parse(upd.data.consentData.at))).toBe(false);
    const consentText = JSON.stringify(upd.data.consentData);
    expect(consentText).not.toMatch(/signatureToken|signedAt|agreed/);

    expect(feeCreate.mock.calls[0][0].data).toEqual({
      tenantId: "t-1", applicationId: "ea-1", baseAmount: 500_000, discountPercent: 0, amount: 500_000, status: "UNPAID",
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({ entity: "EnrollmentApplication", entityId: "ea-1", action: "mark_submitted", actorId: "u-1", tenantId: "t-1" });
    expect(JSON.stringify(audit)).not.toMatch(/Aisyah|Ahmad/);
  });

  it("prices the Day Care add-on into the snapshot", async () => {
    appFindUnique.mockResolvedValue(appRow({ dcareAddon: true }));
    await post();
    expect(feeCreate.mock.calls[0][0].data).toMatchObject({ baseAmount: 700_000, amount: 700_000 });
  });

  it("keeps what the parent legitimately stored (a drawn signature, onlyParent) and adds the marker", async () => {
    const stored = { onlyParent: "ayah", ayah: { name: "Bapak", signatureToken: "tok-a", signedAt: "2026-10-01T00:00:00.000Z" } };
    appFindUnique.mockResolvedValue(appRow({ consentData: stored }));
    await post();
    expect(appUpdateMany.mock.calls[0][0].data.consentData).toMatchObject({ ...stored, staffRecorded: true });
  });

  it("does not inherit parent-draft claims: agreed, version, extra keys and extra signer keys are dropped", async () => {
    appFindUnique.mockResolvedValue(
      appRow({
        consentData: {
          agreed: true,
          version: "v1",
          extra: "x",
          staffRecorded: false,
          by: "someone-else",
          onlyParent: "wali",
          ayah: { name: "Bapak", signatureToken: "tok-a", agreed: true, foo: 1 },
          ibu: "not-an-object",
        },
      }),
    );
    await post();
    const consent = appUpdateMany.mock.calls[0][0].data.consentData;
    expect(consent).toEqual({
      ayah: { name: "Bapak", signatureToken: "tok-a" },
      ibu: {},
      staffRecorded: true,
      note: "Disetujui langsung di sekolah",
      by: "u-1",
      at: expect.any(String),
    });
  });

  it("creates no fee for a free program, and none when a fee row already exists", async () => {
    appFindUnique.mockResolvedValue(appRow({ programId: "p-free" }));
    expect((await post()).status).toBe(200);
    expect(feeCreate).not.toHaveBeenCalled();

    appFindUnique.mockResolvedValue(appRow({ fee: { id: "fee-1" } }));
    expect((await post()).status).toBe(200);
    expect(feeCreate).not.toHaveBeenCalled();
  });

  it("does not require the fee to be paid (an existing UNPAID fee does not block)", async () => {
    appFindUnique.mockResolvedValue(appRow({ fee: { id: "fee-1" } }));
    expect((await post()).status).toBe(200);
  });

  it("accepts a name from either parent", async () => {
    appFindUnique.mockResolvedValue(appRow({ ayahData: {}, ibuData: { name: "Ibu Fatimah" } }));
    expect((await post()).status).toBe(200);
  });

  it("accepts the child name from the form blob when the column is blank", async () => {
    appFindUnique.mockResolvedValue(appRow({ childName: "", studentData: { childName: "Aisyah" } }));
    expect((await post()).status).toBe(200);
  });

  it("400 in the repo shape with a childName field error; nothing is written", async () => {
    appFindUnique.mockResolvedValue(appRow({ childName: " ", studentData: {} }));
    const res = await post();
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validasi gagal");
    expect(json.errors).toEqual([{ field: "childName", message: expect.stringMatching(/nama anak/i) }]);
    nothingWritten();
  });

  it("400 with an ayahData.name field error when no parent has a name; nothing is written", async () => {
    appFindUnique.mockResolvedValue(appRow({ ayahData: { name: "  " }, ibuData: null }));
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([{ field: "ayahData.name", message: expect.stringMatching(/Ayah atau Ibu/) }]);
    nothingWritten();
  });

  it("names both fields when both are missing", async () => {
    appFindUnique.mockResolvedValue(appRow({ childName: "", studentData: null, ayahData: null, ibuData: null }));
    const fields = (await (await post()).json()).errors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(["childName", "ayahData.name"]);
  });

  it("400 with a programId field error when the chosen program is no longer active; nothing is written", async () => {
    appFindUnique.mockResolvedValue(appRow({ programId: "p-retired" }));
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).errors[0].field).toBe("programId");
    nothingWritten();
  });

  it("re-checks the status under the row lock: a second call after the first flipped it gets 409", async () => {
    let status = "INVITED";
    queryRaw.mockImplementation(async () => [{ studentId: null, status }]);
    appUpdateMany.mockImplementation(async () => {
      status = "SUBMITTED";
      return { count: 1 };
    });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(409);
    expect(appUpdateMany).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it.each(["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED"])("409 when already %s", async (status) => {
    queryRaw.mockResolvedValue([{ studentId: null, status }]);
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Formulir/);
    nothingWritten();
  });

  it("409 when already converted to a student", async () => {
    queryRaw.mockResolvedValue([{ studentId: "s-1", status: "ACCEPTED" }]);
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/siswa/);
    nothingWritten();
  });

  it("409 when a parent submit wins the race (the guarded flip updates nothing); no fee, no audit", async () => {
    appUpdateMany.mockResolvedValue({ count: 0 });
    expect((await post()).status).toBe(409);
    expect(feeCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("404 across tenants: the row lock is scoped to the session tenant and finds nothing", async () => {
    queryRaw.mockResolvedValue([]);
    expect((await post()).status).toBe(404);
    nothingWritten();
  });

  it("403 for a viewer without admissions.edit and for a non-admin; nothing is read", async () => {
    getSession.mockResolvedValue({ id: "u-2", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    expect((await post()).status).toBe(403);
    getSession.mockResolvedValue({ id: "u-3", tenantId: "t-1", role: "TEACHER" });
    isAdminRole.mockReturnValue(false);
    expect((await post()).status).toBe(403);
    expect(queryRaw).not.toHaveBeenCalled();
    nothingWritten();
  });

  it("rate-limits per staff member", async () => {
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await post()).status;
    expect(last).toBe(429);
  });
});
