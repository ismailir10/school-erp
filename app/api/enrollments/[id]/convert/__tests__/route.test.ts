import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  appFindUnique, studentFindMany, studentCreate, parentFindMany, parentFindFirst, parentCreate, parentUpdate,
  guardianCreate, guardianCount, appUpdate, admissionUpdate, queryRaw, getSession, isAdminRole,
  detectSibling, copyDocs, recordAudit, invalidateParentChildren,
} = vi.hoisted(() => ({
  appFindUnique: vi.fn(),
  studentFindMany: vi.fn(),
  studentCreate: vi.fn(),
  parentFindMany: vi.fn(),
  parentFindFirst: vi.fn(),
  parentCreate: vi.fn(),
  parentUpdate: vi.fn(),
  guardianCreate: vi.fn(),
  guardianCount: vi.fn(),
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

// Transactions run one at a time, like row locks make them: a second convert
// only starts once the first has committed or aborted.
let txChain: Promise<unknown> = Promise.resolve();
const tx = {
  $queryRaw: queryRaw,
  student: { create: studentCreate },
  parent: { findMany: parentFindMany, findFirst: parentFindFirst, create: parentCreate, update: parentUpdate },
  studentGuardian: { create: guardianCreate, count: guardianCount },
  enrollmentApplication: { update: appUpdate },
  admission: { update: admissionUpdate },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    enrollmentApplication: { findUnique: appFindUnique },
    student: { findMany: studentFindMany },
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => {
      const run = txChain.then(() => fn(tx));
      txChain = run.catch(() => undefined);
      return run;
    }),
  },
}));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));
vi.mock("@/lib/audit", () => ({ recordAudit }));
vi.mock("@/lib/parent-helpers", () => ({ invalidateParentChildren }));
vi.mock("@/lib/admission/sibling-detect", () => ({ detectSibling }));
vi.mock("@/lib/enrollment/guardian-copy", () => ({ copyEnrollmentDocsToGuardians: copyDocs }));

import { __resetRateLimitForTest } from "@/lib/rate-limit";
import { POST } from "../route";

const ctx = (id = "ea-1") => ({ params: Promise.resolve({ id }) });
const reqx = (body?: unknown) =>
  new NextRequest("http://localhost/api/enrollments/ea-1/convert", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

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
    admission: { id: "adm-1", studentId: null, status: "INQUIRY" },
    ...overrides,
  };
}

/** What the row lock re-reads: the same application, unless a test changes it. */
let lockedApp: Record<string, unknown>;
let admissionRow: { studentId: string | null; status: string };
const useApp = (a: Record<string, unknown>) => {
  appFindUnique.mockResolvedValue(a);
  lockedApp = a;
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  txChain = Promise.resolve();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SUPER_ADMIN" });
  isAdminRole.mockReturnValue(true);
  studentFindMany.mockResolvedValue([]);
  studentCreate.mockResolvedValue({ id: "stu-1", name: "Aisyah Putri" });
  parentFindMany.mockResolvedValue([]);
  parentFindFirst.mockResolvedValue(null);
  parentCreate.mockImplementation(async ({ data }: { data: { name: string } }) => ({
    id: data.name === "Bapak Ahmad" ? "par-ayah" : "par-ibu",
  }));
  parentUpdate.mockResolvedValue({});
  guardianCreate.mockResolvedValue({});
  guardianCount.mockResolvedValue(0);
  appUpdate.mockResolvedValue({});
  admissionUpdate.mockResolvedValue({});
  admissionRow = { studentId: null, status: "INQUIRY" };
  lockedApp = app();
  // 1st lock = the application row, 2nd = its linked admission.
  queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
    strings.join("?").includes('"EnrollmentApplication"')
      ? [
          {
            studentId: lockedApp.studentId ?? null,
            status: lockedApp.status,
            childName: lockedApp.childName,
            studentData: lockedApp.studentData,
            ayahData: lockedApp.ayahData,
            ibuData: lockedApp.ibuData,
            dcareAddon: lockedApp.dcareAddon,
          },
        ]
      : [admissionRow],
  );
  detectSibling.mockResolvedValue(null);
  copyDocs.mockResolvedValue({ ktpAyah: "copied", ktpIbu: "missing", kk: "missing" });
});

