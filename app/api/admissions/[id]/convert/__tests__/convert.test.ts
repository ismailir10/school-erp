import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  admissionFindUnique,
  parentFindUnique,
  parentFindFirst,
  parentFindMany,
  studentFindMany,
  studentCreate,
  parentUpsert,
  parentCreate,
  studentGuardianCreate,
  admissionUpdate,
  queryRaw,
  recordAudit,
  invalidateParentChildren,
} = vi.hoisted(() => ({
  admissionFindUnique: vi.fn(),
  // T10: pre-tx email-conflict gate calls prisma.parent.findUnique outside
  // the transaction.
  parentFindUnique: vi.fn(),
  // X-1: detected-parent lookup (tenant-scoped findFirst) outside the tx.
  parentFindFirst: vi.fn(),
  // R2-ADMIN-1: contact-based parent detection (phone/WhatsApp scan) and the
  // same-name student duplicate check, both outside the tx.
  parentFindMany: vi.fn(),
  studentFindMany: vi.fn(),
  studentCreate: vi.fn(),
  parentUpsert: vi.fn(),
  parentCreate: vi.fn(),
  studentGuardianCreate: vi.fn(),
  admissionUpdate: vi.fn(),
  // STR-1: in-tx row lock (SELECT ... FOR UPDATE) + studentId/status re-read.
  queryRaw: vi.fn(),
  recordAudit: vi.fn(),
  invalidateParentChildren: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    admission: { findUnique: admissionFindUnique },
    parent: { findUnique: parentFindUnique, findFirst: parentFindFirst, findMany: parentFindMany },
    student: { findMany: studentFindMany },
    $transaction: vi.fn((fn: (tx: Record<string, unknown>) => unknown) =>
      fn({
        $queryRaw: queryRaw,
        student: { create: studentCreate },
        parent: { upsert: parentUpsert, create: parentCreate },
        studentGuardian: { create: studentGuardianCreate },
        admission: { update: admissionUpdate },
      })
    ),
  },
}));

vi.mock("@/lib/audit", () => ({ recordAudit }));
vi.mock("@/lib/parent-helpers", () => ({ invalidateParentChildren }));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({
    id: "u-1",
    tenantId: "t-1",
    role: "SUPER_ADMIN",
    email: "admin@test.com",
    name: "Admin",
    permissions: [],
    customRoleCode: null,
    employeeId: null,
    parentId: null,
  }),
  isAdminRole: vi.fn().mockReturnValue(true),
}));

import { POST } from "../route";

function makeAdmission(overrides: Record<string, unknown> = {}) {
  return {
    id: "adm-1",
    tenantId: "t-1",
    childName: "Aisyah",
    childGender: "P",
    dateOfBirth: "2021-03-15",
    parentName: "Ibu Fatimah",
    parentPhone: "081234567890",
    parentEmail: "fatimah@test.com",
    parentWhatsapp: "081234567890",
    parentEducation: "S1",
    parentOccupation: "Guru",
    parentIncome: "Rp 3-5 Juta",
    notes: "Anak aktif, suka menggambar",
    parentRelationship: null,
    status: "ADMITTED",
    studentId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  parentFindUnique.mockResolvedValue(null);
  parentFindFirst.mockResolvedValue(null);
  parentFindMany.mockResolvedValue([]);
  studentFindMany.mockResolvedValue([]);
  studentCreate.mockResolvedValue({ id: "stu-1" });
  parentUpsert.mockResolvedValue({ id: "par-1" });
  parentCreate.mockResolvedValue({ id: "par-1" });
  studentGuardianCreate.mockResolvedValue({ id: "sg-1" });
  admissionUpdate.mockResolvedValue({});
  queryRaw.mockResolvedValue([{ studentId: null, status: "ADMITTED" }]);
});

