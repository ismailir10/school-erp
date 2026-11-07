import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../teacher/gate/route";
import { gateActionSchema } from "@/lib/validations/gate";
import { getSession } from "@/lib/auth";
import { reconcileSessions } from "@/lib/sessions/reconcile";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";

vi.mock("@/lib/db", () => ({
  prisma: {
    campus: { findMany: vi.fn() },
    employee: { findFirst: vi.fn() },
    studentEnrollment: { findMany: vi.fn(), findFirst: vi.fn() },
    studentAttendance: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    classSession: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ success: true })),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/attendance/timezone", () => ({
  getTodayInTimezone: vi.fn(() => "2026-11-07"),
}));

vi.mock("@/lib/sessions/reconcile", () => ({
  reconcileSessions: vi.fn(),
}));

const db = vi.mocked(prisma, true);

function makeSession(
  role: SessionUser["role"] = "TEACHER",
  employeeId: string | null = "emp1",
  tenantId: string | null = "t1",
): SessionUser {
  return {
    id: "u1",
    email: "a@a",
    name: "A",
    role,
    tenantId,
    employeeId,
    parentId: null,
    permissions: [],
    customRoleCode: null,
  };
}

function postReq(body: unknown) {
  return new NextRequest("http://localhost/api/teacher/gate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
function getReq(qs = "") {
  return new NextRequest(`http://localhost/api/teacher/gate${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(makeSession());
  db.studentEnrollment.findFirst.mockResolvedValue({ classSectionId: "cs1" } as never);
  db.studentAttendance.findFirst.mockResolvedValue(null);
  db.classSession.findMany.mockResolvedValue([
    { id: "ses1", slot: "FULL_DAY", date: "2026-11-07" },
  ] as never);
});

describe("auth", () => {
  it("401 without a tenant session", async () => {
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp1", null));
    expect((await GET(getReq())).status).toBe(401);
    expect((await POST(postReq({}))).status).toBe(401);
  });

  it("403 for parents and for callers without an employee", async () => {
    vi.mocked(getSession).mockResolvedValue(makeSession("GUARDIAN"));
    expect((await POST(postReq({ studentId: "s1", action: "arrive" }))).status).toBe(403);
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", null));
    expect((await GET(getReq())).status).toBe(403);
  });
});

describe("GET", () => {
  it("defaults to the employee's campus and merges today's attendance", async () => {
    db.campus.findMany.mockResolvedValue([
      { id: "c1", name: "A" },
      { id: "c2", name: "B" },
    ] as never);
    db.employee.findFirst.mockResolvedValue({ campusId: "c2" } as never);
    db.studentEnrollment.findMany.mockResolvedValue([
      {
        student: { id: "s1", name: "Aisyah", nickname: null },
        classSection: { id: "cs1", name: "TK A" },
      },
    ] as never);
    db.studentAttendance.findMany.mockResolvedValue([
      {
        studentId: "s1",
        status: "PRESENT",
        checkInTime: new Date("2026-11-07T00:30:00Z"),
        checkOutTime: null,
        pickedUpByRelation: null,
        pickedUpByName: null,
      },
    ] as never);

    const body = await (await GET(getReq())).json();
    expect(body.campusId).toBe("c2");
    expect(body.students[0]).toMatchObject({
      studentId: "s1",
      className: "TK A",
      checkInTime: "2026-11-07T00:30:00.000Z",
    });
    const where = db.studentEnrollment.findMany.mock.calls[0][0]!.where as Record<string, unknown>;
    expect(where).toMatchObject({
      status: "ACTIVE",
      classSection: { tenantId: "t1", campusId: "c2" },
    });
  });

  it("404s a campus outside the tenant", async () => {
    db.campus.findMany.mockResolvedValue([{ id: "c1", name: "A" }] as never);
    expect((await GET(getReq("?campusId=other"))).status).toBe(404);
    expect(db.studentEnrollment.findMany).not.toHaveBeenCalled();
  });
});

describe("POST arrive", () => {
  it("scopes the student by tenant and campus, then upserts on the class session", async () => {
    const res = await POST(postReq({ studentId: "s1", action: "arrive", campusId: "c1" }));
    expect(res.status).toBe(200);
    const where = db.studentEnrollment.findFirst.mock.calls[0][0]!.where as Record<string, unknown>;
    expect(where).toMatchObject({
      studentId: "s1",
      student: { tenantId: "t1" },
      classSection: { tenantId: "t1", campusId: "c1" },
    });
    const call = db.studentAttendance.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ studentId_sessionId: { studentId: "s1", sessionId: "ses1" } });
    expect(call.create).toMatchObject({
      status: "PRESENT",
      classSectionId: "cs1",
      date: "2026-11-07",
      checkedInBy: "emp1",
    });
    expect(call.create.checkInTime).toBeInstanceOf(Date);
    expect(call.update).not.toHaveProperty("checkOutTime");
  });

  it("404s a student that is not enrolled in this tenant / campus", async () => {
    db.studentEnrollment.findFirst.mockResolvedValue(null);
    const res = await POST(postReq({ studentId: "x", action: "arrive" }));
    expect(res.status).toBe(404);
    expect(db.studentAttendance.upsert).not.toHaveBeenCalled();
  });

  it("is idempotent: a second arrival writes nothing", async () => {
    db.studentAttendance.findFirst.mockResolvedValue({
      id: "a1",
      sessionId: "ses1",
      status: "PRESENT",
      checkInTime: new Date("2026-11-07T00:30:00Z"),
      checkOutTime: null,
      isVoided: false,
    } as never);
    const body = await (await POST(postReq({ studentId: "s1", action: "arrive" }))).json();
    expect(body.alreadyDone).toBe(true);
    expect(body.time).toBe("2026-11-07T00:30:00.000Z");
    expect(db.studentAttendance.upsert).not.toHaveBeenCalled();
  });
});

describe("session resolution", () => {
  it("reuses the session of the child's existing row", async () => {
    db.studentAttendance.findFirst.mockResolvedValue({
      id: "a1",
      sessionId: "sesMorning",
      status: "PRESENT",
      checkInTime: new Date(),
      checkOutTime: null,
      isVoided: false,
    } as never);
    await POST(postReq({ studentId: "s1", action: "pickup" }));
    expect(db.classSession.findMany).not.toHaveBeenCalled();
    expect(db.studentAttendance.upsert.mock.calls[0][0].where).toEqual({
      studentId_sessionId: { studentId: "s1", sessionId: "sesMorning" },
    });
  });

  it("prefers MORNING for arrival and AFTERNOON for pickup on split days", async () => {
    db.classSession.findMany.mockResolvedValue([
      { id: "sesPm", slot: "AFTERNOON", date: "2026-11-07" },
      { id: "sesAm", slot: "MORNING", date: "2026-11-07" },
    ] as never);
    await POST(postReq({ studentId: "s1", action: "arrive" }));
    await POST(postReq({ studentId: "s1", action: "pickup" }));
    const ids = db.studentAttendance.upsert.mock.calls.map(
      (c) => c[0].where.studentId_sessionId!.sessionId,
    );
    expect(ids).toEqual(["sesAm", "sesPm"]);
  });

  it("reconciles once when today's session is missing, then 409s if still none", async () => {
    db.classSession.findMany.mockResolvedValue([] as never);
    const res = await POST(postReq({ studentId: "s1", action: "arrive" }));
    expect(reconcileSessions).toHaveBeenCalledWith("cs1");
    expect(res.status).toBe(409);
    expect(db.studentAttendance.upsert).not.toHaveBeenCalled();
  });

  it("uses the session reconcile just generated", async () => {
    db.classSession.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "sesNew", slot: "FULL_DAY", date: "2026-11-07" }] as never);
    const res = await POST(postReq({ studentId: "s1", action: "arrive" }));
    expect(res.status).toBe(200);
    expect(db.studentAttendance.upsert.mock.calls[0][0].create.sessionId).toBe("sesNew");
  });
});

describe("POST pickup", () => {
  it("defaults the relation to PARENT", async () => {
    await POST(postReq({ studentId: "s1", action: "pickup" }));
    const { create } = db.studentAttendance.upsert.mock.calls[0][0];
    expect(create).toMatchObject({ pickedUpByRelation: "PARENT", pickedUpByName: null });
    expect(create.checkOutTime).toBeInstanceOf(Date);
  });

  it("OTHER requires a name", async () => {
    const bad = await POST(postReq({ studentId: "s1", action: "pickup", relation: "OTHER" }));
    expect(bad.status).toBe(400);
    const blank = await POST(
      postReq({ studentId: "s1", action: "pickup", relation: "OTHER", name: "   " }),
    );
    expect(blank.status).toBe(400);
    expect(db.studentAttendance.upsert).not.toHaveBeenCalled();

    const ok = await POST(
      postReq({ studentId: "s1", action: "pickup", relation: "OTHER", name: " Pak Budi " }),
    );
    expect(ok.status).toBe(200);
    expect(db.studentAttendance.upsert.mock.calls[0][0].create).toMatchObject({
      pickedUpByRelation: "OTHER",
      pickedUpByName: "Pak Budi",
    });
  });

  it("is idempotent when already picked up", async () => {
    db.studentAttendance.findFirst.mockResolvedValue({
      id: "a1",
      sessionId: "ses1",
      status: "PRESENT",
      checkInTime: new Date(),
      checkOutTime: new Date("2026-11-07T05:00:00Z"),
      isVoided: false,
    } as never);
    const body = await (await POST(postReq({ studentId: "s1", action: "pickup" }))).json();
    expect(body.alreadyDone).toBe(true);
    expect(db.studentAttendance.upsert).not.toHaveBeenCalled();
  });
});

describe("undo", () => {
  it("undo_pickup clears pickup fields only", async () => {
    db.studentAttendance.findFirst.mockResolvedValue({
      id: "a1",
      sessionId: "ses1",
      status: "PRESENT",
      checkInTime: new Date(),
      checkOutTime: new Date(),
      isVoided: false,
    } as never);
    await POST(postReq({ studentId: "s1", action: "undo_pickup" }));
    expect(db.studentAttendance.update.mock.calls[0][0].data).toEqual({
      checkOutTime: null,
      pickedUpByRelation: null,
      pickedUpByName: null,
    });
  });

  it("undo_arrive removes a bare arrival but keeps a row that has a pickup", async () => {
    const row = {
      id: "a1",
      sessionId: "ses1",
      status: "PRESENT",
      checkInTime: new Date(),
      checkOutTime: null,
      isVoided: false,
    };
    db.studentAttendance.findFirst.mockResolvedValue(row as never);
    await POST(postReq({ studentId: "s1", action: "undo_arrive" }));
    expect(db.studentAttendance.delete).toHaveBeenCalledTimes(1);

    db.studentAttendance.findFirst.mockResolvedValue({ ...row, checkOutTime: new Date() } as never);
    await POST(postReq({ studentId: "s1", action: "undo_arrive" }));
    expect(db.studentAttendance.delete).toHaveBeenCalledTimes(1);
  });
});

describe("gateActionSchema", () => {
  it("rejects unknown actions", () => {
    expect(gateActionSchema.safeParse({ studentId: "s1", action: "nope" }).success).toBe(false);
  });
});