const nothingCreated = () => {
  expect(studentCreate).not.toHaveBeenCalled();
  expect(parentCreate).not.toHaveBeenCalled();
  expect(parentUpdate).not.toHaveBeenCalled();
  expect(guardianCreate).not.toHaveBeenCalled();
  expect(appUpdate).not.toHaveBeenCalled();
  expect(admissionUpdate).not.toHaveBeenCalled();
  expect(recordAudit).not.toHaveBeenCalled();
  expect(copyDocs).not.toHaveBeenCalled();
};

describe("POST /api/enrollments/[id]/convert — access", () => {
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
    useApp(app({ tenantId: "other" }));
    expect((await POST(reqx(), ctx())).status).toBe(404);
    nothingCreated();
  });

  it("409 when already converted", async () => {
    useApp(app({ studentId: "stu-x" }));
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Pendaftaran ini sudah dikonversi menjadi siswa.",
      code: "ALREADY_CONVERTED",
    });
    nothingCreated();
  });

  it("429 once a staff member converts too fast", async () => {
    useApp(app({ studentId: "stu-x" }));
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await POST(reqx(), ctx())).status;
    expect(last).toBe(429);
  });

  it("409 LEAD_CLOSED for a cancelled lead, and creates nothing", async () => {
    useApp(app({ admission: { id: "adm-1", studentId: null, status: "CANCELLED" } }));
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Pertanyaan ini sudah dibatalkan, jadi formulirnya belum bisa dijadikan siswa.",
      code: "LEAD_CLOSED",
    });
    nothingCreated();
  });
});

describe("POST /api/enrollments/[id]/convert — which stages convert", () => {
  it.each(["INVITED", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED"])("converts a formulir stored as %s", async (status) => {
    useApp(app({ status }));
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).student.id).toBe("stu-1");
    const data = appUpdate.mock.calls[0][0].data;
    // The stored stage ends coherent: ACCEPTED, with the student linked.
    expect(data.studentId).toBe("stu-1");
    if (status === "ACCEPTED") expect(data).toEqual({ studentId: "stu-1" });
    else expect(data).toEqual({ studentId: "stu-1", status: "ACCEPTED" });
  });

  it("records the stage it was converted from in the audit row", async () => {
    useApp(app({ status: "SUBMITTED" }));
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      {
        tenantId: "t-1",
        actorId: "u-1",
        entity: "EnrollmentApplication",
        entityId: "ea-1",
        action: "convert",
        after: { studentId: "stu-1", fromStatus: "SUBMITTED" },
      },
      expect.objectContaining({ $queryRaw: queryRaw }),
    );
  });

  it("refuses a REJECTED formulir with a message that says what to do", async () => {
    useApp(app({ status: "REJECTED" }));
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/ditolak/i);
    expect(body.code).toBe("NOT_CONVERTIBLE");
    nothingCreated();
  });

  it("a locked row whose status changed to REJECTED since the pre-tx read creates nothing", async () => {
    useApp(app());
    lockedApp = app({ status: "REJECTED" });
    expect((await POST(reqx(), ctx())).status).toBe(400);
    nothingCreated();
  });
});

