import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/admin/classes/[id]/enrollments — the class-detail "add student"
 * door. Brought to parity with the students-detail door
 * (app/api/students/[id]/enroll/route.ts) in this cycle: it previously had
 * NO age check at all, and its duplicate-enrolment guard was scoped to
 * "any ACTIVE row in this academic year" (blocking a school + daycare pair).
 * Real lib/enrollment/age-fit + lib/enrollment/active run un-mocked — the
 * behaviour under test lives there.
 */

const { db, requirePermission } = vi.hoisted(() => {
  const db = {
    student: { findFirst: vi.fn() },
    classSection: { findFirst: vi.fn() },
    studentEnrollment: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  };
  return { db, requirePermission: vi.fn() };
});

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/classes/year-guard", () => ({
  ensureYearWritableForClass: vi
    .fn()
    .mockResolvedValue({ ok: true, tenantId: "t1", yearStatus: "ACTIVE" }),
}));

import { POST } from "@/app/api/admin/classes/[id]/enrollments/route";

const ALLOW = { session: { tenantId: "t1", id: "u1", role: "SCHOOL_ADMIN" } };

function req(body: unknown) {
  return new Request("http://t/api/admin/classes/cs1/enrollments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
const ctx = { params: Promise.resolve({ id: "cs1" }) };

function makeClassSection(overrides: {
  academicYearId?: string;
  startDate?: string;
  ageMin?: number | null;
  ageMax?: number | null;
  programType?: string;
  programName?: string;
  programId?: string;
  capacity?: number;
} = {}) {
  const {
    academicYearId = "ay-2025-2026",
    startDate = "2026-07-01",
    ageMin = null,
    ageMax = null,
    programType = "SEMESTER",
    programName = "KB",
    programId = "p1",
    capacity = 10,
  } = overrides;
  return {
    id: "cs1",
    capacity,
    academicYearId,
    name: "KB A",
    program: { id: programId, type: programType, name: programName, ageMin, ageMax },
    academicYear: { startDate },
  };
}

// Same stream-aware tx mock shape as the students-detail door's test file —
// findFirst inspects the `where` clause the way a real Postgres filter would,
// so the year/type scoping is genuinely exercised.
function makeTx(opts: {
  conflicts?: Array<{
    id: string;
    classSectionId: string;
    classSectionName: string;
    academicYearId: string;
    programType: string;
  }>;
  activeCount?: number;
  createResult?: Record<string, unknown>;
  existingRow?: { id: string; status: string } | null;
}) {
  const conflicts = opts.conflicts ?? [];
  return {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    studentEnrollment: {
      count: vi.fn().mockResolvedValue(opts.activeCount ?? 0),
      findUnique: vi.fn().mockResolvedValue(opts.existingRow ?? null),
      update: vi.fn().mockResolvedValue({
        id: opts.existingRow?.id ?? "e1",
        enrollDate: "2026-09-29",
        status: "ACTIVE",
        student: { id: "s1", name: "Anak", nis: "001" },
      }),
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
      create: vi.fn().mockResolvedValue(
        opts.createResult ?? {
          id: "e1",
          enrollDate: "2026-08-21",
          status: "ACTIVE",
          student: { id: "s1", name: "Anak", nis: "001" },
        },
      ),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/admin/classes/[id]/enrollments", () => {
  it("returns 409 with code AGE_OUT_OF_RANGE when the child's age at year start is below ageMin (this door previously had no age check at all)", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    db.classSection.findFirst.mockResolvedValue(
      makeClassSection({ startDate: "2026-07-01", ageMin: 36, ageMax: 72 }),
    );
    // Born 2024-06-01, year starts 2026-07-01 → 25 months old.
    db.student.findFirst.mockResolvedValue({ id: "s1", name: "Anak", status: "ACTIVE", dateOfBirth: "2024-06-01" });

    const res = await POST(req({ studentId: "s1" }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("AGE_OUT_OF_RANGE");
    expect(body.ageMonths).toBe(25);
    expect(body.ageMin).toBe(36);
    expect(body.ageMax).toBe(72);
    expect(body.error).toMatch(/di bawah batas usia minimum/i);
    // Never reaches the transaction — rejected before any write attempt.
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("returns 409 with code ALREADY_ENROLLED for a same-year same-type conflict, naming the conflicting class", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    db.classSection.findFirst.mockResolvedValue(
      makeClassSection({ academicYearId: "ay-2025-2026", programType: "SEMESTER" }),
    );
    db.student.findFirst.mockResolvedValue({ id: "s1", name: "Anak", status: "ACTIVE", dateOfBirth: null });
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
    db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const res = await POST(req({ studentId: "s1" }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("ALREADY_ENROLLED");
    expect(body.error).toMatch(/KB Lama/);
    expect(body.existingClassSectionId).toBe("cs-old");
  });

  it("allows a YEAR_ROUND (daycare) enrolment when the student already holds a SEMESTER enrolment in the same year — cross-type enrolment", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    db.classSection.findFirst.mockResolvedValue(
      makeClassSection({ academicYearId: "ay-2025-2026", programType: "YEAR_ROUND", programName: "Day Care" }),
    );
    db.student.findFirst.mockResolvedValue({ id: "s1", name: "Anak", status: "ACTIVE", dateOfBirth: null });
    const tx = makeTx({
      conflicts: [
        {
          id: "e-sekolah",
          classSectionId: "cs-sekolah",
          classSectionName: "KB A",
          academicYearId: "ay-2025-2026",
          programType: "SEMESTER",
        },
      ],
    });
    db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const res = await POST(req({ studentId: "s1" }), ctx);
    expect(res.status).toBe(201);
  });

  it("reactivates a WITHDRAWN row for the same class instead of inserting (CORE-2)", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    db.classSection.findFirst.mockResolvedValue(makeClassSection());
    db.student.findFirst.mockResolvedValue({ id: "s1", name: "Anak", status: "ACTIVE", dateOfBirth: null });
    const tx = makeTx({ existingRow: { id: "e-withdrawn", status: "WITHDRAWN" } });
    db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const res = await POST(req({ studentId: "s1" }), ctx);
    expect(res.status).toBe(201);
    expect(tx.studentEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "e-withdrawn" },
        data: { status: "ACTIVE", enrollDate: expect.any(String) },
      }),
    );
    expect(tx.studentEnrollment.create).not.toHaveBeenCalled();
    expect((await res.json()).status).toBe("ACTIVE");
  });

  it("returns 422 CAPACITY_EXCEEDED when the class is full (existing behaviour preserved)", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    db.classSection.findFirst.mockResolvedValue(makeClassSection({ capacity: 10 }));
    db.student.findFirst.mockResolvedValue({ id: "s1", name: "Anak", status: "ACTIVE", dateOfBirth: null });
    const tx = makeTx({ activeCount: 10 });
    db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const res = await POST(req({ studentId: "s1" }), ctx);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("CAPACITY_EXCEEDED");
  });

  it("returns 201 with the created enrollment on success", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    db.classSection.findFirst.mockResolvedValue(makeClassSection());
    db.student.findFirst.mockResolvedValue({ id: "s1", name: "Anak", status: "ACTIVE", dateOfBirth: null });
    const tx = makeTx({ activeCount: 3 });
    db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const res = await POST(req({ studentId: "s1" }), ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("e1");
  });

  it("proceeds and writes a student.enroll.age-override audit row when ageOverrideReason accompanies an out-of-range enrolment", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    const { recordAudit } = await import("@/lib/audit");
    db.classSection.findFirst.mockResolvedValue(
      makeClassSection({ startDate: "2026-07-01", ageMin: 36, ageMax: 72, programId: "p1" }),
    );
    db.student.findFirst.mockResolvedValue({ id: "s1", name: "Anak", status: "ACTIVE", dateOfBirth: "2024-06-01" });
    const tx = makeTx({
      createResult: {
        id: "e-new",
        enrollDate: "2026-08-21",
        status: "ACTIVE",
        student: { id: "s1", name: "Anak", nis: "001" },
      },
    });
    db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const res = await POST(
      req({ studentId: "s1", ageOverrideReason: "Orang tua minta karena anak sudah siap" }),
      ctx,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("e-new");

    // The route also writes the pre-existing `class.enrollment.add` audit
    // entry after the transaction — so the age-override write (inside the
    // tx) is the FIRST of two recordAudit calls.
    expect(recordAudit).toHaveBeenCalledTimes(2);
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

  it("stamps the enrolment start date with the Jakarta calendar day, not the UTC day (01:00 WIB = 18:00Z the day before)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-04T18:00:00Z")); // 2026-10-05 01:00 WIB
      requirePermission.mockResolvedValue(ALLOW);
      db.classSection.findFirst.mockResolvedValue(makeClassSection());
      db.student.findFirst.mockResolvedValue({ id: "s1", name: "Anak", dateOfBirth: null, status: "ACTIVE" });
      const tx = makeTx({ activeCount: 3 });
      db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      const res = await POST(req({ studentId: "s1" }), ctx);
      expect(res.status).toBe(201);
      expect(tx.studentEnrollment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enrollDate: "2026-10-05" }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("POST /api/admin/classes/[id]/enrollments — lifecycle + ordering guards", () => {
  it.each([
    ["WITHDRAWN", "Keluar"],
    ["GRADUATED", "Lulus"],
    ["INACTIVE", "Tidak Aktif"],
  ])("409 STUDENT_NOT_ACTIVE for a %s student, before the age check and any write (ADM-1)", async (status, label) => {
    requirePermission.mockResolvedValue(ALLOW);
    db.classSection.findFirst.mockResolvedValue(makeClassSection());
    db.student.findFirst.mockResolvedValue({ id: "s1", name: "Anak", status, dateOfBirth: null });

    const res = await POST(req({ studentId: "s1" }), ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: `Siswa berstatus ${label} tidak bisa didaftarkan ke kelas. Aktifkan kembali dulu.`,
      code: "STUDENT_NOT_ACTIVE",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("answers ALREADY_ENROLLED before demanding an age-override reason (ADM-10)", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    db.classSection.findFirst.mockResolvedValue(
      makeClassSection({ startDate: "2026-07-01", ageMin: 36, ageMax: 72 }),
    );
    db.student.findFirst.mockResolvedValue({ id: "s1", name: "Anak", status: "ACTIVE", dateOfBirth: "2024-06-01" });
    db.studentEnrollment.findFirst.mockResolvedValueOnce({
      id: "e-old",
      classSectionId: "cs-old",
      classSection: { name: "KB Lama" },
    });

    const res = await POST(req({ studentId: "s1" }), ctx);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("ALREADY_ENROLLED");
    expect(body.existingClassSectionId).toBe("cs-old");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