describe("POST /api/admissions/[id]/convert", () => {
  it("writes a convert audit row inside the transaction", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "adm-1" }) });
    expect(res.status).toBe(200);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      {
        tenantId: "t-1",
        actorId: "u-1",
        entity: "Admission",
        entityId: "adm-1",
        action: "convert",
        after: { studentId: "stu-1" },
      },
      expect.objectContaining({ $queryRaw: queryRaw }),
    );
  });

  it("evicts the parent->children cache after a successful conversion", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "adm-1" }) });
    expect(res.status).toBe(200);
    expect(invalidateParentChildren).toHaveBeenCalledTimes(1);
  });

  it("does not evict the cache when a racing convert already won (409)", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    queryRaw.mockResolvedValue([{ studentId: "stu-winner", status: "ADMITTED" }]);
    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    expect((await POST(req, { params: Promise.resolve({ id: "adm-1" }) })).status).toBe(409);
    expect(invalidateParentChildren).not.toHaveBeenCalled();
  });

  it("writes no audit row when a racing convert already won (409)", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    queryRaw.mockResolvedValue([{ studentId: "stu-winner", status: "ADMITTED" }]);
    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "adm-1" }) });
    expect(res.status).toBe(409);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("copies parentEducation, parentOccupation, parentIncome to Parent", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());

    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    await POST(req, { params: Promise.resolve({ id: "adm-1" }) });

    expect(parentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          education: "S1",
          occupation: "Guru",
          incomeRange: "Rp 3-5 Juta",
        }),
        update: expect.objectContaining({
          education: "S1",
          occupation: "Guru",
          incomeRange: "Rp 3-5 Juta",
        }),
      })
    );
  });

  it("copies admission.notes to Student.notes", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());

    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    await POST(req, { params: Promise.resolve({ id: "adm-1" }) });

    expect(studentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          notes: "Anak aktif, suka menggambar",
        }),
      })
    );
  });

  it("transfers fields when parent has no email (create path)", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission({ parentEmail: null }));

    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    await POST(req, { params: Promise.resolve({ id: "adm-1" }) });

    expect(parentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          education: "S1",
          occupation: "Guru",
          incomeRange: "Rp 3-5 Juta",
        }),
      })
    );
  });

  it("uses parentRelationship for StudentGuardian, defaults to IBU", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission({ parentRelationship: "AYAH" }));

    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    await POST(req, { params: Promise.resolve({ id: "adm-1" }) });

    expect(studentGuardianCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ relationship: "AYAH" }),
      })
    );
  });

  it("defaults relationship to IBU when parentRelationship is null", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission({ parentRelationship: null }));

    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    await POST(req, { params: Promise.resolve({ id: "adm-1" }) });

    expect(studentGuardianCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ relationship: "IBU" }),
      })
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T11 — field-parity audit: campusPreference stashed on Student.metadata
// ──────────────────────────────────────────────────────────────────────────

describe("POST /api/admissions/[id]/convert — campusPreference stash (T11)", () => {
  it("stashes Admission.campusPreference on Student.metadata.campusPreference", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission({ campusPreference: "campus-jakarta-1" }));

    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    await POST(req, { params: Promise.resolve({ id: "adm-1" }) });

    expect(studentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: JSON.stringify({ campusPreference: "campus-jakarta-1" }),
        }),
      }),
    );
  });

  it("leaves Student.metadata null when campusPreference is unset", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission({ campusPreference: null }));

    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    await POST(req, { params: Promise.resolve({ id: "adm-1" }) });

    expect(studentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: null }),
      }),
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T10 — sibling-detect confirmation + email-conflict handling
// ──────────────────────────────────────────────────────────────────────────