describe("POST /api/enrollments/[id]/convert — minimum data", () => {
  it("converts a staff-filled formulir that has only a child name and one parent name", async () => {
    useApp(app({
      status: "INVITED",
      studentData: { childName: "Aisyah Putri" },
      ayahData: null,
      ibuData: { name: "Ibu Fatimah" },
    }));
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(200);
    const sArg = studentCreate.mock.calls[0][0].data;
    expect(sArg).toMatchObject({ name: "Aisyah Putri", dateOfBirth: null, gender: null });
    // Only the Ibu exists, so she is the primary guardian.
    expect(guardianCreate).toHaveBeenCalledTimes(1);
    expect(guardianCreate.mock.calls[0][0].data).toMatchObject({ relationship: "IBU", isPrimary: true });
  });

  it("falls back to the studentData child name when the thin column is blank", async () => {
    useApp(app({ childName: "", studentData: { childName: "Aisyah Putri" } }));
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(studentCreate.mock.calls[0][0].data.name).toBe("Aisyah Putri");
  });

  it("400 names the missing child name and points to Ubah data", async () => {
    useApp(app({ childName: "  ", studentData: {} }));
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validasi gagal");
    expect(body.errors).toEqual([
      { field: "studentData.childName", message: expect.stringContaining("Nama anak") },
    ]);
    expect(body.errors[0].message).toContain("Ubah data");
    nothingCreated();
  });

  it("400 names the missing parent name when neither Ayah nor Ibu has one", async () => {
    useApp(app({ ayahData: { email: "a@x.com" }, ibuData: {} }));
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toEqual([
      { field: "ayahData.name", message: expect.stringMatching(/Ayah atau Ibu.*Ubah data/) },
    ]);
    nothingCreated();
  });

  it("lists every missing item at once", async () => {
    useApp(app({ childName: "", studentData: null, ayahData: null, ibuData: null }));
    const body = await (await POST(reqx(), ctx())).json();
    expect(body.errors.map((e: { field: string }) => e.field)).toEqual(["studentData.childName", "ayahData.name"]);
    nothingCreated();
  });

  it("re-checks the minimum on the locked row: a name cleared since the pre-tx read creates nothing", async () => {
    useApp(app());
    lockedApp = app({ ibuData: {}, ayahData: {} });
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).errors[0].field).toBe("ayahData.name");
    nothingCreated();
  });

  it("converts from the locked copy, not the stale pre-tx read", async () => {
    useApp(app());
    lockedApp = app({ childName: "Aisyah Putri Az-Zahra", studentData: { childName: "Aisyah Putri Az-Zahra" } });
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(studentCreate.mock.calls[0][0].data.name).toBe("Aisyah Putri Az-Zahra");
  });
});

