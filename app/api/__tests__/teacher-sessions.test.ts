import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../teacher/sessions/route";
import { POST } from "../teacher/sessions/[id]/attendance/route";
import { sessionAttendanceSchema } from "@/lib/validations/student-attendance";
import type { SessionUser } from "@/lib/auth";

/**
 * Teacher session endpoints (academic-hierarchy-refactor Task 7).
 *
 * Prisma is fully mocked. `getTodayInTimezone` is pinned so the GET default-date
 * branch is deterministic. `$transaction` is mocked to invoke its callback with
 * a tx object exposing the same studentAttendance mock.
 */

vi.mock("@/lib/db", () => {
  const studentAttendance = { upsert: vi.fn() };
  return {
    prisma: {
      classSession: { findMany: vi.fn(), findFirst: vi.fn() },
      studentEnrollment: { findMany: vi.fn() },
      studentAttendance,
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({ studentAttendance }),
      ),
    },
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ success: true })),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/attendance/timezone", () => ({
  getTodayInTimezone: vi.fn(() => "2026-05-15"),
}));

function makeSession(
  role: SessionUser["role"] = "TEACHER",
  employeeId: string | null = "emp1",
): SessionUser {
  return {
    id: "u1",
    email: "a@a",
    name: "A",
    role,
    tenantId: "t1",
    employeeId,
    parentId: null,
    permissions: [],
    customRoleCode: null,
  };
}

function postReq(body: unknown) {
  return new Request(
    "http://localhost:3000/api/teacher/sessions/cs1/attendance",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function postParams(id = "cs1") {
  return { params: Promise.resolve({ id }) };
}

const SESSION_ROW = {
  id: "cs1",
  classSectionId: "sec1",
  date: "2026-05-15",
  teacherId: "emp1",
};

describe("GET /api/teacher/sessions", () => {
  beforeEach(() => vi.clearAllMocks());

  function getReq(query = "") {
    return new Request(
      `http://localhost:3000/api/teacher/sessions${query ? `?${query}` : ""}`,
    );
  }

  it("returns 403 when caller is neither teacher nor admin", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession("GUARDIAN"));
    const res = await GET(getReq() as never);
    expect(res.status).toBe(403);
  });

  it("returns 403 when the caller has no employeeId (unlinked/demo account)", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", null));
    const res = await GET(getReq() as never);
    expect(res.status).toBe(403);
  });

  it("filters by teacherId === employeeId, tenant-scoped, default date today", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp1"));
    vi.mocked(prisma.classSession.findMany).mockResolvedValue([] as never);

    const res = await GET(getReq() as never);
    expect(res.status).toBe(200);
    expect(prisma.classSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          date: "2026-05-15",
          teacherId: "emp1",
          classSection: { tenantId: "t1" },
        },
        orderBy: { slot: "asc" },
      }),
    );
  });

  it("honours an explicit date query param", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp1"));
    vi.mocked(prisma.classSession.findMany).mockResolvedValue([] as never);

    await GET(getReq("date=2026-06-01") as never);
    expect(prisma.classSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ date: "2026-06-01" }),
      }),
    );
  });

  it("shapes each row with classSection + rosterCount", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp1"));
    vi.mocked(prisma.classSession.findMany).mockResolvedValue([
      {
        id: "cs1",
        date: "2026-05-15",
        slot: "MORNING",
        classSection: { id: "sec1", name: "TK A", _count: { enrollments: 12 } },
      },
    ] as never);

    const res = await GET(getReq() as never);
    const body = await res.json();
    expect(body).toEqual([
      {
        id: "cs1",
        date: "2026-05-15",
        slot: "MORNING",
        classSection: { id: "sec1", name: "TK A" },
        rosterCount: 12,
      },
    ]);
  });
});

