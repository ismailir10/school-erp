import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Parity check between the two enrolment doors — students-detail
 * (app/api/students/[id]/enroll/route.ts) and class-detail
 * (app/api/admin/classes/[id]/enrollments/route.ts). The Spec's acceptance
 * criteria require both to return the identical `code`, HTTP status, and
 * body keys for the same input, for both advisory-rejection conditions:
 * AGE_OUT_OF_RANGE and ALREADY_ENROLLED. Individual behaviour for each door
 * is covered in enroll.test.ts and class-enrollments-add.test.ts — this file
 * only asserts the shapes line up.
 */

const { db, requirePermission } = vi.hoisted(() => {
  const db = {
    student: { findFirst: vi.fn() },
    classSection: { findFirst: vi.fn() },
    studentEnrollment: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  };
  return { db, requirePermission: vi.fn() };
});

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});
vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/classes/year-guard", () => ({
  ensureYearWritableById: vi
    .fn()
    .mockResolvedValue({ ok: true, tenantId: "t1", yearStatus: "ACTIVE" }),
  ensureYearWritableForClass: vi
    .fn()
    .mockResolvedValue({ ok: true, tenantId: "t1", yearStatus: "ACTIVE" }),
}));

import { POST as enrollPOST } from "@/app/api/students/[id]/enroll/route";
import { POST as classEnrollPOST } from "@/app/api/admin/classes/[id]/enrollments/route";
import type { SessionUser } from "@/lib/auth";

function studentReq(body: unknown) {
  return new Request("http://localhost:3000/api/students/s1/enroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
function classReq(body: unknown) {
  return new Request("http://localhost:3000/api/admin/classes/cs1/enrollments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

function makeSession(): SessionUser {
  return {
    id: "u1",
    email: "t@t",
    name: "T",
    role: "SUPER_ADMIN",
    tenantId: "t1",
    employeeId: null,
    parentId: null,
    permissions: [],
    customRoleCode: null,
  };
}

const studentParams = Promise.resolve({ id: "s1" });
const classParams = Promise.resolve({ id: "cs1" });

// Same section/program/year row is fed to BOTH doors — proves the parity
// isn't an artifact of different fixtures.
function makeSectionRow(overrides: {
  academicYearId?: string;
  startDate?: string;
  ageMin?: number | null;
  ageMax?: number | null;
  programType?: string;
} = {}) {
  const {
    academicYearId = "ay-2025-2026",
    startDate = "2026-07-01",
    ageMin = null,
    ageMax = null,
    programType = "SEMESTER",
  } = overrides;
  return {
    id: "cs1",
    tenantId: "t1",
    capacity: 10,
    academicYearId,
    name: "KB A",
    academicYear: { startDate },
    program: { id: "p1", type: programType, ageMin, ageMax, name: "KB" },
  };
}

function txForConflict(
  conflict: {
    id: string;
    classSectionId: string;
    classSectionName: string;
    academicYearId: string;
    programType: string;
  } | null,
) {
  return {
    classSection: db.classSection,
    studentEnrollment: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: vi.fn(async ({ where }: any) => {
        if (!conflict) return null;
        if (
          where.classSection.academicYearId === conflict.academicYearId &&
          where.classSection.program.type === conflict.programType
        ) {
          return {
            id: conflict.id,
            classSectionId: conflict.classSectionId,
            classSection: { name: conflict.classSectionName },
          };
        }
        return null;
      }),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: "e-new", studentId: "s1", classSectionId: "cs1" }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "cs1", capacity: 10 }]),
    $executeRaw: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("Enrolment door parity — AGE_OUT_OF_RANGE", () => {
  it("both doors return identical 409 status + code + body keys for the same out-of-range child", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    requirePermission.mockResolvedValue({ session: { tenantId: "t1", id: "u1", role: "SUPER_ADMIN" } });

    const sectionRow = makeSectionRow({ startDate: "2026-07-01", ageMin: 36, ageMax: 72 });
    db.student.findFirst.mockResolvedValue({ id: "s1", tenantId: "t1", name: "Anak", status: "ACTIVE", dateOfBirth: "2024-06-01" });
    db.classSection.findFirst.mockResolvedValue(sectionRow);

    const studentRes = await enrollPOST(studentReq({ classSectionId: "cs1" }), { params: studentParams });
    const classRes = await classEnrollPOST(classReq({ studentId: "s1" }), { params: classParams });

    expect(studentRes.status).toBe(409);
    expect(classRes.status).toBe(409);

    const studentBody = await studentRes.json();
    const classBody = await classRes.json();

    expect(studentBody.code).toBe("AGE_OUT_OF_RANGE");
    expect(classBody.code).toBe("AGE_OUT_OF_RANGE");
    expect(Object.keys(studentBody).sort()).toEqual(Object.keys(classBody).sort());
    expect(studentBody.ageMonths).toBe(classBody.ageMonths);
    expect(studentBody.ageMin).toBe(classBody.ageMin);
    expect(studentBody.ageMax).toBe(classBody.ageMax);
    expect(studentBody.error).toBe(classBody.error);
  });
});

describe("Enrolment door parity — ALREADY_ENROLLED", () => {
  it("both doors return identical 409 status + code + body keys for the same same-year same-type conflict", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    requirePermission.mockResolvedValue({ session: { tenantId: "t1", id: "u1", role: "SUPER_ADMIN" } });

    const sectionRow = makeSectionRow({ academicYearId: "ay-2025-2026", programType: "SEMESTER" });
    db.student.findFirst.mockResolvedValue({ id: "s1", tenantId: "t1", name: "Anak", status: "ACTIVE", dateOfBirth: null });
    db.classSection.findFirst.mockResolvedValue(sectionRow);

    const conflict = {
      id: "e-old",
      classSectionId: "cs-old",
      classSectionName: "KB Lama",
      academicYearId: "ay-2025-2026",
      programType: "SEMESTER",
    };
    const tx = txForConflict(conflict);
    db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const studentRes = await enrollPOST(studentReq({ classSectionId: "cs1" }), { params: studentParams });
    const classRes = await classEnrollPOST(classReq({ studentId: "s1" }), { params: classParams });

    expect(studentRes.status).toBe(409);
    expect(classRes.status).toBe(409);

    const studentBody = await studentRes.json();
    const classBody = await classRes.json();

    expect(studentBody.code).toBe("ALREADY_ENROLLED");
    expect(classBody.code).toBe("ALREADY_ENROLLED");
    expect(Object.keys(studentBody).sort()).toEqual(Object.keys(classBody).sort());
    expect(studentBody.existingClassSectionId).toBe("cs-old");
    expect(classBody.existingClassSectionId).toBe("cs-old");
    expect(studentBody.error).toBe(classBody.error);
  });
});