describe("POST /api/enrollments/[id]/convert — possible duplicate student", () => {
  const sameChild = {
    id: "stu-old",
    name: "  aisyah   PUTRI ",
    dateOfBirth: "2021-03-15",
    guardians: [{ parent: { name: "Bu Lama", phone: "0899", whatsapp: null, email: "secret@lama.com" } }],
  };

  it("409 POSSIBLE_DUPLICATE with candidates and creates nothing", async () => {
    useApp(app());
    studentFindMany.mockResolvedValue([sameChild]);
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("POSSIBLE_DUPLICATE");
    expect(typeof body.error).toBe("string");
    expect(body.candidates).toEqual([
      { id: "stu-old", name: "  aisyah   PUTRI ", dateOfBirth: "2021-03-15", guardianNames: ["Bu Lama"] },
    ]);
    // No contact data leaks to the browser.
    expect(JSON.stringify(body)).not.toMatch(/secret@lama|0899/);
    nothingCreated();
    expect(studentFindMany.mock.calls[0][0].where.tenantId).toBe("t-1");
  });

  it("proceeds once the body carries confirmDuplicate: true", async () => {
    useApp(app());
    studentFindMany.mockResolvedValue([sameChild]);
    const res = await POST(reqx({ confirmDuplicate: true }), ctx());
    expect(res.status).toBe(200);
    expect(studentCreate).toHaveBeenCalledTimes(1);
  });

  it("anything but a literal true is not a confirmation", async () => {
    useApp(app());
    studentFindMany.mockResolvedValue([sameChild]);
    for (const body of [{ confirmDuplicate: "true" }, { confirmDuplicate: 1 }, {}, null]) {
      expect((await POST(reqx(body), ctx())).status).toBe(409);
    }
    nothingCreated();
  });

  it("matches a same-name student through a guardian who shares a parent phone", async () => {
    useApp(app({ studentData: { childName: "Aisyah Putri" } }));
    studentFindMany.mockResolvedValue([
      {
        id: "stu-old", name: "Aisyah Putri", dateOfBirth: null,
        guardians: [{ parent: { name: "Bu Lama", phone: "+62 812-3456-7890", whatsapp: null, email: null } }],
      },
    ]);
    expect((await POST(reqx(), ctx())).status).toBe(409);
  });

  it("matches a same-name student through a guardian who shares a parent email", async () => {
    useApp(app({ studentData: { childName: "Aisyah Putri" } }));
    studentFindMany.mockResolvedValue([
      {
        id: "stu-old", name: "Aisyah Putri", dateOfBirth: null,
        guardians: [{ parent: { name: "Bu Lama", phone: null, whatsapp: null, email: "AHMAD@test.com" } }],
      },
    ]);
    expect((await POST(reqx(), ctx())).status).toBe(409);
  });

  it("a same-name stranger (different birth date, unrelated guardian) is not a duplicate", async () => {
    useApp(app());
    studentFindMany.mockResolvedValue([
      {
        id: "stu-other", name: "Aisyah Putri", dateOfBirth: "2019-01-01",
        guardians: [{ parent: { name: "Orang Lain", phone: "0877", whatsapp: null, email: "lain@x.com" } }],
      },
    ]);
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(studentCreate).toHaveBeenCalledTimes(1);
  });

  it("returns at most five candidates", async () => {
    useApp(app());
    studentFindMany.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ ...sameChild, id: `stu-${i}` })),
    );
    const body = await (await POST(reqx(), ctx())).json();
    expect(body.candidates).toHaveLength(5);
  });

  it("does not look for duplicates when the formulir is refused for other reasons", async () => {
    useApp(app({ status: "REJECTED" }));
    await POST(reqx(), ctx());
    useApp(app({ childName: "", studentData: {} }));
    await POST(reqx(), ctx());
    expect(studentFindMany).not.toHaveBeenCalled();
  });
});

const existingWali = (o: Record<string, unknown> = {}) => ({
  id: "par-old", status: "ACTIVE", name: "Bapak Ahmad Lama", email: "ahmad@test.com", phone: "0811000000",
  education: null, occupation: "Guru", incomeRange: "", address: null, employer: null, employerAddress: null,
  ...o,
});