function postReq(body: unknown) {
  return new NextRequest("http://localhost/api/admissions/adm-1/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/admissions/[id]/convert — sibling-detect + email-conflict (T10)", () => {
  it("default (no body) auto-merges via parent.upsert — preserves pre-T10 behaviour", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "adm-1" }) });
    expect(res.status).toBe(200);
    expect(parentUpsert).toHaveBeenCalledTimes(1);
    expect(parentCreate).not.toHaveBeenCalled();
  });

  it("mergeWithDetected=true routes through parent.upsert", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    const res = await POST(postReq({ mergeWithDetected: true }), { params: Promise.resolve({ id: "adm-1" }) });
    expect(res.status).toBe(200);
    expect(parentUpsert).toHaveBeenCalledTimes(1);
    expect(parentCreate).not.toHaveBeenCalled();
  });

  it("mergeWithDetected=false (no email conflict) routes through parent.create with the email preserved", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    parentFindUnique.mockResolvedValue(null);
    const res = await POST(postReq({ mergeWithDetected: false }), { params: Promise.resolve({ id: "adm-1" }) });
    expect(res.status).toBe(200);
    expect(parentUpsert).not.toHaveBeenCalled();
    expect(parentCreate).toHaveBeenCalledTimes(1);
    expect(parentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "fatimah@test.com",
          name: "Ibu Fatimah",
        }),
      }),
    );
  });

  it("mergeWithDetected=false + email collides → 409 EMAIL_CONFLICT with actionable payload", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    parentFindUnique.mockResolvedValue({ id: "par-existing", name: "Ibu Fatimah Asli" });
    const res = await POST(postReq({ mergeWithDetected: false }), { params: Promise.resolve({ id: "adm-1" }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("EMAIL_CONFLICT");
    expect(body.conflictingParentId).toBe("par-existing");
    expect(body.conflictingParentName).toBe("Ibu Fatimah Asli");
    // No DB writes happen on the conflict path.
    expect(parentCreate).not.toHaveBeenCalled();
    expect(parentUpsert).not.toHaveBeenCalled();
    expect(studentCreate).not.toHaveBeenCalled();
  });

  it("mergeWithDetected=false skips the email-conflict gate when admission has no email", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission({ parentEmail: null }));
    const res = await POST(postReq({ mergeWithDetected: false }), { params: Promise.resolve({ id: "adm-1" }) });
    expect(res.status).toBe(200);
    expect(parentFindUnique).not.toHaveBeenCalled();
    expect(parentCreate).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// X-1 — "Gabungkan dengan wali" must link to admission.detectedParentId
// ──────────────────────────────────────────────────────────────────────────

describe("POST /api/admissions/[id]/convert — merge into detected parent (X-1)", () => {
  const params = { params: Promise.resolve({ id: "adm-1" }) };

  it("links the new Student to detectedParentId instead of creating/upserting a Parent (emails differ)", async () => {
    admissionFindUnique.mockResolvedValue(
      makeAdmission({ detectedParentId: "par-detected", parentEmail: "other@test.com" }),
    );
    parentFindFirst.mockResolvedValue({ id: "par-detected" });

    const res = await POST(postReq({ mergeWithDetected: true }), params);
    expect(res.status).toBe(200);
    expect(parentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "par-detected", tenantId: "t-1" } }),
    );
    expect(parentUpsert).not.toHaveBeenCalled();
    expect(parentCreate).not.toHaveBeenCalled();
    expect(studentGuardianCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ studentId: "stu-1", parentId: "par-detected", isPrimary: true }),
    });
  });

  it("links to the detected parent when the admission has no email at all", async () => {
    admissionFindUnique.mockResolvedValue(
      makeAdmission({ detectedParentId: "par-detected", parentEmail: null }),
    );
    parentFindFirst.mockResolvedValue({ id: "par-detected" });

    await POST(postReq({ mergeWithDetected: true }), params);
    expect(parentCreate).not.toHaveBeenCalled();
    expect(studentGuardianCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ parentId: "par-detected" }),
    });
  });

  it("default (no body) also merges into the detected parent", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission({ detectedParentId: "par-detected" }));
    parentFindFirst.mockResolvedValue({ id: "par-detected" });
    const req = new NextRequest("http://localhost/api/admissions/adm-1/convert", { method: "POST" });
    await POST(req, params);
    expect(parentUpsert).not.toHaveBeenCalled();
    expect(studentGuardianCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ parentId: "par-detected" }),
    });
  });

  it("stale / cross-tenant detectedParentId (lookup misses) falls back to the email upsert", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission({ detectedParentId: "par-gone" }));
    parentFindFirst.mockResolvedValue(null);
    await POST(postReq({ mergeWithDetected: true }), params);
    expect(parentUpsert).toHaveBeenCalledTimes(1);
    expect(studentGuardianCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ parentId: "par-1" }),
    });
  });

  it("mergeWithDetected=false ignores detectedParentId and creates a new Parent", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission({ detectedParentId: "par-detected" }));
    await POST(postReq({ mergeWithDetected: false }), params);
    expect(parentFindFirst).not.toHaveBeenCalled();
    expect(parentCreate).toHaveBeenCalledTimes(1);
  });
  // STR-1 — single-winner convert.
  it("pre-tx already-converted check is a 409 with the Indonesian message", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission({ studentId: "stu-x" }));
    const res = await POST(postReq(undefined), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Pendaftaran ini sudah dikonversi menjadi siswa.");
    expect(studentCreate).not.toHaveBeenCalled();
  });

  it("row-locks the admission (FOR UPDATE) inside the tx before creating any row", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    const order: string[] = [];
    queryRaw.mockImplementation(async () => {
      order.push("lock");
      return [{ studentId: null, status: "ADMITTED" }];
    });
    studentCreate.mockImplementation(async () => {
      order.push("student");
      return { id: "stu-1" };
    });
    parentUpsert.mockImplementation(async () => {
      order.push("parent");
      return { id: "par-1" };
    });
    const res = await POST(postReq(undefined), params);
    expect(res.status).toBe(200);
    expect(order).toEqual(["lock", "student", "parent"]);
    const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(sql).toContain('FROM "Admission"');
    expect(sql).toContain("FOR UPDATE");
  });

  it("loser of a race (pre-tx read stale, locked row already converted) gets 409 and creates nothing", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    queryRaw.mockResolvedValue([{ studentId: "stu-winner", status: "ADMITTED" }]);
    const res = await POST(postReq(undefined), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Pendaftaran ini sudah dikonversi menjadi siswa.");
    expect(studentCreate).not.toHaveBeenCalled();
    expect(parentUpsert).not.toHaveBeenCalled();
    expect(parentCreate).not.toHaveBeenCalled();
    expect(studentGuardianCreate).not.toHaveBeenCalled();
    expect(admissionUpdate).not.toHaveBeenCalled();
  });

  it("locked row whose status changed since the pre-tx read is a 400 and creates nothing", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    queryRaw.mockResolvedValue([{ studentId: null, status: "CANCELLED" }]);
    const res = await POST(postReq(undefined), params);
    expect(res.status).toBe(400);
    expect(studentCreate).not.toHaveBeenCalled();
  });

  it("locked row gone (deleted mid-flight) is a 404", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    queryRaw.mockResolvedValue([]);
    expect((await POST(postReq(undefined), params)).status).toBe(404);
    expect(studentCreate).not.toHaveBeenCalled();
  });

  it("non-conversion errors inside the tx still propagate", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    studentCreate.mockRejectedValue(new Error("db down"));
    await expect(POST(postReq(undefined), params)).rejects.toThrow("db down");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// R2-ADMIN-1 — duplicate gate: POSSIBLE_DUPLICATE 409 + reuse of the Parent
// ──────────────────────────────────────────────────────────────────────────

describe("POST /api/admissions/[id]/convert — possible duplicate (R2-ADMIN-1)", () => {
  const params = { params: Promise.resolve({ id: "adm-1" }) };
  const waOnly = { parentEmail: null, parentPhone: null, parentWhatsapp: "08215678901" };

  it("same name + same DOB as an existing student → 409 POSSIBLE_DUPLICATE, nothing written", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    studentFindMany.mockResolvedValue([
      { id: "stu-old", name: "aisyah", status: "ACTIVE", dateOfBirth: "2021-03-15", guardians: [] },
    ]);
    const res = await POST(postReq({}), params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("POSSIBLE_DUPLICATE");
    expect(body.existingStudents).toEqual([{ id: "stu-old", name: "aisyah", status: "ACTIVE" }]);
    expect(body.existingParent).toBeNull();
    expect(studentCreate).not.toHaveBeenCalled();
    expect(parentCreate).not.toHaveBeenCalled();
    expect(parentUpsert).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("same name + a guardian with the same WhatsApp (different formatting) → 409", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission({ ...waOnly, dateOfBirth: null }));
    studentFindMany.mockResolvedValue([
      {
        id: "stu-old",
        name: "Aisyah",
        status: "ACTIVE",
        dateOfBirth: null,
        guardians: [{ parent: { id: "par-x", phone: "+62 821-5678-901", whatsapp: null } }],
      },
    ]);
    const res = await POST(postReq({}), params);
    expect(res.status).toBe(409);
    expect((await res.json()).existingStudents).toHaveLength(1);
  });

  it("same name only (different DOB, unrelated guardian) is NOT a duplicate", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    studentFindMany.mockResolvedValue([
      {
        id: "stu-other",
        name: "Aisyah",
        status: "ACTIVE",
        dateOfBirth: "2019-01-01",
        guardians: [{ parent: { id: "par-y", phone: "0899000111", whatsapp: null } }],
      },
    ]);
    const res = await POST(postReq({}), params);
    expect(res.status).toBe(200);
    expect(studentCreate).toHaveBeenCalledTimes(1);
  });

  it("an existing Parent with the same WhatsApp → 409 naming that parent", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission(waOnly));
    parentFindMany.mockResolvedValue([
      { id: "par-old", phone: "08215678901", whatsapp: null, createdAt: new Date("2026-01-01") },
    ]);
    parentFindFirst.mockResolvedValue({ id: "par-old", name: "Dewi Sartika" });
    const res = await POST(postReq({}), params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("POSSIBLE_DUPLICATE");
    expect(body.existingParent).toEqual({ id: "par-old", name: "Dewi Sartika" });
    expect(parentCreate).not.toHaveBeenCalled();
    expect(parentUpsert).not.toHaveBeenCalled();
    expect(studentCreate).not.toHaveBeenCalled();
  });

  it("confirmDuplicate REUSES the matched Parent instead of creating a second one", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission(waOnly));
    parentFindMany.mockResolvedValue([
      { id: "par-old", phone: "08215678901", whatsapp: null, createdAt: new Date("2026-01-01") },
    ]);
    parentFindFirst.mockResolvedValue({ id: "par-old", name: "Dewi Sartika" });
    const res = await POST(postReq({ confirmDuplicate: true }), params);
    expect(res.status).toBe(200);
    expect(parentCreate).not.toHaveBeenCalled();
    expect(parentUpsert).not.toHaveBeenCalled();
    expect(studentGuardianCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ studentId: "stu-1", parentId: "par-old", isPrimary: true }),
    });
  });

  it("confirmDuplicate with a student match still creates the student", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    studentFindMany.mockResolvedValue([
      { id: "stu-old", name: "Aisyah", status: "ACTIVE", dateOfBirth: "2021-03-15", guardians: [] },
    ]);
    const res = await POST(postReq({ confirmDuplicate: true }), params);
    expect(res.status).toBe(200);
    expect(studentCreate).toHaveBeenCalledTimes(1);
  });

  it("a stamped detectedParent (already confirmed in the merge dialog) does not re-trigger the parent gate", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission({ detectedParentId: "par-detected" }));
    parentFindFirst.mockResolvedValue({ id: "par-detected" });
    const res = await POST(postReq({ mergeWithDetected: true }), params);
    expect(res.status).toBe(200);
    expect(parentFindMany).not.toHaveBeenCalled();
  });

  it("same-name child under the detected parent still asks to confirm", async () => {
    admissionFindUnique.mockResolvedValue(
      makeAdmission({ detectedParentId: "par-detected", dateOfBirth: null }),
    );
    parentFindFirst.mockResolvedValue({ id: "par-detected" });
    studentFindMany.mockResolvedValue([
      {
        id: "stu-old",
        name: "Aisyah",
        status: "ACTIVE",
        dateOfBirth: null,
        guardians: [{ parent: { id: "par-detected", phone: null, whatsapp: null } }],
      },
    ]);
    const res = await POST(postReq({ mergeWithDetected: true }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("POSSIBLE_DUPLICATE");
  });

  it("mergeWithDetected=false skips the parent half of the gate (admin chose a separate parent)", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission(waOnly));
    parentFindMany.mockResolvedValue([
      { id: "par-old", phone: "08215678901", whatsapp: null, createdAt: new Date("2026-01-01") },
    ]);
    const res = await POST(postReq({ mergeWithDetected: false }), params);
    expect(res.status).toBe(200);
    expect(parentCreate).toHaveBeenCalledTimes(1);
  });

  it("the FOR UPDATE race guard still 409s after a confirmed duplicate", async () => {
    admissionFindUnique.mockResolvedValue(makeAdmission());
    queryRaw.mockResolvedValue([{ studentId: "stu-winner", status: "ADMITTED" }]);
    const res = await POST(postReq({ confirmDuplicate: true }), params);
    expect(res.status).toBe(409);
    expect(studentCreate).not.toHaveBeenCalled();
  });
});