describe("POST /api/teacher/sessions/[id]/attendance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the session is cross-tenant / not found", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp1"));
    vi.mocked(prisma.classSession.findFirst).mockResolvedValue(null);

    const res = await POST(
      postReq({ rows: [{ studentId: "s1", status: "PRESENT" }] }) as never,
      postParams(),
    );
    expect(res.status).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.studentAttendance.upsert).not.toHaveBeenCalled();
    expect(prisma.classSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cs1", classSection: { tenantId: "t1" } },
      }),
    );
  });

  it("returns 403 when caller is not the session's teacher and not admin", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "other-emp"));
    vi.mocked(prisma.classSession.findFirst).mockResolvedValue(
      SESSION_ROW as never,
    );

    const res = await POST(
      postReq({ rows: [{ studentId: "s1", status: "PRESENT" }] }) as never,
      postParams(),
    );
    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.studentAttendance.upsert).not.toHaveBeenCalled();
  });

  it("lets an admin write any tenant session", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(
      makeSession("SUPER_ADMIN", "admin-emp"),
    );
    vi.mocked(prisma.classSession.findFirst).mockResolvedValue(
      SESSION_ROW as never,
    );
    vi.mocked(prisma.studentEnrollment.findMany).mockResolvedValue([
      { studentId: "s1" },
    ] as never);
    vi.mocked(prisma.studentAttendance.upsert).mockResolvedValue({} as never);

    const res = await POST(
      postReq({ rows: [{ studentId: "s1", status: "PRESENT" }] }) as never,
      postParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ saved: 1, total: 1 });
  });

  it("returns 422 when a student is not ACTIVE-enrolled", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp1"));
    vi.mocked(prisma.classSession.findFirst).mockResolvedValue(
      SESSION_ROW as never,
    );
    vi.mocked(prisma.studentEnrollment.findMany).mockResolvedValue([
      { studentId: "s1" },
    ] as never);

    const res = await POST(
      postReq({
        rows: [
          { studentId: "s1", status: "PRESENT" },
          { studentId: "s2", status: "ABSENT" },
        ],
      }) as never,
      postParams(),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("student_not_enrolled");
    expect(prisma.studentAttendance.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 when pickedUpByRelation is OTHER without a name", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp1"));
    vi.mocked(prisma.classSession.findFirst).mockResolvedValue(
      SESSION_ROW as never,
    );

    const res = await POST(
      postReq({
        rows: [
          {
            studentId: "s1",
            status: "PRESENT",
            checkOutTime: "2026-05-15T08:00:00.000Z",
            pickedUpByRelation: "OTHER",
          },
        ],
      }) as never,
      postParams(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when checkOutTime precedes checkInTime", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp1"));
    vi.mocked(prisma.classSession.findFirst).mockResolvedValue(
      SESSION_ROW as never,
    );

    const res = await POST(
      postReq({
        rows: [
          {
            studentId: "s1",
            status: "PRESENT",
            checkInTime: "2026-05-15T09:00:00.000Z",
            checkOutTime: "2026-05-15T08:00:00.000Z",
          },
        ],
      }) as never,
      postParams(),
    );
    expect(res.status).toBe(400);
  });

  it("upserts each row keyed on (studentId, sessionId)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp1"));
    vi.mocked(prisma.classSession.findFirst).mockResolvedValue(
      SESSION_ROW as never,
    );
    vi.mocked(prisma.studentEnrollment.findMany).mockResolvedValue([
      { studentId: "s1" },
    ] as never);
    vi.mocked(prisma.studentAttendance.upsert).mockResolvedValue({} as never);

    const res = await POST(
      postReq({
        rows: [
          {
            studentId: "s1",
            status: "PRESENT",
            checkInTime: "2026-05-15T07:00:00.000Z",
          },
        ],
      }) as never,
      postParams(),
    );
    expect(res.status).toBe(200);
    const arg = vi.mocked(prisma.studentAttendance.upsert).mock.calls[0][0];
    expect(arg.where).toEqual({
      studentId_sessionId: { studentId: "s1", sessionId: "cs1" },
    });
    expect(arg.create).toMatchObject({
      studentId: "s1",
      sessionId: "cs1",
      classSectionId: "sec1",
      date: "2026-05-15",
      status: "PRESENT",
      checkedInBy: "emp1",
    });
    expect(arg.update).toMatchObject({
      classSectionId: "sec1",
      date: "2026-05-15",
      status: "PRESENT",
      checkedInBy: "emp1",
    });
  });

  it("explicitly re-records a voided session row as visible without replacing its identity or creation history", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp1"));
    vi.mocked(prisma.classSession.findFirst).mockResolvedValue(SESSION_ROW as never);
    vi.mocked(prisma.studentEnrollment.findMany).mockResolvedValue([{ studentId: "s1" }] as never);
    const stored = { id: "att-existing", isVoided: true, status: "SICK", checkedInBy: "previous-employee", createdAt: new Date("2026-05-15T00:00:00Z"), notes: "Existing note" };
    vi.mocked(prisma.studentAttendance.upsert).mockImplementationOnce((async (args: { update: object }) => {
      Object.assign(stored, args.update);
      return stored;
    }) as never);

    const res = await POST(postReq({ rows: [{ studentId: "s1", status: "PRESENT", checkInTime: "2026-05-15T01:00:00Z" }] }) as never, postParams());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: 1, total: 1 });
    expect(stored).toMatchObject({ id: "att-existing", isVoided: false, status: "PRESENT", checkedInBy: "emp1", createdAt: new Date("2026-05-15T00:00:00Z"), notes: "Existing note", checkInTime: new Date("2026-05-15T01:00:00Z") });
  });

  it("returns 429 when rate-limited", async () => {
    const { getSession } = await import("@/lib/auth");
    const { rateLimit } = await import("@/lib/rate-limit");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp1"));
    vi.mocked(rateLimit).mockReturnValueOnce({ success: false } as never);

    const res = await POST(
      postReq({ rows: [{ studentId: "s1", status: "PRESENT" }] }) as never,
      postParams(),
    );
    expect(res.status).toBe(429);
  });
});