describe("POST /api/enrollments/[id]/convert — guardians", () => {
  it("creates student + ayah + ibu + 2 guardians (AYAH primary) from a fresh family", async () => {
    useApp(app());
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(200);

    const sArg = studentCreate.mock.calls[0][0].data;
    expect(sArg).toMatchObject({ tenantId: "t-1", name: "Aisyah Putri", gender: "P", birthPlace: "Bekasi", dateOfBirth: "2021-03-15" });
    const meta = JSON.parse(sArg.metadata);
    expect(meta).toMatchObject({ religion: "Islam", bloodType: "O", weightKg: 14, dcareAddon: true, fromEnrollmentApplication: "ea-1" });

    expect(parentCreate).toHaveBeenCalledTimes(2);
    const ayahArg = parentCreate.mock.calls.find((c) => c[0].data.name === "Bapak Ahmad")![0].data;
    expect(ayahArg).toMatchObject({ tenantId: "t-1", email: "ahmad@test.com", education: "S1 / D4" });
    // Ayah has an email -> looked up by it (oldest first); Ibu has none -> sibling-detect by phone.
    expect(parentFindMany.mock.calls[0][0]).toMatchObject({
      where: { tenantId: "t-1", email: { equals: "ahmad@test.com" } },
      orderBy: { createdAt: "asc" },
    });
    expect(detectSibling).toHaveBeenCalledTimes(1);
    expect(detectSibling.mock.calls[0][0]).toMatchObject({ tenantId: "t-1", parentPhone: "081234567890" });

    expect(guardianCreate).toHaveBeenCalledTimes(2);
    const ayahG = guardianCreate.mock.calls.find((c) => c[0].data.relationship === "AYAH")![0].data;
    expect(ayahG).toMatchObject({ isPrimary: true, childOrder: 1 });
    const ibuG = guardianCreate.mock.calls.find((c) => c[0].data.relationship === "IBU")![0].data;
    expect(ibuG.isPrimary).toBe(false);

    expect((await res.json()).reusedGuardians).toEqual([]);
  });

  it("reuses an existing wali matched by email (compatible name), never overwrites it, fills only blanks, and says so", async () => {
    useApp(app());
    parentFindMany.mockResolvedValue([existingWali()]);
    guardianCount.mockResolvedValue(2);
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(200);

    // The family record keeps its name, phone and occupation; only gaps are filled.
    expect(parentUpdate).toHaveBeenCalledTimes(1);
    const upd = parentUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "par-old" });
    expect(upd.data).toEqual({ education: "S1 / D4", incomeRange: expect.any(String) });
    expect(upd.data).not.toHaveProperty("name");
    expect(upd.data).not.toHaveProperty("phone");
    expect(upd.data).not.toHaveProperty("occupation");

    // Linked, not duplicated.
    const ayahG = guardianCreate.mock.calls.find((c) => c[0].data.relationship === "AYAH")![0].data;
    expect(ayahG.parentId).toBe("par-old");
    expect(parentCreate).toHaveBeenCalledTimes(1); // only the Ibu is new
    expect(guardianCount.mock.calls[0][0].where).toMatchObject({ parentId: "par-old", status: "ACTIVE" });

    const body = await res.json();
    expect(body.reusedGuardians).toEqual([{ role: "AYAH", name: "Bapak Ahmad Lama", otherChildrenCount: 2 }]);
    // Names and a count only: no contact data.
    expect(JSON.stringify(body.reusedGuardians)).not.toMatch(/0811|@/);
  });

  it("does not touch a reused wali whose record is already complete", async () => {
    useApp(app());
    parentFindMany.mockResolvedValue([
      existingWali({ name: "Bapak Ahmad", education: "S2", incomeRange: "x", address: "Jl. A", employer: "PT A", employerAddress: "Jl. B" }),
    ]);
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(parentUpdate).not.toHaveBeenCalled();
  });

  it("an email whose only match is an INACTIVE wali: 409 GUARDIAN_INACTIVE before any write", async () => {
    useApp(app());
    parentFindMany.mockResolvedValue([existingWali({ status: "INACTIVE" })]);
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("GUARDIAN_INACTIVE");
    expect(body.error).toMatch(/nonaktif.*Ubah data/);
    nothingCreated();
  });

  it("prefers an ACTIVE wali over an INACTIVE one with the same email", async () => {
    useApp(app());
    parentFindMany.mockResolvedValue([existingWali({ id: "par-off", status: "INACTIVE" }), existingWali({ id: "par-on" })]);
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(guardianCreate.mock.calls.find((c) => c[0].data.relationship === "AYAH")![0].data.parentId).toBe("par-on");
  });

  describe("an email that belongs to a wali under another name", () => {
    const stranger = () => existingWali({ id: "par-stranger", name: "Siti Rahmawati", phone: null, education: null });

    it("409 GUARDIAN_NAME_MISMATCH before any write, naming both and the count", async () => {
      useApp(app());
      parentFindMany.mockResolvedValue([stranger()]);
      guardianCount.mockResolvedValue(3);
      const res = await POST(reqx(), ctx());
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("GUARDIAN_NAME_MISMATCH");
      expect(body.guardians).toEqual([
        { role: "AYAH", formName: "Bapak Ahmad", existingName: "Siti Rahmawati", otherChildrenCount: 3 },
      ]);
      expect(JSON.stringify(body)).not.toMatch(/@|0811/);
      nothingCreated();
    });

    it("only a literal confirmGuardians: true proceeds", async () => {
      useApp(app());
      parentFindMany.mockResolvedValue([stranger()]);
      for (const b of [{ confirmGuardians: "true" }, { confirmDuplicate: true }, { confirmGuardians: 1 }]) {
        expect((await POST(reqx(b), ctx())).status).toBe(409);
      }
      nothingCreated();
    });

    it("confirmed: links the existing wali but fills none of its blank fields", async () => {
      useApp(app());
      parentFindMany.mockResolvedValue([stranger()]);
      guardianCount.mockResolvedValue(1);
      const res = await POST(reqx({ confirmGuardians: true }), ctx());
      expect(res.status).toBe(200);
      expect(parentUpdate).not.toHaveBeenCalled();
      expect(guardianCreate.mock.calls.find((c) => c[0].data.relationship === "AYAH")![0].data.parentId).toBe("par-stranger");
      expect((await res.json()).reusedGuardians).toEqual([{ role: "AYAH", name: "Siti Rahmawati", otherChildrenCount: 1 }]);
    });

    it("a duplicate-student confirmation does not stand in for the guardian one", async () => {
      useApp(app());
      parentFindMany.mockResolvedValue([stranger()]);
      expect((await POST(reqx({ confirmDuplicate: true }), ctx())).status).toBe(409);
    });
  });

  it("links an email-less ibu to a phone-matched wali with a compatible name, and reports her", async () => {
    useApp(app({ ayahData: { name: "Bapak Ahmad", email: "ahmad@test.com" } }));
    detectSibling.mockResolvedValue({ parentId: "par-existing", matchReason: "phone" });
    parentFindFirst.mockResolvedValue({
      id: "par-existing", name: "Ibu Fatimah Lama", email: null, phone: "081234567890",
      education: null, occupation: null, incomeRange: null, address: null, employer: null, employerAddress: null,
    });
    guardianCount.mockResolvedValue(1);
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(200);
    // The phone-matched row is read tenant-scoped, then linked.
    expect(parentFindFirst).toHaveBeenCalledWith({ where: { id: "par-existing", tenantId: "t-1" } });
    expect(guardianCreate.mock.calls.find((c) => c[0].data.relationship === "IBU")![0].data.parentId).toBe("par-existing");
    expect(parentCreate).toHaveBeenCalledTimes(1); // Ayah only
    expect((await res.json()).reusedGuardians).toEqual([{ role: "IBU", name: "Ibu Fatimah Lama", otherChildrenCount: 1 }]);
  });

  it("a phone match under an unrelated name is NOT reused: a new wali is created (phone is not unique)", async () => {
    useApp(app({ ayahData: {}, ibuData: { name: "Ibu Fatimah", phone: "081234567890" } }));
    detectSibling.mockResolvedValue({ parentId: "par-other", matchReason: "phone" });
    parentFindFirst.mockResolvedValue({ id: "par-other", name: "Rudi Hartono", phone: "081234567890" });
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(200);
    expect(parentCreate).toHaveBeenCalledTimes(1);
    expect(parentUpdate).not.toHaveBeenCalled();
    expect(guardianCreate.mock.calls[0][0].data.parentId).toBe("par-ibu");
    expect((await res.json()).reusedGuardians).toEqual([]);
  });

  describe("a family phone shared by Ayah and Ibu (walk-in)", () => {
    const sharedPhone = () =>
      app({ ayahData: { name: "Bapak Ahmad", phone: "081234567890" }, ibuData: { name: "Ibu Fatimah", phone: "081234567890" } });

    it("brand-new family: two Parent rows and two guardian links, not one collapsed wali", async () => {
      useApp(sharedPhone());
      const res = await POST(reqx(), ctx());
      expect(res.status).toBe(200);
      expect(parentCreate).toHaveBeenCalledTimes(2);
      expect(guardianCreate.mock.calls.map((c) => [c[0].data.relationship, c[0].data.parentId])).toEqual([
        ["AYAH", "par-ayah"],
        ["IBU", "par-ibu"],
      ]);
    });

    it("existing Ayah matched by phone: Ibu never matches that same row, she gets her own", async () => {
      useApp(sharedPhone());
      detectSibling.mockResolvedValue({ parentId: "par-x", matchReason: "phone" });
      parentFindFirst.mockResolvedValue({
        id: "par-x", name: "Ahmad Fauzi", phone: "081234567890", education: "S1", occupation: "Guru",
        incomeRange: "x", address: "a", employer: "b", employerAddress: "c",
      });
      const res = await POST(reqx(), ctx());
      expect(res.status).toBe(200);
      expect(parentCreate).toHaveBeenCalledTimes(1);
      expect(parentCreate.mock.calls[0][0].data.name).toBe("Ibu Fatimah");
      expect(guardianCreate.mock.calls.map((c) => [c[0].data.relationship, c[0].data.parentId])).toEqual([
        ["AYAH", "par-x"],
        ["IBU", "par-ibu"],
      ]);
      expect((await res.json()).reusedGuardians).toEqual([{ role: "AYAH", name: "Ahmad Fauzi", otherChildrenCount: 0 }]);
    });
  });

  it("links one guardian once when Ayah and Ibu carry the very same email", async () => {
    useApp(app({ ibuData: { name: "Ibu Fatimah", email: "AHMAD@test.com" } }));
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(200);
    expect(parentCreate).toHaveBeenCalledTimes(1);
    expect(guardianCreate).toHaveBeenCalledTimes(1);
    expect(copyDocs.mock.calls[0][0]).toMatchObject({ ayahId: "par-ayah", ibuId: null });
    expect((await res.json()).reusedGuardians).toEqual([]);
  });

  it("409 GUARDIAN_RACE when a concurrent convert created the same new email first (P2002)", async () => {
    useApp(app());
    parentCreate.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Wali dengan email yang sama baru saja dibuat. Coba lagi.",
      code: "GUARDIAN_RACE",
    });
    expect(guardianCreate).not.toHaveBeenCalled();
    expect(appUpdate).not.toHaveBeenCalled();
    expect(invalidateParentChildren).not.toHaveBeenCalled();
  });

  it("any other write error is not swallowed as a race", async () => {
    useApp(app());
    parentCreate.mockRejectedValueOnce(new Error("boom"));
    await expect(POST(reqx(), ctx())).rejects.toThrow("boom");
  });

  it("an invalid draft email is neither stored nor used as a match key", async () => {
    useApp(app({ ayahData: { name: "Bapak Ahmad", email: "bukan-email" }, ibuData: {} }));
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(parentFindMany).not.toHaveBeenCalled();
    expect(parentCreate.mock.calls[0][0].data.email).toBeNull();
  });

  it("an impossible draft date of birth is stored as blank", async () => {
    useApp(app({ studentData: { childName: "Aisyah Putri", dateOfBirth: "2021-02-30" } }));
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(studentCreate.mock.calls[0][0].data.dateOfBirth).toBeNull();
  });

  it("passes null for an absent parent block", async () => {
    useApp(app({ ibuData: {} }));
    await POST(reqx(), ctx());
    expect(copyDocs.mock.calls[0][0]).toMatchObject({ ayahId: "par-ayah", ibuId: null });
  });

  it("copies the uploaded KTP/KK into the guardians after the transaction and reports the outcome", async () => {
    useApp(app());
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
    expect(body.documentsCopied).toEqual({ ktpAyah: "copied", ktpIbu: "missing", kk: "missing" });
    // The response never carries storage tokens.
    expect(JSON.stringify(body)).not.toContain("supabase:v1");
  });

  it("still succeeds when every copy failed", async () => {
    useApp(app());
    copyDocs.mockResolvedValue({ ktpAyah: "failed", ktpIbu: "failed", kk: "failed" });
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).documentsCopied.kk).toBe("failed");
  });
});

