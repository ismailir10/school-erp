import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  appFindUnique, studentCreate, parentUpsert, parentCreate, parentUpdate,
  guardianCreate, appUpdate, admissionUpdate, queryRaw, getSession, isAdminRole, detectSibling, copyDocs, recordAudit,
  invalidateParentChildren,
} = vi.hoisted(() => ({
  appFindUnique: vi.fn(),
  studentCreate: vi.fn(),
  parentUpsert: vi.fn(),
  parentCreate: vi.fn(),
  parentUpdate: vi.fn(),
  guardianCreate: vi.fn(),
  appUpdate: vi.fn(),
  admissionUpdate: vi.fn(),
  // STR-1: in-tx row locks (SELECT ... FOR UPDATE) + studentId/status re-read.
  queryRaw: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
  detectSibling: vi.fn(),
  copyDocs: vi.fn(),
  recordAudit: vi.fn(),
  invalidateParentChildren: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    enrollmentApplication: { findUnique: appFindUnique },
    $transaction: vi.fn((fn: (tx: Record<string, unknown>) => unknown) =>
      fn({
        $queryRaw: queryRaw,
        student: { create: studentCreate },
        parent: { upsert: parentUpsert, create: parentCreate, update: parentUpdate },
        studentGuardian: { create: guardianCreate },
        enrollmentApplication: { update: appUpdate },
        admission: { update: admissionUpdate },
      }),
    ),
  },
}));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));
vi.mock("@/lib/audit", () => ({ recordAudit }));
vi.mock("@/lib/parent-helpers", () => ({ invalidateParentChildren }));
vi.mock("@/lib/admission/sibling-detect", () => ({ detectSibling }));
vi.mock("@/lib/enrollment/guardian-copy", () => ({ copyEnrollmentDocsToGuardians: copyDocs }));

import { POST } from "../route";

const ctx = (id = "ea-1") => ({ params: Promise.resolve({ id }) });
const reqx = () => new NextRequest("http://localhost/api/enrollments/ea-1/convert", { method: "POST" });

function app(overrides: Record<string, unknown> = {}) {
  return {
    id: "ea-1",
    tenantId: "t-1",
    status: "ACCEPTED",
    studentId: null,
    childName: "Aisyah Putri",
    dcareAddon: true,
    studentData: {
      childName: "Aisyah Putri", childGender: "P", birthPlace: "Bekasi", dateOfBirth: "2021-03-15",
      agama: "ISLAM", kewarganegaraan: "WNI", bloodType: "O", childOrder: "1",
      weightKg: "14", address: { perumahan: "Taman Aster", kecamatan: "Cikarang" },
    },
    ayahData: { name: "Bapak Ahmad", email: "ahmad@test.com", education: "S1_D4", occupation: "KARYAWAN_SWASTA", income: "4793_7000" },
    ibuData: { name: "Ibu Fatimah", phone: "081234567890" },
    consentData: {},
    documents: { ktp_ayah: { fileToken: "supabase:v1:enrollment/ea-1/doc-ktp_ayah-1.png" } },
    admission: { id: "adm-1", studentId: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SUPER_ADMIN" });
  isAdminRole.mockReturnValue(true);
  studentCreate.mockResolvedValue({ id: "stu-1", name: "Aisyah Putri" });
  parentUpsert.mockResolvedValue({ id: "par-ayah" });
  parentCreate.mockResolvedValue({ id: "par-ibu" });
  parentUpdate.mockResolvedValue({ id: "par-existing" });
  guardianCreate.mockResolvedValue({});
  appUpdate.mockResolvedValue({});
  admissionUpdate.mockResolvedValue({});
  // 1st lock = the application row, 2nd = its linked admission.
  queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
    strings.join("?").includes('"EnrollmentApplication"')
      ? [{ studentId: null, status: "ACCEPTED" }]
      : [{ studentId: null, status: "INQUIRY" }],
  );
  detectSibling.mockResolvedValue(null);
  copyDocs.mockResolvedValue({ ktpAyah: "copied", ktpIbu: "missing", kk: "missing" });
});

