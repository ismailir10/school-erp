import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";

// Integration tests for admin curriculum routes (C1/T5).
// Covers: auth gates, tenant scoping, parent-active guards, audit emission,
// Week overlap → 409, unique-violation → 409, soft-delete via PUT.

const semesterFindMany = vi.fn();
const semesterFindFirst = vi.fn();
const semesterCount = vi.fn();
const semesterCreate = vi.fn();
const semesterUpdate = vi.fn();
const semesterUpdateMany = vi.fn();

const themeFindMany = vi.fn();
const themeFindFirst = vi.fn();
const themeCount = vi.fn();
const themeCreate = vi.fn();
const themeUpdate = vi.fn();

const subThemeFindMany = vi.fn();
const subThemeFindFirst = vi.fn();
const subThemeCount = vi.fn();
const subThemeCreate = vi.fn();
const subThemeUpdate = vi.fn();

const weekFindMany = vi.fn();
const weekFindFirst = vi.fn();
const weekCount = vi.fn();
const weekCreate = vi.fn();
const weekUpdate = vi.fn();

const academicYearFindFirst = vi.fn();
const auditLogCreate = vi.fn();

const learningObjectiveFindFirst = vi.fn();
const learningObjectiveUpdate = vi.fn();
const learningObjectiveCreate = vi.fn();

const achievementIndicatorFindFirst = vi.fn();
const achievementIndicatorFindMany = vi.fn();
const achievementIndicatorCount = vi.fn();
const achievementIndicatorCreate = vi.fn();
const achievementIndicatorUpdate = vi.fn();
const achievementIndicatorAggregate = vi.fn();

const indicatorThemeLinkUpsert = vi.fn();
const indicatorThemeLinkDeleteMany = vi.fn();

// Semester PUT fans out a reconcile over every ClassSection in the year when
// dates change — mock the lookup + the reconcile service.
const classSectionFindMany = vi.fn();
const reconcileSessions = vi.fn();

