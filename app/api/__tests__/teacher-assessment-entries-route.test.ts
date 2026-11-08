import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  studentFindMany,
  studentEnrollmentFindMany,
  achievementIndicatorFindMany,
  academicYearFindFirst,
  teachingAssignmentFindFirst,
  weekFindFirst,
  assessmentEntryUpsert,
  $transaction,
  auditLogCreate,
} = vi.hoisted(() => ({
  studentFindMany: vi.fn(),
  studentEnrollmentFindMany: vi.fn(),
  achievementIndicatorFindMany: vi.fn(),
  academicYearFindFirst: vi.fn(),
  teachingAssignmentFindFirst: vi.fn(),
  weekFindFirst: vi.fn(),
  assessmentEntryUpsert: vi.fn(),
  $transaction: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    student: { findMany: studentFindMany },
    studentEnrollment: { findMany: studentEnrollmentFindMany },
    achievementIndicator: { findMany: achievementIndicatorFindMany },
    academicYear: { findFirst: academicYearFindFirst },
    teachingAssignment: { findFirst: teachingAssignmentFindFirst },
    week: { findFirst: weekFindFirst },
    assessmentEntry: { upsert: assessmentEntryUpsert },
    auditLog: { create: auditLogCreate },
    $transaction: $transaction,
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

import { POST } from "@/app/api/teacher/assessment-entries/route";
import { getSession } from "@/lib/auth";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const teacher = {
  id: "u1",
  email: "walas@demo.local",
  name: "Walas",
  role: "TEACHER" as const,
  tenantId: "t1",
  employeeId: "emp1",
  parentId: null,
  permissions: ["assessments.read", "assessments.write"],
  customRoleCode: null,
};

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/teacher/assessment-entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseHomeroom = {
  studentId: "stu1",
  indicatorId: "ind1",
  date: "2026-05-14",
  source: "HOMEROOM" as const,
  level: "CONSISTENT" as const,
};

const happyMocks = () => {
  academicYearFindFirst.mockResolvedValue({ id: "ay1" });
  teachingAssignmentFindFirst.mockResolvedValue({
    classSection: {
      id: "cs1",
      name: "TKIT A",
      programId: "prog1",
      campusId: "campus1",
      academicYearId: "ay1",
      ageGroup: "A",
    },
  });
  studentFindMany.mockResolvedValue([{ id: "stu1" }]);
  studentEnrollmentFindMany.mockResolvedValue([
    { studentId: "stu1", classSection: { ageGroup: "A" } },
  ]);
  achievementIndicatorFindMany.mockResolvedValue([
    { id: "ind1", objective: { ageGroup: "A" }, themeLinks: [{ themeId: "th1" }] },
  ]);
  weekFindFirst.mockResolvedValue({
    id: "wk1",
    number: 3,
    startDate: new Date("2026-05-11T00:00:00Z"),
    endDate: new Date("2026-05-15T00:00:00Z"),
    subTheme: { id: "st1", name: "S", theme: { id: "th1", name: "T", semesterId: "sem1" } },
  });
  assessmentEntryUpsert.mockImplementation(({ where }) =>
    Promise.resolve({ id: `wrote-${where.tenantId_studentId_indicatorId_date_source.studentId}` }),
  );
  $transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  auditLogCreate.mockResolvedValue({ id: "a1" });
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
});

describe("POST /api/teacher/assessment-entries", () => {
  it("401 when no session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await POST(jsonReq({ entries: [baseHomeroom] }) as never);
    expect(res.status).toBe(401);
  });

  it("403 when caller lacks assessments.write", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...teacher, permissions: [] });
    const res = await POST(jsonReq({ entries: [baseHomeroom] }) as never);
    expect(res.status).toBe(403);
  });

  it("403 when session has no employeeId", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...teacher, employeeId: null });
    const res = await POST(jsonReq({ entries: [baseHomeroom] }) as never);
    expect(res.status).toBe(403);
  });

  it("422 when no active academic year", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    academicYearFindFirst.mockResolvedValue(null);
    const res = await POST(jsonReq({ entries: [baseHomeroom] }) as never);
    expect(res.status).toBe(422);
  });

  it("422 when no active week brackets the entry date", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    weekFindFirst.mockResolvedValue(null);
    const res = await POST(jsonReq({ entries: [baseHomeroom] }) as never);
    expect(res.status).toBe(422);
  });

  it("403 when student is not in tenant", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    studentFindMany.mockResolvedValue([]); // mismatch
    const res = await POST(jsonReq({ entries: [baseHomeroom] }) as never);
    expect(res.status).toBe(403);
  });

  it("403 when HOMEROOM entry refers to a student outside walas's classSection", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    studentEnrollmentFindMany.mockResolvedValue([]); // not enrolled
    const res = await POST(jsonReq({ entries: [baseHomeroom] }) as never);
    expect(res.status).toBe(403);
  });

  it("403 when caller is not a walas but submits HOMEROOM entries", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    teachingAssignmentFindFirst.mockResolvedValue(null); // not a walas
    const res = await POST(jsonReq({ entries: [baseHomeroom] }) as never);
    expect(res.status).toBe(403);
  });

  it("400 when indicator is not linked to active week's theme", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    achievementIndicatorFindMany.mockResolvedValue([
      { id: "ind1", objective: { ageGroup: "A" }, themeLinks: [{ themeId: "DIFFERENT" }] },
    ]);
    const res = await POST(jsonReq({ entries: [baseHomeroom] }) as never);
    expect(res.status).toBe(400);
  });

  it("400 when source HOMEROOM body includes a center (validator)", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    const res = await POST(
      jsonReq({ entries: [{ ...baseHomeroom, center: "WORSHIP" }] }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("200 happy path — upserts + audits + returns ids", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    const res = await POST(jsonReq({ entries: [baseHomeroom] }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.written).toBe(1);
    expect(assessmentEntryUpsert).toHaveBeenCalledTimes(1);
    expect(auditLogCreate).toHaveBeenCalled();
  });

  it("200 idempotent re-submit (same payload = update branch)", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    const r1 = await POST(jsonReq({ entries: [baseHomeroom] }) as never);
    expect(r1.status).toBe(200);
    const r2 = await POST(jsonReq({ entries: [baseHomeroom] }) as never);
    expect(r2.status).toBe(200);
    expect(assessmentEntryUpsert).toHaveBeenCalledTimes(2);
  });
});
