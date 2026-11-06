import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  studentFindMany,
  studentEnrollmentFindMany,
  achievementIndicatorFindMany,
  weekFindFirst,
  assessmentEntryUpsert,
  $transaction,
  auditLogCreate,
} = vi.hoisted(() => ({
  studentFindMany: vi.fn(),
  studentEnrollmentFindMany: vi.fn(),
  achievementIndicatorFindMany: vi.fn(),
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

import { POST } from "@/app/api/teacher/assessment-entries/center/route";
import { getSession } from "@/lib/auth";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const teacher = {
  id: "u1",
  email: "sentra@demo.local",
  name: "Sentra",
  role: "TEACHER" as const,
  tenantId: "t1",
  employeeId: "emp1",
  parentId: null,
  permissions: ["assessments.read", "assessments.write"],
  customRoleCode: null,
};

function jsonReq(body: unknown): Request {
  return new Request(
    "http://localhost/api/teacher/assessment-entries/center",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const baseSession = {
  center: "WORSHIP" as const,
  date: "2026-05-14",
  activity: "Doa pagi",
  entries: [
    {
      studentId: "stu1",
      indicatorId: "ind1",
      level: "CONSISTENT" as const,
    },
  ],
};

const happyMocks = () => {
  studentFindMany.mockResolvedValue([{ id: "stu1" }]);
  achievementIndicatorFindMany.mockResolvedValue([
    { id: "ind1", objective: { ageGroup: "A" }, themeLinks: [{ themeId: "th1" }] },
  ]);
  studentEnrollmentFindMany.mockResolvedValue([
    { studentId: "stu1", classSection: { ageGroup: "A" } },
  ]);
  weekFindFirst.mockResolvedValue({
    id: "wk1",
    number: 3,
    startDate: new Date("2026-05-11T00:00:00Z"),
    endDate: new Date("2026-05-15T00:00:00Z"),
    subTheme: {
      id: "st1",
      name: "S",
      theme: { id: "th1", name: "T", semesterId: "sem1" },
    },
  });
  assessmentEntryUpsert.mockImplementation(({ where }) =>
    Promise.resolve({
      id: `wrote-${where.tenantId_studentId_indicatorId_date_source.studentId}`,
    }),
  );
  $transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  auditLogCreate.mockResolvedValue({ id: "a1" });
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
});

describe("POST /api/teacher/assessment-entries/center", () => {
  it("401 when no session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await POST(jsonReq(baseSession) as never);
    expect(res.status).toBe(401);
  });

  it("403 when caller lacks assessments.write", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...teacher, permissions: [] });
    const res = await POST(jsonReq(baseSession) as never);
    expect(res.status).toBe(403);
  });

  it("403 when session has no employeeId", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...teacher, employeeId: null });
    const res = await POST(jsonReq(baseSession) as never);
    expect(res.status).toBe(403);
  });

  it("200 + audit no-op for an empty session", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    const res = await POST(
      jsonReq({ ...baseSession, entries: [] }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.written).toBe(0);
    expect(body.reason).toBe("empty_session");
    expect(auditLogCreate).toHaveBeenCalled();
    expect(assessmentEntryUpsert).not.toHaveBeenCalled();
  });

  it("422 when no active week brackets the date", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    weekFindFirst.mockResolvedValue(null);
    const res = await POST(jsonReq(baseSession) as never);
    expect(res.status).toBe(422);
  });

  it("403 when student is not in tenant", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    studentFindMany.mockResolvedValue([]);
    const res = await POST(jsonReq(baseSession) as never);
    expect(res.status).toBe(403);
  });

  it("403 when indicator is not in tenant", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    achievementIndicatorFindMany.mockResolvedValue([]);
    const res = await POST(jsonReq(baseSession) as never);
    expect(res.status).toBe(403);
  });

  it("400 when indicator is not linked to active week's theme", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    achievementIndicatorFindMany.mockResolvedValue([
      { id: "ind1", objective: { ageGroup: "A" }, themeLinks: [{ themeId: "DIFFERENT" }] },
    ]);
    const res = await POST(jsonReq(baseSession) as never);
    expect(res.status).toBe(400);
  });

  it("400 when validator rejects empty activity", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    const res = await POST(
      jsonReq({ ...baseSession, activity: "" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("200 happy path — upserts each entry with source CENTER + center + activity", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    const res = await POST(jsonReq(baseSession) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.written).toBe(1);
    const upsertArgs = assessmentEntryUpsert.mock.calls[0][0];
    expect(
      upsertArgs.where.tenantId_studentId_indicatorId_date_source.source,
    ).toBe("CENTER");
    expect(upsertArgs.create.center).toBe("WORSHIP");
    expect(upsertArgs.create.activity).toBe("Doa pagi");
    expect(upsertArgs.create.weekId).toBe("wk1");
    expect(auditLogCreate).toHaveBeenCalled();
  });

  it("200 idempotent re-submit (same payload)", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    const r1 = await POST(jsonReq(baseSession) as never);
    expect(r1.status).toBe(200);
    const r2 = await POST(jsonReq(baseSession) as never);
    expect(r2.status).toBe(200);
    expect(assessmentEntryUpsert).toHaveBeenCalledTimes(2);
  });

  it("mixed TK A / TK B submission resolves each student's own week", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    studentFindMany.mockResolvedValue([{ id: "stuA" }, { id: "stuB" }]);
    studentEnrollmentFindMany.mockResolvedValue([
      { studentId: "stuA", classSection: { ageGroup: "A" } },
      { studentId: "stuB", classSection: { ageGroup: "B" } },
    ]);
    achievementIndicatorFindMany.mockResolvedValue([
      { id: "indA", objective: { ageGroup: "A" }, themeLinks: [{ themeId: "thA" }] },
      { id: "indB", objective: { ageGroup: "B" }, themeLinks: [{ themeId: "thB" }] },
    ]);
    weekFindFirst.mockImplementation(
      async ({ where }: { where: { subTheme: { theme: { OR: Array<{ ageGroup: string }> } } } }) => {
        const g = where.subTheme.theme.OR[0].ageGroup;
        return {
          id: `wk${g}`, number: 1,
          startDate: new Date("2026-05-11T00:00:00Z"),
          endDate: new Date("2026-05-15T00:00:00Z"),
          subTheme: { id: "st", name: "S", theme: { id: `th${g}`, name: "T", semesterId: "sem1", ageGroup: g } },
        };
      },
    );
    const res = await POST(
      jsonReq({
        ...baseSession,
        entries: [
          { studentId: "stuA", indicatorId: "indA", level: "CONSISTENT" },
          { studentId: "stuB", indicatorId: "indB", level: "CONSISTENT" },
        ],
      }) as never,
    );
    expect(res.status).toBe(200);
    const weekIds = assessmentEntryUpsert.mock.calls.map(
      (c) => [c[0].create.studentId, c[0].create.weekId],
    );
    expect(weekIds).toEqual([["stuA", "wkA"], ["stuB", "wkB"]]);
  });

  it("400 when an indicator's objective kelompok differs from the student's", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    achievementIndicatorFindMany.mockResolvedValue([
      { id: "ind1", objective: { ageGroup: "B" }, themeLinks: [{ themeId: "th1" }] },
    ]);
    const res = await POST(jsonReq(baseSession) as never);
    expect(res.status).toBe(400);
    expect(assessmentEntryUpsert).not.toHaveBeenCalled();
  });

  it("422 when a student has no active class", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happyMocks();
    studentEnrollmentFindMany.mockResolvedValue([]);
    const res = await POST(jsonReq(baseSession) as never);
    expect(res.status).toBe(422);
  });
});