vi.mock("@/lib/sessions/reconcile", () => ({
  reconcileSessions: (...args: unknown[]) => reconcileSessions(...args),
  SESSION_BATCH_TOO_LARGE: "session_batch_too_large",
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    semester: {
      findMany: semesterFindMany,
      findFirst: semesterFindFirst,
      count: semesterCount,
      create: semesterCreate,
      update: semesterUpdate,
      updateMany: semesterUpdateMany,
    },
    // Single-active-semester enforcement runs create/update inside a
    // transaction alongside a sibling-demote updateMany. Run the callback with
    // a tx exposing the same semester mocks.
    $transaction: (cb: (tx: unknown) => unknown) =>
      cb({
        semester: {
          create: semesterCreate,
          update: semesterUpdate,
          updateMany: semesterUpdateMany,
          findFirst: semesterFindFirst,
        },
      }),
    theme: {
      findMany: themeFindMany,
      findFirst: themeFindFirst,
      count: themeCount,
      create: themeCreate,
      update: themeUpdate,
    },
    subTheme: {
      findMany: subThemeFindMany,
      findFirst: subThemeFindFirst,
      count: subThemeCount,
      create: subThemeCreate,
      update: subThemeUpdate,
    },
    week: {
      findMany: weekFindMany,
      findFirst: weekFindFirst,
      count: weekCount,
      create: weekCreate,
      update: weekUpdate,
    },
    academicYear: { findFirst: academicYearFindFirst },
    classSection: { findMany: classSectionFindMany },
    auditLog: { create: auditLogCreate },
    learningObjective: {
      findFirst: learningObjectiveFindFirst,
      update: learningObjectiveUpdate,
      create: learningObjectiveCreate,
    },
    achievementIndicator: {
      findFirst: achievementIndicatorFindFirst,
      findMany: achievementIndicatorFindMany,
      count: achievementIndicatorCount,
      create: achievementIndicatorCreate,
      update: achievementIndicatorUpdate,
      aggregate: achievementIndicatorAggregate,
    },
    indicatorThemeLink: {
      upsert: indicatorThemeLinkUpsert,
      deleteMany: indicatorThemeLinkDeleteMany,
    },
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

const superAdmin = {
  id: "u-super",
  email: "super@demo.local",
  name: "Super",
  role: "SUPER_ADMIN" as const,
  tenantId: "t-curr",
  employeeId: null,
  parentId: null,
  permissions: [],
  customRoleCode: null,
};

const teacher = {
  ...superAdmin,
  id: "u-teach",
  role: "TEACHER" as const,
  permissions: ["curriculum.read"],
};

const guardian = {
  ...superAdmin,
  id: "u-guard",
  role: "GUARDIAN" as const,
  permissions: [],
};

function jsonReq(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/api/admin/curriculum", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset to neutral defaults so a stray mock from a previous test does
  // not leak into the next case.
  semesterFindMany.mockResolvedValue([]);
  semesterCount.mockResolvedValue(0);
  semesterUpdateMany.mockResolvedValue({ count: 0 });
  classSectionFindMany.mockResolvedValue([]);
  reconcileSessions.mockResolvedValue({
    classSectionId: "cs",
    added: 0,
    deletedEmpty: 0,
    keptNonEmpty: 0,
    warnings: [],
  });
  themeFindMany.mockResolvedValue([]);
  themeCount.mockResolvedValue(0);
  subThemeFindMany.mockResolvedValue([]);
  subThemeCount.mockResolvedValue(0);
  weekFindMany.mockResolvedValue([]);
  weekCount.mockResolvedValue(0);
  auditLogCreate.mockResolvedValue({ id: "a1" });
});

describe("curriculum routes — auth + permissions", () => {
  it("GET /semesters → 401 when no session", async () => {
    const { GET } = await import("@/app/api/admin/curriculum/semesters/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET(new Request("http://l/x") as never);
    expect(res.status).toBe(401);
  });

  it("POST /semesters → 403 when caller lacks curriculum.write", async () => {
    const { POST } = await import("@/app/api/admin/curriculum/semesters/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(teacher); // read-only
    const res = await POST(
      jsonReq({ academicYearId: "ay1", number: 1, startDate: "2026-07-14", endDate: "2026-12-19" }) as never,
    );
    expect(res.status).toBe(403);
  });

  it("POST /semesters → passes the write gate for SCHOOL_ADMIN system defaults (admin-curriculum-write)", async () => {
    const { POST } = await import("@/app/api/admin/curriculum/semesters/route");
    const { getSession } = await import("@/lib/auth");
    const { getSystemRolePermissions } = await import("@/lib/permissions");
    vi.mocked(getSession).mockResolvedValue({
      ...superAdmin,
      id: "u-admin",
      role: "SCHOOL_ADMIN" as const,
      permissions: getSystemRolePermissions("SCHOOL_ADMIN"),
    });
    academicYearFindFirst.mockResolvedValue(null);
    const res = await POST(
      jsonReq({ academicYearId: "missing", number: 1, startDate: "2026-07-14", endDate: "2026-12-19" }) as never,
    );
    // 400 = got past auth and failed the AcademicYear check; 403 would mean the gate held.
    expect(res.status).toBe(400);
  });

  it("GET /semesters → 200 for TEACHER (read permission)", async () => {
    const { GET } = await import("@/app/api/admin/curriculum/semesters/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(teacher);
    const res = await GET(new Request("http://l/api/admin/curriculum/semesters") as never);
    expect(res.status).toBe(200);
    expect(semesterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: "t-curr" }) }),
    );
  });

  it("GET /semesters → 403 for GUARDIAN", async () => {
    const { GET } = await import("@/app/api/admin/curriculum/semesters/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(guardian);
    const res = await GET(new Request("http://l/x") as never);
    expect(res.status).toBe(403);
  });
});

describe("POST /semesters", () => {
  it("rejects when AcademicYear is missing / wrong tenant / INACTIVE", async () => {
    const { POST } = await import("@/app/api/admin/curriculum/semesters/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    academicYearFindFirst.mockResolvedValue(null);

    const res = await POST(
      jsonReq({ academicYearId: "missing", number: 1, startDate: "2026-07-14", endDate: "2026-12-19" }) as never,
    );
    expect(res.status).toBe(400);
    expect(academicYearFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "missing", tenantId: "t-curr", status: { not: "ARCHIVED" } },
      }),
    );
  });

  it("creates a semester + writes an audit row on happy path", async () => {
    const { POST } = await import("@/app/api/admin/curriculum/semesters/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    academicYearFindFirst.mockResolvedValue({ id: "ay1" });
    semesterCreate.mockResolvedValue({
      id: "sem1",
      academicYearId: "ay1",
      number: 1,
      startDate: new Date("2026-07-14T00:00:00Z"),
      endDate: new Date("2026-12-19T00:00:00Z"),
      status: "ACTIVE",
    });

    const res = await POST(
      jsonReq({ academicYearId: "ay1", number: 1, startDate: "2026-07-14", endDate: "2026-12-19" }) as never,
    );
    expect(res.status).toBe(201);
    expect(semesterCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "t-curr",
          academicYearId: "ay1",
          number: 1,
        }),
      }),
    );
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "t-curr",
          entity: "Semester",
          action: "create",
        }),
      }),
    );
  });

  it("DOC-3: a new semester never steals ACTIVE from an existing one (created INACTIVE, no demote)", async () => {
    const { POST } = await import("@/app/api/admin/curriculum/semesters/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    academicYearFindFirst.mockResolvedValue({ id: "ay1" });
    semesterFindFirst.mockResolvedValue({ id: "sem-existing-active" });
    semesterCreate.mockResolvedValue({
      id: "sem2", academicYearId: "ay1", number: 2, status: "INACTIVE",
      startDate: new Date("2027-01-04T00:00:00Z"), endDate: new Date("2027-06-19T00:00:00Z"),
    });

    const res = await POST(
      jsonReq({ academicYearId: "ay1", number: 2, startDate: "2027-01-04", endDate: "2027-06-19" }) as never,
    );
    expect(res.status).toBe(201);
    expect(semesterCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "INACTIVE" }) }),
    );
    expect(semesterUpdateMany).not.toHaveBeenCalled();
  });

  it("DOC-3: the first semester of a year (no ACTIVE sibling) is created ACTIVE", async () => {
    const { POST } = await import("@/app/api/admin/curriculum/semesters/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    academicYearFindFirst.mockResolvedValue({ id: "ay1" });
    semesterFindFirst.mockResolvedValue(null);
    semesterCreate.mockResolvedValue({
      id: "sem1", academicYearId: "ay1", number: 1, status: "ACTIVE",
      startDate: new Date("2026-07-14T00:00:00Z"), endDate: new Date("2026-12-19T00:00:00Z"),
    });

    await POST(jsonReq({ academicYearId: "ay1", number: 1, startDate: "2026-07-14", endDate: "2026-12-19" }) as never);
    expect(semesterCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ACTIVE" }) }),
    );
  });

  it("returns 409 on P2002 unique-constraint violation", async () => {
    const { POST } = await import("@/app/api/admin/curriculum/semesters/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    academicYearFindFirst.mockResolvedValue({ id: "ay1" });
    semesterCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const res = await POST(
      jsonReq({ academicYearId: "ay1", number: 1, startDate: "2026-07-14", endDate: "2026-12-19" }) as never,
    );
    expect(res.status).toBe(409);
  });
});

