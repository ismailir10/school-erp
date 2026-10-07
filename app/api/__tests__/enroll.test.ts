import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../students/[id]/enroll/route";
import type { SessionUser } from "@/lib/auth";

// Real lib/enrollment/age-fit + lib/enrollment/active are exercised here (not
// mocked) — the age-band and stream-conflict scoping logic under test lives
// there, so mocking them would only prove the route calls a function, not
// that the enrolment door actually behaves correctly.

vi.mock("@/lib/db", () => ({
  prisma: {
    student: { findFirst: vi.fn() },
    classSection: { findFirst: vi.fn() },
    studentEnrollment: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

const { rateLimit } = vi.hoisted(() => ({
  rateLimit: vi.fn((..._args: unknown[]) => ({ success: true })),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit,
  getClientIp: () => "127.0.0.1",
}));

// Year-guard is exercised in its own dedicated test file
// (students-enroll-promote-year-guard.test.ts) — default to "ok" here so the
// existing capacity/age/duplicate scenarios in this file are unaffected.
vi.mock("@/lib/classes/year-guard", () => ({
  ensureYearWritableById: vi
    .fn()
    .mockResolvedValue({ ok: true, tenantId: "t1", yearStatus: "ACTIVE" }),
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

function makeReq(body: unknown) {
  return new Request("http://localhost:3000/api/students/s1/enroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeSession(role: SessionUser["role"] = "SUPER_ADMIN"): SessionUser {
  return { id: "u1", email: "t@t", name: "T", role, tenantId: "t1", employeeId: null, parentId: null, permissions: [], customRoleCode: null };
}

const params = Promise.resolve({ id: "s1" });

// Section + program + academic-year shape the route now requires.
function makeSectionInfo(overrides: {
  academicYearId?: string;
  startDate?: string;
  ageMin?: number | null;
  ageMax?: number | null;
  programType?: string;
  programName?: string;
  programId?: string;
} = {}) {
  const {
    academicYearId = "ay-2025-2026",
    startDate = "2026-07-01",
    ageMin = null,
    ageMax = null,
    programType = "SEMESTER",
    programName = "KB",
    programId = "p1",
  } = overrides;
  return {
    id: "cs1",
    tenantId: "t1",
    academicYearId,
    program: { id: programId, type: programType, ageMin, ageMax, name: programName },
    academicYear: { startDate },
  };
}

// Helper: build a tx mock for the $transaction callback.
// `conflicts`: rows a real `findStreamConflict` call should match against —
// the mocked `findFirst` inspects the `where` clause the same way the real
// Prisma query would filter (academicYearId + program.type), so the
// year/type scoping is genuinely exercised rather than asserted by shape.
// sectionRow: row returned by tx.$queryRaw (SELECT … FOR UPDATE). Empty array = missing row.
// activeCount: number returned by tx.studentEnrollment.count
// createResult: row returned by tx.studentEnrollment.create
function makeTx(opts: {
  conflicts?: Array<{
    id: string;
    classSectionId: string;
    classSectionName: string;
    academicYearId: string;
    programType: string;
  }>;
  sectionRow?: Array<{ id: string; capacity: number }>;
  activeCount?: number;
  createResult?: { id: string; studentId: string; classSectionId: string };
  // Existing (studentId, classSectionId) row returned by findUnique — used by
  // findWithdrawnEnrollment (CORE-2).
  existingRow?: { id: string; status: string } | null;
}) {
  const conflicts = opts.conflicts ?? [];
  return {
    studentEnrollment: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: vi.fn(async ({ where }: any) => {
        const match = conflicts.find(
          (c) =>
            c.academicYearId === where.classSection.academicYearId &&
            c.programType === where.classSection.program.type,
        );
        if (!match) return null;
        return {
          id: match.id,
          classSectionId: match.classSectionId,
          classSection: { name: match.classSectionName },
        };
      }),
      count: vi.fn().mockResolvedValue(opts.activeCount ?? 0),
      findUnique: vi.fn().mockResolvedValue(opts.existingRow ?? null),
      update: vi.fn().mockResolvedValue({ id: opts.existingRow?.id ?? "e1", status: "ACTIVE" }),
      create: vi.fn().mockResolvedValue(opts.createResult ?? { id: "e1", studentId: "s1", classSectionId: "cs1" }),
    },
    $queryRaw: vi.fn().mockResolvedValue(opts.sectionRow ?? [{ id: "cs1", capacity: 10 }]),
    // The route takes a student-stream advisory lock (studentId:yearId:programType)
    // as the first statement in the transaction, before the conflict lookup.
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
}

describe("POST /api/students/[id]/enroll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 409 with code ALREADY_ENROLLED when the student already holds an ACTIVE enrollment of the same program type in the same academic year", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "s1", tenantId: "t1", status: "ACTIVE", dateOfBirth: null } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(
      makeSectionInfo({ academicYearId: "ay-2025-2026", programType: "SEMESTER" }) as never,
    );
    const tx = makeTx({
      conflicts: [
        {
          id: "e-old",
          classSectionId: "cs-old",
          classSectionName: "KB Lama",
          academicYearId: "ay-2025-2026",
          programType: "SEMESTER",
        },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(tx));

    const res = await POST(makeReq({ classSectionId: "cs1" }) as never, { params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("ALREADY_ENROLLED");
    expect(body.error).toMatch(/KB Lama/);
    expect(body.existingClassSectionId).toBe("cs-old");
  });

  it("returns 400 with JSON error when class is full", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "s1", tenantId: "t1", status: "ACTIVE", dateOfBirth: null } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(makeSectionInfo() as never);
    const tx = makeTx({ sectionRow: [{ id: "cs1", capacity: 10 }], activeCount: 10 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(tx));

    const res = await POST(makeReq({ classSectionId: "cs1" }) as never, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/penuh/i);
    // Lock in the count() shape — if a future edit drops `status: 'ACTIVE'`, the count would
    // include GRADUATED/WITHDRAWN rows and inflate capacity-full responses.
    expect(tx.studentEnrollment.count).toHaveBeenCalledWith({
      where: { classSectionId: "cs1", status: "ACTIVE" },
    });
  });

  it("returns 201 with the created enrollment on success", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "s1", tenantId: "t1", status: "ACTIVE", dateOfBirth: null } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(makeSectionInfo() as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb(makeTx({ sectionRow: [{ id: "cs1", capacity: 10 }], activeCount: 3 })),
    );

    const res = await POST(makeReq({ classSectionId: "cs1" }) as never, { params });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("e1");
  });

  it("allows a YEAR_ROUND (daycare) enrolment when the student already holds a SEMESTER enrolment in the same academic year", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "s1", tenantId: "t1", status: "ACTIVE", dateOfBirth: null } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(
      makeSectionInfo({ academicYearId: "ay-2025-2026", programType: "YEAR_ROUND", programName: "Day Care" }) as never,
    );
    const tx = makeTx({
      // Existing SEMESTER row in the SAME year — a different program type, so
      // it must not conflict with a YEAR_ROUND enrolment attempt.
      conflicts: [
        {
          id: "e-sekolah",
          classSectionId: "cs-sekolah",
          classSectionName: "KB A",
          academicYearId: "ay-2025-2026",
          programType: "SEMESTER",
        },
      ],
      sectionRow: [{ id: "cs1", capacity: 10 }],
      activeCount: 2,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(tx));

    const res = await POST(makeReq({ classSectionId: "cs1" }) as never, { params });
    expect(res.status).toBe(201);
  });

  it("does not block enrolment when the student's only ACTIVE row is in an ARCHIVED prior year (the 16-student regression)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "s1", tenantId: "t1", status: "ACTIVE", dateOfBirth: null } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(
      makeSectionInfo({ academicYearId: "ay-2025-2026", programType: "SEMESTER" }) as never,
    );
    const tx = makeTx({
      // Stale ACTIVE row from the un-closed prior-year roster import — same
      // program type, but a DIFFERENT (ARCHIVED) academicYearId. Must not
      // match the current-year conflict scope.
      conflicts: [
        {
          id: "e-stale",
          classSectionId: "cs-archived",
          classSectionName: "KB Lama 2024/2025",
          academicYearId: "ay-2024-2025",
          programType: "SEMESTER",
        },
      ],
      sectionRow: [{ id: "cs1", capacity: 10 }],
      activeCount: 1,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(tx));

    const res = await POST(makeReq({ classSectionId: "cs1" }) as never, { params });
    expect(res.status).toBe(201);
    expect(tx.studentEnrollment.create).toHaveBeenCalledWith({
      data: { studentId: "s1", classSectionId: "cs1", enrollDate: expect.any(String) },
    });
  });

  it("reactivates a WITHDRAWN row for the same class instead of inserting (CORE-2)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "s1", tenantId: "t1", status: "ACTIVE", dateOfBirth: null } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(makeSectionInfo() as never);
    const tx = makeTx({ existingRow: { id: "e-withdrawn", status: "WITHDRAWN" }, activeCount: 2 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(tx));

    const res = await POST(makeReq({ classSectionId: "cs1" }) as never, { params });
    expect(res.status).toBe(201);
    expect(tx.studentEnrollment.update).toHaveBeenCalledWith({
      where: { id: "e-withdrawn" },
      data: { status: "ACTIVE", enrollDate: expect.any(String) },
    });
    expect(tx.studentEnrollment.create).not.toHaveBeenCalled();
    expect(tx.studentEnrollment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studentId_classSectionId: { studentId: "s1", classSectionId: "cs1" } } }),
    );
  });

  it("does not resurrect a GRADUATED row — falls through to create (unique violation stays a 409)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "s1", tenantId: "t1", status: "ACTIVE", dateOfBirth: null } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(makeSectionInfo() as never);
    const tx = makeTx({ existingRow: { id: "e-grad", status: "GRADUATED" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(tx));

    await POST(makeReq({ classSectionId: "cs1" }) as never, { params });
    expect(tx.studentEnrollment.update).not.toHaveBeenCalled();
    expect(tx.studentEnrollment.create).toHaveBeenCalledOnce();
  });

  it("returns 409 with code AGE_OUT_OF_RANGE when the child's age at year start is below ageMin", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    // Born 2024-06-01, year starts 2026-07-01 → 2 years 1 month = 25 months old.
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s1",
      tenantId: "t1",
      status: "ACTIVE",
      dateOfBirth: "2024-06-01",
    } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(
      makeSectionInfo({ startDate: "2026-07-01", ageMin: 36, ageMax: 72 }) as never,
    );

    const res = await POST(makeReq({ classSectionId: "cs1" }) as never, { params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("AGE_OUT_OF_RANGE");
    expect(body.ageMonths).toBe(25);
    expect(body.ageMin).toBe(36);
    expect(body.ageMax).toBe(72);
    expect(body.error).toMatch(/di bawah batas usia minimum/i);
  });

  it("returns 409 with code AGE_OUT_OF_RANGE for an ageMax-only program (ageMin null)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    // Born 2021-07-01, year starts 2026-07-01 → exactly 60 months old.
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s1",
      tenantId: "t1",
      status: "ACTIVE",
      dateOfBirth: "2021-07-01",
    } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(
      makeSectionInfo({ startDate: "2026-07-01", ageMin: null, ageMax: 48 }) as never,
    );

    const res = await POST(makeReq({ classSectionId: "cs1" }) as never, { params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("AGE_OUT_OF_RANGE");
    expect(body.ageMonths).toBe(60);
    expect(body.ageMin).toBeNull();
    expect(body.ageMax).toBe(48);
    expect(body.error).toMatch(/di atas batas usia maksimum/i);
  });

  it("proceeds and writes a student.enroll.age-override audit row when ageOverrideReason accompanies an out-of-range enrolment", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    const { recordAudit } = await import("@/lib/audit");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s1",
      tenantId: "t1",
      status: "ACTIVE",
      dateOfBirth: "2024-06-01",
    } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(
      makeSectionInfo({ startDate: "2026-07-01", ageMin: 36, ageMax: 72, programId: "p1" }) as never,
    );
    const tx = makeTx({ createResult: { id: "e-new", studentId: "s1", classSectionId: "cs1" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(tx));

    const res = await POST(
      makeReq({ classSectionId: "cs1", ageOverrideReason: "Orang tua minta karena anak sudah siap" }) as never,
      { params },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("e-new");

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [entry, txArg] = vi.mocked(recordAudit).mock.calls[0];
    expect(entry).toMatchObject({
      tenantId: "t1",
      actorId: "u1",
      entity: "StudentEnrollment",
      entityId: "e-new",
      action: "student.enroll.age-override",
      after: {
        reason: "Orang tua minta karena anak sudah siap",
        ageMonths: 25,
        ageMin: 36,
        ageMax: 72,
        programId: "p1",
      },
    });
    expect(txArg).toBe(tx);
  });

  it("returns 404 when classSectionId belongs to a different tenant", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "s1", tenantId: "t1", status: "ACTIVE", dateOfBirth: null } as never);
    // findFirst with tenantId filter returns null → cross-tenant access blocked
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(null);

    const res = await POST(makeReq({ classSectionId: "cs-from-other-tenant" }) as never, { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/tidak ditemukan/i);
  });
});