describe("POST /api/enrollments/[id]/convert", () => {
  it("denies an admissions read-only custom admin before loading the application", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    expect((await POST(reqx(), ctx())).status).toBe(403);
    expect(appFindUnique).not.toHaveBeenCalled();
  });

  it("403 for non-admin", async () => {
    isAdminRole.mockReturnValue(false);
    expect((await POST(reqx(), ctx())).status).toBe(403);
  });

  it("404 cross-tenant", async () => {
    appFindUnique.mockResolvedValue(app({ tenantId: "other" }));
    expect((await POST(reqx(), ctx())).status).toBe(404);
  });

  it("409 when already converted", async () => {
    appFindUnique.mockResolvedValue(app({ studentId: "stu-x" }));
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Pendaftaran ini sudah dikonversi menjadi siswa.");
    expect(studentCreate).not.toHaveBeenCalled();
  });

  it("400 when not ACCEPTED", async () => {
    appFindUnique.mockResolvedValue(app({ status: "SUBMITTED" }));
    expect((await POST(reqx(), ctx())).status).toBe(400);
  });

  it("creates student + ayah(upsert) + ibu(sibling/create) + 2 guardians, AYAH primary", async () => {
    appFindUnique.mockResolvedValue(app());
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(200);

    // Student first-class + metadata mapping
    const sArg = studentCreate.mock.calls[0][0].data;
    expect(sArg.name).toBe("Aisyah Putri");
    expect(sArg.gender).toBe("P");
    expect(sArg.birthPlace).toBe("Bekasi");
    const meta = JSON.parse(sArg.metadata);
    expect(meta.religion).toBe("Islam");
    expect(meta.bloodType).toBe("O");
    expect(meta.weightKg).toBe(14);
    expect(meta.dcareAddon).toBe(true);

    // Ayah has email → upsert; Ibu has no email → sibling-detect → create
    expect(parentUpsert).toHaveBeenCalledTimes(1);
    expect(parentUpsert.mock.calls[0][0].create.email).toBe("ahmad@test.com");
    expect(parentUpsert.mock.calls[0][0].create.education).toBe("S1 / D4");
    expect(detectSibling).toHaveBeenCalledTimes(1);
    expect(parentCreate).toHaveBeenCalledTimes(1);

    // Two guardians; AYAH primary + childOrder
    expect(guardianCreate).toHaveBeenCalledTimes(2);
    const ayahG = guardianCreate.mock.calls.find((c) => c[0].data.relationship === "AYAH")![0].data;
    expect(ayahG.isPrimary).toBe(true);
    expect(ayahG.childOrder).toBe(1);
    const ibuG = guardianCreate.mock.calls.find((c) => c[0].data.relationship === "IBU")![0].data;
    expect(ibuG.isPrimary).toBe(false);

    // Links application + originating admission
    expect(appUpdate.mock.calls[0][0].data.studentId).toBe("stu-1");
    expect(admissionUpdate.mock.calls[0][0].data.studentId).toBe("stu-1");
  });

  it("ADM-6: advances the linked admission from INQUIRY to ADMITTED alongside studentId", async () => {
    appFindUnique.mockResolvedValue(app());
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(admissionUpdate).toHaveBeenCalledWith({
      where: { id: "adm-1" },
      data: { studentId: "stu-1", status: "ADMITTED" },
    });
  });

  it.each(["ADMITTED", "CANCELLED"])("ADM-6: never regresses a %s admission (links studentId only)", async (status) => {
    appFindUnique.mockResolvedValue(app());
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join("?").includes('"EnrollmentApplication"')
        ? [{ studentId: null, status: "ACCEPTED" }]
        : [{ studentId: null, status }],
    );
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(admissionUpdate).toHaveBeenCalledWith({ where: { id: "adm-1" }, data: { studentId: "stu-1" } });
  });

  it("writes a convert audit row inside the transaction", async () => {
    appFindUnique.mockResolvedValue(app());
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      {
        tenantId: "t-1",
        actorId: "u-1",
        entity: "EnrollmentApplication",
        entityId: "ea-1",
        action: "convert",
        after: { studentId: "stu-1" },
      },
      expect.objectContaining({ $queryRaw: queryRaw }),
    );
  });

  it("evicts the parent->children cache after a successful conversion, and not when refused", async () => {
    appFindUnique.mockResolvedValue(app());
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(invalidateParentChildren).toHaveBeenCalledTimes(1);

    invalidateParentChildren.mockClear();
    appFindUnique.mockResolvedValue(app({ studentId: "stu-x" }));
    expect((await POST(reqx(), ctx())).status).toBe(409);
    expect(invalidateParentChildren).not.toHaveBeenCalled();
  });

  it("writes no audit row when the conversion is refused", async () => {
    appFindUnique.mockResolvedValue(app());
    queryRaw.mockResolvedValue([{ studentId: "stu-winner", status: "ACCEPTED" }]);
    expect((await POST(reqx(), ctx())).status).toBe(409);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("links an email-less ibu to a detected sibling parent instead of creating", async () => {
    appFindUnique.mockResolvedValue(app());
    detectSibling.mockResolvedValue({ parentId: "par-existing", matchReason: "phone" });
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(200);
    expect(parentUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "par-existing" } }));
    expect(parentCreate).not.toHaveBeenCalled();
  });

  it("copies the uploaded KTP/KK into the guardians after the transaction and reports the outcome", async () => {
    appFindUnique.mockResolvedValue(app());
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(200);
    expect(copyDocs).toHaveBeenCalledTimes(1);
    expect(copyDocs).toHaveBeenCalledWith({
      tenantId: "t-1",
      applicationDocuments: app().documents,
      ayahId: "par-ayah",
      ibuId: "par-ibu",
    });
    const body = await res.json();
    expect(body.student.id).toBe("stu-1");
    expect(body.documentsCopied).toEqual({ ktpAyah: "copied", ktpIbu: "missing", kk: "missing" });
    // The response never carries storage tokens.
    expect(JSON.stringify(body)).not.toContain("supabase:v1");
  });

  it("passes null for an absent parent block", async () => {
    appFindUnique.mockResolvedValue(app({ ibuData: {} }));
    await POST(reqx(), ctx());
    expect(copyDocs.mock.calls[0][0]).toMatchObject({ ayahId: "par-ayah", ibuId: null });
  });

  it("passes a null ibuId when she resolved to the ayah's own Parent row", async () => {
    appFindUnique.mockResolvedValue(app());
    parentCreate.mockResolvedValue({ id: "par-ayah" });
    await POST(reqx(), ctx());
    expect(copyDocs.mock.calls[0][0]).toMatchObject({ ayahId: "par-ayah", ibuId: null });
  });

  it("does not copy anything when the conversion is refused", async () => {
    appFindUnique.mockResolvedValue(app({ status: "SUBMITTED" }));
    await POST(reqx(), ctx());
    expect(copyDocs).not.toHaveBeenCalled();
  });

  it("still succeeds when every copy failed", async () => {
    appFindUnique.mockResolvedValue(app());
    copyDocs.mockResolvedValue({ ktpAyah: "failed", ktpIbu: "failed", kk: "failed" });
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).documentsCopied.kk).toBe("failed");
  });
  // STR-1 — single-winner convert.
  it("row-locks the application (FOR UPDATE) inside the tx before creating any row", async () => {
    appFindUnique.mockResolvedValue(app());
    const order: string[] = [];
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      expect(sql).toContain("FOR UPDATE");
      if (sql.includes('"EnrollmentApplication"')) {
        order.push("lock-app");
        return [{ studentId: null, status: "ACCEPTED" }];
      }
      order.push("lock-admission");
      return [{ studentId: null }];
    });
    studentCreate.mockImplementation(async () => {
      order.push("student");
      return { id: "stu-1" };
    });
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(order).toEqual(["lock-app", "student", "lock-admission"]);
  });

  it("loser of a race (pre-tx read stale, locked row already converted) gets 409 and creates nothing", async () => {
    appFindUnique.mockResolvedValue(app());
    queryRaw.mockResolvedValue([{ studentId: "stu-winner", status: "ACCEPTED" }]);
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Pendaftaran ini sudah dikonversi menjadi siswa.");
    expect(studentCreate).not.toHaveBeenCalled();
    expect(parentUpsert).not.toHaveBeenCalled();
    expect(parentCreate).not.toHaveBeenCalled();
    expect(guardianCreate).not.toHaveBeenCalled();
    expect(appUpdate).not.toHaveBeenCalled();
    expect(admissionUpdate).not.toHaveBeenCalled();
    expect(copyDocs).not.toHaveBeenCalled();
  });

  it("locked row whose status changed since the pre-tx read is a 400 and creates nothing", async () => {
    appFindUnique.mockResolvedValue(app());
    queryRaw.mockResolvedValue([{ studentId: null, status: "REJECTED" }]);
    expect((await POST(reqx(), ctx())).status).toBe(400);
    expect(studentCreate).not.toHaveBeenCalled();
  });

  it("does not overwrite the originating admission when it was converted since the pre-tx read", async () => {
    appFindUnique.mockResolvedValue(app());
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join("?").includes('"EnrollmentApplication"')
        ? [{ studentId: null, status: "ACCEPTED" }]
        : [{ studentId: "stu-from-admission-route", status: "ADMITTED" }],
    );
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(appUpdate).toHaveBeenCalledTimes(1);
    expect(admissionUpdate).not.toHaveBeenCalled();
  });
});