describe("PUT /themes/[id] — soft-delete via status flip", () => {
  it("PUT { status: 'INACTIVE' } updates with status flip + audits action=status:INACTIVE", async () => {
    const { PUT } = await import("@/app/api/admin/curriculum/themes/[id]/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    themeFindFirst.mockResolvedValue({ id: "th1", name: "X", order: 0, status: "ACTIVE" });
    themeUpdate.mockResolvedValue({ id: "th1", name: "X", order: 0, status: "INACTIVE", semesterId: "sem1", _count: { subThemes: 0 } });

    const res = await PUT(
      jsonReq({ status: "INACTIVE" }, "PUT") as never,
      { params: Promise.resolve({ id: "th1" }) } as never,
    );
    expect(res.status).toBe(200);
    expect(themeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "INACTIVE" }) }),
    );
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: "Theme", action: "status:INACTIVE" }),
      }),
    );
  });

  it("returns 404 when row belongs to a different tenant", async () => {
    const { PUT } = await import("@/app/api/admin/curriculum/themes/[id]/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    themeFindFirst.mockResolvedValue(null); // tenant filter screened it out

    const res = await PUT(
      jsonReq({ name: "X" }, "PUT") as never,
      { params: Promise.resolve({ id: "th-other-tenant" }) } as never,
    );
    expect(res.status).toBe(404);
    expect(themeUpdate).not.toHaveBeenCalled();
  });
});