describe("POST /api/students/[id]/enroll — lifecycle + ordering guards", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["WITHDRAWN", "Keluar"],
    ["GRADUATED", "Lulus"],
    ["INACTIVE", "Tidak Aktif"],
  ])("409 STUDENT_NOT_ACTIVE for a %s student, before any class lookup or write (ADM-1)", async (status, label) => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "s1", tenantId: "t1", status, dateOfBirth: null } as never);

    const res = await POST(makeReq({ classSectionId: "cs1" }) as never, { params });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: `Siswa berstatus ${label} tidak bisa didaftarkan ke kelas. Aktifkan kembali dulu.`,
      code: "STUDENT_NOT_ACTIVE",
    });
    expect(prisma.classSection.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("answers ALREADY_ENROLLED before demanding an age-override reason (ADM-10)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    // 25 months at year start vs ageMin 36 → would be AGE_OUT_OF_RANGE.
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s1",
      tenantId: "t1",
      status: "ACTIVE",
      dateOfBirth: "2024-06-01",
    } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(
      makeSectionInfo({ startDate: "2026-07-01", ageMin: 36, ageMax: 72 }) as never,
    );
    vi.mocked(prisma.studentEnrollment.findFirst).mockResolvedValueOnce({
      id: "e-old",
      classSectionId: "cs-old",
      classSection: { name: "KB Lama" },
    } as never);

    const res = await POST(makeReq({ classSectionId: "cs1" }) as never, { params });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("ALREADY_ENROLLED");
    expect(body.error).toMatch(/KB Lama/);
    expect(body.existingClassSectionId).toBe("cs-old");
    // Scoped to the target class's year + program type, like the in-tx check.
    expect(prisma.studentEnrollment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          studentId: "s1",
          status: "ACTIVE",
          classSection: { academicYearId: "ay-2025-2026", program: { type: "SEMESTER" } },
        }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("still asks for the age override when the student is not yet enrolled", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s1",
      tenantId: "t1",
      status: "ACTIVE",
      dateOfBirth: "2024-06-01",
    } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue(
      makeSectionInfo({ startDate: "2026-07-01", ageMin: 36, ageMax: 72 }) as never,
    );
    vi.mocked(prisma.studentEnrollment.findFirst).mockResolvedValue(null as never);

    const res = await POST(makeReq({ classSectionId: "cs1" }) as never, { params });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("AGE_OUT_OF_RANGE");
  });

  it("rate-limits per admin user at 30/min, not per IP (X-9)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null as never);

    await POST(makeReq({ classSectionId: "cs1" }) as never, { params });

    expect(rateLimit).toHaveBeenCalledWith("enroll-student:u1", 30, 60_000);
  });

  it("429 with the friendly Indonesian message when the per-user budget is spent", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    rateLimit.mockReturnValueOnce({ success: false });

    const res = await POST(makeReq({ classSectionId: "cs1" }) as never, { params });

    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(
      "Terlalu banyak pendaftaran dalam satu menit. Tunggu sebentar, lalu coba lagi.",
    );
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
  });
});