describe("sessionAttendanceSchema", () => {
  it("accepts a minimal valid row", () => {
    const r = sessionAttendanceSchema.safeParse({
      rows: [{ studentId: "s1", status: "PRESENT" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects OTHER relation without a name", () => {
    const r = sessionAttendanceSchema.safeParse({
      rows: [
        { studentId: "s1", status: "PRESENT", pickedUpByRelation: "OTHER" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts OTHER relation with a name", () => {
    const r = sessionAttendanceSchema.safeParse({
      rows: [
        {
          studentId: "s1",
          status: "PRESENT",
          pickedUpByRelation: "OTHER",
          pickedUpByName: "Pak Tukang",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a non-OTHER relation without a name", () => {
    const r = sessionAttendanceSchema.safeParse({
      rows: [
        { studentId: "s1", status: "PRESENT", pickedUpByRelation: "PARENT" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects checkOutTime before checkInTime", () => {
    const r = sessionAttendanceSchema.safeParse({
      rows: [
        {
          studentId: "s1",
          status: "PRESENT",
          checkInTime: "2026-05-15T09:00:00.000Z",
          checkOutTime: "2026-05-15T08:00:00.000Z",
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts checkOutTime equal to checkInTime", () => {
    const r = sessionAttendanceSchema.safeParse({
      rows: [
        {
          studentId: "s1",
          status: "PRESENT",
          checkInTime: "2026-05-15T08:00:00.000Z",
          checkOutTime: "2026-05-15T08:00:00.000Z",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty rows array", () => {
    const r = sessionAttendanceSchema.safeParse({ rows: [] });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown status", () => {
    const r = sessionAttendanceSchema.safeParse({
      rows: [{ studentId: "s1", status: "LATE" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate studentId values in rows", () => {
    const r = sessionAttendanceSchema.safeParse({
      rows: [
        { studentId: "s1", status: "PRESENT" },
        { studentId: "s1", status: "ABSENT" },
      ],
    });
    expect(r.success).toBe(false);
  });
});