describe("PUT /semesters/[id]", () => {
  it("rejects when merged startDate >= endDate (cross-field check after merge)", async () => {
    const { PUT } = await import("@/app/api/admin/curriculum/semesters/[id]/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    semesterFindFirst.mockResolvedValue({
      id: "sem1",
      number: 1,
      startDate: new Date("2026-07-14T00:00:00Z"),
      endDate: new Date("2026-12-19T00:00:00Z"),
      status: "ACTIVE",
    });

    // Only endDate sent; merged result puts endDate before existing startDate.
    const res = await PUT(
      jsonReq({ endDate: "2026-07-01" }, "PUT") as never,
      { params: Promise.resolve({ id: "sem1" }) } as never,
    );
    expect(res.status).toBe(400);
    expect(semesterUpdate).not.toHaveBeenCalled();
  });

  it("date-only update audits with full date snapshot in before/after", async () => {
    const { PUT } = await import("@/app/api/admin/curriculum/semesters/[id]/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    const before = {
      id: "sem1",
      number: 1,
      startDate: new Date("2026-07-14T00:00:00Z"),
      endDate: new Date("2026-12-19T00:00:00Z"),
      status: "ACTIVE",
    };
    semesterFindFirst.mockResolvedValue(before);
    semesterUpdate.mockResolvedValue({
      ...before,
      endDate: new Date("2026-12-31T00:00:00Z"),
      academicYearId: "ay1",
    });

    const res = await PUT(
      jsonReq({ endDate: "2026-12-31" }, "PUT") as never,
      { params: Promise.resolve({ id: "sem1" }) } as never,
    );
    expect(res.status).toBe(200);
    expect(auditLogCreate).toHaveBeenCalled();
    const auditCall = auditLogCreate.mock.calls[0][0];
    expect(auditCall.data.entity).toBe("Semester");
    expect(auditCall.data.action).toBe("update");
    expect(auditCall.data.before.startDate).toBe("2026-07-14T00:00:00.000Z");
    expect(auditCall.data.before.endDate).toBe("2026-12-19T00:00:00.000Z");
    expect(auditCall.data.after.endDate).toBe("2026-12-31T00:00:00.000Z");
  });
});

describe("PUT /weeks/[id] — reactivation overlap", () => {
  it("rejects { status: 'ACTIVE' } when the slot is now occupied by a sibling", async () => {
    const { PUT } = await import("@/app/api/admin/curriculum/weeks/[id]/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    weekFindFirst.mockResolvedValue({
      id: "w-dormant",
      subThemeId: "st1",
      number: 1,
      startDate: new Date("2026-07-13T00:00:00Z"),
      endDate: new Date("2026-07-17T00:00:00Z"),
      status: "INACTIVE",
    });
    // A different ACTIVE sibling already covers the same range.
    weekFindMany.mockResolvedValue([
      {
        id: "w-current",
        startDate: new Date("2026-07-13T00:00:00Z"),
        endDate: new Date("2026-07-17T00:00:00Z"),
        status: "ACTIVE",
      },
    ]);

    const res = await PUT(
      jsonReq({ status: "ACTIVE" }, "PUT") as never,
      { params: Promise.resolve({ id: "w-dormant" }) } as never,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflictingWeekId).toBe("w-current");
    expect(weekUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /objectives — C3", () => {
  it("rejects 400 when parent semester missing / wrong tenant / INACTIVE", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/objectives/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    semesterFindFirst.mockResolvedValue(null);

    const res = await POST(
      jsonReq({
        semesterId: "sem-missing",
        ageGroup: "A",
        element: "RELIGIOUS_MORAL",
        number: 1,
        competencyText: "X",
        content: "Y",
      }) as never,
    );
    expect(res.status).toBe(400);
    expect(learningObjectiveCreate).not.toHaveBeenCalled();
  });

  it("creates + audits action=create on happy path", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/objectives/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    semesterFindFirst.mockResolvedValue({ id: "sem1" });
    learningObjectiveCreate.mockResolvedValue({
      id: "obj-new",
      semesterId: "sem1",
      ageGroup: "A",
      element: "RELIGIOUS_MORAL",
      number: 1,
      competencyText: "X",
      content: "Y",
      status: "ACTIVE",
    });

    const res = await POST(
      jsonReq({
        semesterId: "sem1",
        ageGroup: "A",
        element: "RELIGIOUS_MORAL",
        number: 1,
        competencyText: "X",
        content: "Y",
      }) as never,
    );
    expect(res.status).toBe(201);
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "LearningObjective",
          action: "create",
        }),
      }),
    );
  });

  it("returns 409 on P2002 unique-constraint violation", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/objectives/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    semesterFindFirst.mockResolvedValue({ id: "sem1" });
    learningObjectiveCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const res = await POST(
      jsonReq({
        semesterId: "sem1",
        ageGroup: "A",
        element: "RELIGIOUS_MORAL",
        number: 1,
        competencyText: "X",
        content: "Y",
      }) as never,
    );
    expect(res.status).toBe(409);
  });

  it("returns 403 when caller lacks curriculum.write", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/objectives/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(teacher);

    const res = await POST(
      jsonReq({
        semesterId: "sem1",
        ageGroup: "A",
        element: "RELIGIOUS_MORAL",
        number: 1,
        competencyText: "X",
        content: "Y",
      }) as never,
    );
    expect(res.status).toBe(403);
    expect(learningObjectiveCreate).not.toHaveBeenCalled();
  });
});