describe("POST /api/enrollments/[id]/convert — the originating lead", () => {
  it("links the lead and advances an early-pipeline one to ADMITTED", async () => {
    useApp(app());
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(admissionUpdate).toHaveBeenCalledWith({
      where: { id: "adm-1", tenantId: "t-1" },
      data: { studentId: "stu-1", status: "ADMITTED" },
    });
  });

  it.each(["VISIT_SCHEDULED", "VISITED"])("a legacy %s lead is advanced like Baru", async (status) => {
    useApp(app());
    admissionRow = { studentId: null, status };
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(admissionUpdate.mock.calls[0][0].data).toEqual({ studentId: "stu-1", status: "ADMITTED" });
  });

  it.each(["ADMITTED", "CANCELLED"])("never regresses a %s lead (links studentId only)", async (status) => {
    useApp(app());
    admissionRow = { studentId: null, status };
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(admissionUpdate).toHaveBeenCalledWith({ where: { id: "adm-1", tenantId: "t-1" }, data: { studentId: "stu-1" } });
  });

  it("locks and updates the lead scoped to the tenant", async () => {
    useApp(app());
    expect((await POST(reqx(), ctx())).status).toBe(200);
    const lock = queryRaw.mock.calls.find((c) => c[0].join("?").includes('"Admission"'))!;
    expect(lock[0].join("?")).toContain('"tenantId"');
    expect(lock.slice(1)).toEqual(["adm-1", "t-1"]);
  });

  it("does not overwrite a lead that was linked since the pre-tx read", async () => {
    useApp(app());
    admissionRow = { studentId: "stu-from-elsewhere", status: "ADMITTED" };
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(appUpdate).toHaveBeenCalledTimes(1);
    expect(admissionUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/enrollments/[id]/convert — single winner", () => {
  it("row-locks the application (FOR UPDATE) inside the tx before creating any row", async () => {
    useApp(app());
    const order: string[] = [];
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      expect(sql).toContain("FOR UPDATE");
      if (sql.includes('"EnrollmentApplication"')) {
        order.push("lock-app");
        return [{ ...lockedApp, studentId: null }];
      }
      order.push("lock-admission");
      return [{ studentId: null, status: "INQUIRY" }];
    });
    studentCreate.mockImplementation(async () => {
      order.push("student");
      return { id: "stu-1" };
    });
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(order).toEqual(["lock-app", "student", "lock-admission"]);
  });

  it("loser of a race (pre-tx read stale, locked row already converted) gets 409 and creates nothing", async () => {
    useApp(app());
    lockedApp = app({ studentId: "stu-winner" });
    const res = await POST(reqx(), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "ALREADY_CONVERTED" });
    nothingCreated();
    expect(invalidateParentChildren).not.toHaveBeenCalled();
  });

  it("two concurrent converts of the same formulir produce exactly one student", async () => {
    useApp(app({ status: "SUBMITTED" }));
    // The winner's commit is what the loser's lock re-read sees.
    appUpdate.mockImplementation(async ({ data }: { data: { studentId?: string; status?: string } }) => {
      lockedApp = { ...lockedApp, studentId: data.studentId, status: data.status ?? lockedApp.status };
      return {};
    });
    const [a, b] = await Promise.all([POST(reqx(), ctx()), POST(reqx(), ctx())]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(studentCreate).toHaveBeenCalledTimes(1);
    expect(guardianCreate).toHaveBeenCalledTimes(2);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(copyDocs).toHaveBeenCalledTimes(1);
  });

  it("evicts the parent->children cache after a successful conversion, and not when refused", async () => {
    useApp(app());
    expect((await POST(reqx(), ctx())).status).toBe(200);
    expect(invalidateParentChildren).toHaveBeenCalledTimes(1);

    invalidateParentChildren.mockClear();
    useApp(app({ studentId: "stu-x" }));
    expect((await POST(reqx(), ctx())).status).toBe(409);
    expect(invalidateParentChildren).not.toHaveBeenCalled();
  });
});