describe("PUT /objectives/[id] — C3", () => {
  it("updates competencyText + content; audits action=update", async () => {
    const { PUT } = await import(
      "@/app/api/admin/curriculum/objectives/[id]/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    learningObjectiveFindFirst.mockResolvedValue({
      id: "obj1",
      competencyText: "Lama",
      content: "Lama TP",
      status: "ACTIVE",
    });
    learningObjectiveUpdate.mockResolvedValue({
      id: "obj1",
      semesterId: "sem1",
      ageGroup: "A",
      element: "RELIGIOUS_MORAL",
      number: 1,
      competencyText: "Baru",
      content: "Baru TP",
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await PUT(
      jsonReq(
        { competencyText: "Baru", content: "Baru TP" },
        "PUT",
      ) as never,
      { params: Promise.resolve({ id: "obj1" }) } as never,
    );
    expect(res.status).toBe(200);
    expect(learningObjectiveUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          competencyText: "Baru",
          content: "Baru TP",
        }),
      }),
    );
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "LearningObjective",
          action: "update",
        }),
      }),
    );
  });

  it("status-only deactivate emits action=status:INACTIVE", async () => {
    const { PUT } = await import(
      "@/app/api/admin/curriculum/objectives/[id]/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    learningObjectiveFindFirst.mockResolvedValue({
      id: "obj1",
      competencyText: "X",
      content: "Y",
      status: "ACTIVE",
    });
    learningObjectiveUpdate.mockResolvedValue({
      id: "obj1",
      semesterId: "sem1",
      ageGroup: "A",
      element: "RELIGIOUS_MORAL",
      number: 1,
      competencyText: "X",
      content: "Y",
      status: "INACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await PUT(
      jsonReq({ status: "INACTIVE" }, "PUT") as never,
      { params: Promise.resolve({ id: "obj1" }) } as never,
    );
    expect(res.status).toBe(200);
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "LearningObjective",
          action: "status:INACTIVE",
        }),
      }),
    );
  });

  it("returns 404 when row belongs to a different tenant", async () => {
    const { PUT } = await import(
      "@/app/api/admin/curriculum/objectives/[id]/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    learningObjectiveFindFirst.mockResolvedValue(null);

    const res = await PUT(
      jsonReq({ content: "X" }, "PUT") as never,
      { params: Promise.resolve({ id: "obj-other" }) } as never,
    );
    expect(res.status).toBe(404);
    expect(learningObjectiveUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 when caller lacks curriculum.write", async () => {
    const { PUT } = await import(
      "@/app/api/admin/curriculum/objectives/[id]/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(teacher);

    const res = await PUT(
      jsonReq({ content: "X" }, "PUT") as never,
      { params: Promise.resolve({ id: "obj1" }) } as never,
    );
    expect(res.status).toBe(403);
    expect(learningObjectiveUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 on empty patch body", async () => {
    const { PUT } = await import(
      "@/app/api/admin/curriculum/objectives/[id]/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    learningObjectiveFindFirst.mockResolvedValue({
      id: "obj1",
      competencyText: "X",
      content: "Y",
      status: "ACTIVE",
    });

    const res = await PUT(
      jsonReq({}, "PUT") as never,
      { params: Promise.resolve({ id: "obj1" }) } as never,
    );
    expect(res.status).toBe(400);
    expect(learningObjectiveUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /indicators — C3", () => {
  it("rejects 400 when parent objective missing / wrong tenant / INACTIVE", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/indicators/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    learningObjectiveFindFirst.mockResolvedValue(null);

    const res = await POST(
      jsonReq({
        objectiveId: "obj-missing",
        content: "X",
        order: 1,
      }) as never,
    );
    expect(res.status).toBe(400);
    expect(learningObjectiveFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "obj-missing", tenantId: "t-curr", status: "ACTIVE" },
      }),
    );
    expect(achievementIndicatorCreate).not.toHaveBeenCalled();
  });

  it("creates an indicator + audits action=create on happy path", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/indicators/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    learningObjectiveFindFirst.mockResolvedValue({ id: "obj1" });
    achievementIndicatorCreate.mockResolvedValue({
      id: "ind1",
      objectiveId: "obj1",
      content: "Hafal doa makan",
      order: 1,
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await POST(
      jsonReq({
        objectiveId: "obj1",
        content: "Hafal doa makan",
        order: 1,
      }) as never,
    );
    expect(res.status).toBe(201);
    expect(achievementIndicatorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "t-curr",
          objectiveId: "obj1",
          content: "Hafal doa makan",
          order: 1,
        }),
      }),
    );
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "AchievementIndicator",
          action: "create",
        }),
      }),
    );
  });

  it("returns 403 when caller lacks curriculum.write", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/indicators/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(teacher);

    const res = await POST(
      jsonReq({ objectiveId: "obj1", content: "X", order: 1 }) as never,
    );
    expect(res.status).toBe(403);
    expect(achievementIndicatorCreate).not.toHaveBeenCalled();
  });
});

describe("GET /indicators — C3 status filter validation", () => {
  it("rejects invalid status enum with 400", async () => {
    const { GET } = await import(
      "@/app/api/admin/curriculum/indicators/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);

    const res = await GET(
      new Request(
        "http://l/api/admin/curriculum/indicators?status=bogus",
      ) as never,
    );
    expect(res.status).toBe(400);
  });

  it("accepts status=all (no filter applied)", async () => {
    const { GET } = await import(
      "@/app/api/admin/curriculum/indicators/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    achievementIndicatorFindMany.mockResolvedValueOnce([]);
    achievementIndicatorCount.mockResolvedValueOnce(0);

    const res = await GET(
      new Request(
        "http://l/api/admin/curriculum/indicators?status=all",
      ) as never,
    );
    expect(res.status).toBe(200);
    expect(achievementIndicatorFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ status: expect.anything() }),
      }),
    );
  });
});

describe("PUT /indicators/[id] — C3", () => {
  it("updates content + order; audits action=update", async () => {
    const { PUT } = await import(
      "@/app/api/admin/curriculum/indicators/[id]/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    achievementIndicatorFindFirst.mockResolvedValue({
      id: "ind1",
      content: "Lama",
      order: 1,
      status: "ACTIVE",
    });
    achievementIndicatorUpdate.mockResolvedValue({
      id: "ind1",
      objectiveId: "obj1",
      content: "Baru",
      order: 2,
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await PUT(
      jsonReq({ content: "Baru", order: 2 }, "PUT") as never,
      { params: Promise.resolve({ id: "ind1" }) } as never,
    );
    expect(res.status).toBe(200);
    expect(achievementIndicatorUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: "Baru", order: 2 }),
      }),
    );
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "AchievementIndicator",
          action: "update",
        }),
      }),
    );
  });

  it("status-only deactivate emits action=status:INACTIVE", async () => {
    const { PUT } = await import(
      "@/app/api/admin/curriculum/indicators/[id]/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    achievementIndicatorFindFirst.mockResolvedValue({
      id: "ind1",
      content: "X",
      order: 1,
      status: "ACTIVE",
    });
    achievementIndicatorUpdate.mockResolvedValue({
      id: "ind1",
      objectiveId: "obj1",
      content: "X",
      order: 1,
      status: "INACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await PUT(
      jsonReq({ status: "INACTIVE" }, "PUT") as never,
      { params: Promise.resolve({ id: "ind1" }) } as never,
    );
    expect(res.status).toBe(200);
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "AchievementIndicator",
          action: "status:INACTIVE",
        }),
      }),
    );
  });

  it("reactivate (status: ACTIVE) emits action=status:ACTIVE", async () => {
    const { PUT } = await import(
      "@/app/api/admin/curriculum/indicators/[id]/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    achievementIndicatorFindFirst.mockResolvedValue({
      id: "ind1",
      content: "X",
      order: 1,
      status: "INACTIVE",
    });
    achievementIndicatorUpdate.mockResolvedValue({
      id: "ind1",
      objectiveId: "obj1",
      content: "X",
      order: 1,
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await PUT(
      jsonReq({ status: "ACTIVE" }, "PUT") as never,
      { params: Promise.resolve({ id: "ind1" }) } as never,
    );
    expect(res.status).toBe(200);
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "AchievementIndicator",
          action: "status:ACTIVE",
        }),
      }),
    );
  });

  it("returns 404 when row belongs to a different tenant", async () => {
    const { PUT } = await import(
      "@/app/api/admin/curriculum/indicators/[id]/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    achievementIndicatorFindFirst.mockResolvedValue(null);

    const res = await PUT(
      jsonReq({ content: "X" }, "PUT") as never,
      { params: Promise.resolve({ id: "ind-other" }) } as never,
    );
    expect(res.status).toBe(404);
    expect(achievementIndicatorUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 when caller lacks curriculum.write", async () => {
    const { PUT } = await import(
      "@/app/api/admin/curriculum/indicators/[id]/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(teacher);

    const res = await PUT(
      jsonReq({ content: "X" }, "PUT") as never,
      { params: Promise.resolve({ id: "ind1" }) } as never,
    );
    expect(res.status).toBe(403);
    expect(achievementIndicatorUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /indicator-theme-links — C3 idempotent toggle", () => {
  const indicatorRow = {
    id: "ind1",
    objective: { semesterId: "sem1" },
  };
  const themeRow = { id: "thm1", semesterId: "sem1" };

  it("linked:true upserts + audits action=link", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/indicator-theme-links/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    achievementIndicatorFindFirst.mockResolvedValue(indicatorRow);
    themeFindFirst.mockResolvedValue(themeRow);
    indicatorThemeLinkUpsert.mockResolvedValue({
      indicatorId: "ind1",
      themeId: "thm1",
    });

    const res = await POST(
      jsonReq({
        indicatorId: "ind1",
        themeId: "thm1",
        linked: true,
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(indicatorThemeLinkUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { indicatorId_themeId: { indicatorId: "ind1", themeId: "thm1" } },
        create: { indicatorId: "ind1", themeId: "thm1" },
        update: {},
      }),
    );
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "IndicatorThemeLink",
          action: "link",
        }),
      }),
    );
  });

  it("linked:false deleteMany + audits action=unlink", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/indicator-theme-links/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    achievementIndicatorFindFirst.mockResolvedValue(indicatorRow);
    themeFindFirst.mockResolvedValue(themeRow);
    indicatorThemeLinkDeleteMany.mockResolvedValue({ count: 1 });

    const res = await POST(
      jsonReq({
        indicatorId: "ind1",
        themeId: "thm1",
        linked: false,
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(indicatorThemeLinkDeleteMany).toHaveBeenCalledWith({
      where: { indicatorId: "ind1", themeId: "thm1" },
    });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "IndicatorThemeLink",
          action: "unlink",
        }),
      }),
    );
  });

  it("idempotent linked:true on already-linked pair (upsert update:{} no-op)", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/indicator-theme-links/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    achievementIndicatorFindFirst.mockResolvedValue(indicatorRow);
    themeFindFirst.mockResolvedValue(themeRow);
    indicatorThemeLinkUpsert.mockResolvedValue({
      indicatorId: "ind1",
      themeId: "thm1",
    });

    const res = await POST(
      jsonReq({
        indicatorId: "ind1",
        themeId: "thm1",
        linked: true,
      }) as never,
    );
    expect(res.status).toBe(200);
    // Upsert is the idempotent operation — passes when called with empty update.
    expect(indicatorThemeLinkUpsert.mock.calls[0][0].update).toEqual({});
  });

  it("idempotent linked:false on already-unlinked pair (deleteMany count:0)", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/indicator-theme-links/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    achievementIndicatorFindFirst.mockResolvedValue(indicatorRow);
    themeFindFirst.mockResolvedValue(themeRow);
    indicatorThemeLinkDeleteMany.mockResolvedValue({ count: 0 });

    const res = await POST(
      jsonReq({
        indicatorId: "ind1",
        themeId: "thm1",
        linked: false,
      }) as never,
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 when indicator is in a different tenant", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/indicator-theme-links/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    achievementIndicatorFindFirst.mockResolvedValue(null);
    themeFindFirst.mockResolvedValue(themeRow);

    const res = await POST(
      jsonReq({
        indicatorId: "ind-other",
        themeId: "thm1",
        linked: true,
      }) as never,
    );
    expect(res.status).toBe(404);
    expect(indicatorThemeLinkUpsert).not.toHaveBeenCalled();
  });

  it("returns 404 when theme is in a different tenant", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/indicator-theme-links/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    achievementIndicatorFindFirst.mockResolvedValue(indicatorRow);
    themeFindFirst.mockResolvedValue(null);

    const res = await POST(
      jsonReq({
        indicatorId: "ind1",
        themeId: "thm-other",
        linked: true,
      }) as never,
    );
    expect(res.status).toBe(404);
    expect(indicatorThemeLinkUpsert).not.toHaveBeenCalled();
  });

  it("returns 422 when indicator + theme are in different semesters", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/indicator-theme-links/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    achievementIndicatorFindFirst.mockResolvedValue({
      id: "ind1",
      objective: { semesterId: "sem1" },
    });
    themeFindFirst.mockResolvedValue({ id: "thm-other-sem", semesterId: "sem2" });

    const res = await POST(
      jsonReq({
        indicatorId: "ind1",
        themeId: "thm-other-sem",
        linked: true,
      }) as never,
    );
    expect(res.status).toBe(422);
    expect(indicatorThemeLinkUpsert).not.toHaveBeenCalled();
  });

  it("returns 403 when caller lacks curriculum.write", async () => {
    const { POST } = await import(
      "@/app/api/admin/curriculum/indicator-theme-links/route"
    );
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(teacher);

    const res = await POST(
      jsonReq({
        indicatorId: "ind1",
        themeId: "thm1",
        linked: true,
      }) as never,
    );
    expect(res.status).toBe(403);
    expect(indicatorThemeLinkUpsert).not.toHaveBeenCalled();
  });
});

describe("POST /weeks — overlap detection", () => {
  it("returns 409 + conflictingWeekId when proposed range overlaps an ACTIVE sibling", async () => {
    const { POST } = await import("@/app/api/admin/curriculum/weeks/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    subThemeFindFirst.mockResolvedValue({ id: "st1" });
    weekFindMany.mockResolvedValue([
      { id: "w-existing", startDate: "2026-07-13", endDate: "2026-07-17", status: "ACTIVE" },
    ]);

    const res = await POST(
      jsonReq({ subThemeId: "st1", number: 2, startDate: "2026-07-15", endDate: "2026-07-21" }) as never,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflictingWeekId).toBe("w-existing");
    expect(weekCreate).not.toHaveBeenCalled();
  });

  it("creates + audits when range does NOT overlap (touching boundary)", async () => {
    const { POST } = await import("@/app/api/admin/curriculum/weeks/route");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(superAdmin);
    subThemeFindFirst.mockResolvedValue({ id: "st1" });
    weekFindMany.mockResolvedValue([
      { id: "w-existing", startDate: "2026-07-13", endDate: "2026-07-17", status: "ACTIVE" },
    ]);
    weekCreate.mockResolvedValue({
      id: "w-new",
      subThemeId: "st1",
      number: 2,
      startDate: new Date("2026-07-20T00:00:00Z"),
      endDate: new Date("2026-07-24T00:00:00Z"),
      status: "ACTIVE",
    });

    const res = await POST(
      jsonReq({ subThemeId: "st1", number: 2, startDate: "2026-07-20", endDate: "2026-07-24" }) as never,
    );
    expect(res.status).toBe(201);
    expect(weekCreate).toHaveBeenCalled();
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: "Week", action: "create" }),
      }),
    );
  });
});
