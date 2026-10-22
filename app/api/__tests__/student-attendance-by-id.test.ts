import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  studentAttendance: { findUnique: vi.fn() },
  teachingAssignment: { findFirst: vi.fn() },
}));
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({
  ...auth,
  isAdminRole: (role: string) => ["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(role),
}));

import { GET } from "../student-attendance/[id]/route";

const teacher = { id: "teacher", role: "TEACHER", tenantId: "tenant-a", employeeId: "employee-a" };
const record = {
  id: "att-1",
  classSectionId: "class-1",
  status: "PRESENT",
  classSection: { tenantId: "tenant-a" },
};
const call = () =>
  GET(new NextRequest("http://localhost/api/student-attendance/att-1"), {
    params: Promise.resolve({ id: "att-1" }),
  });

beforeEach(() => {
  vi.resetAllMocks();
  auth.getSession.mockResolvedValue(teacher);
  db.studentAttendance.findUnique.mockResolvedValue(record);
});

describe("GET /api/student-attendance/[id]", () => {
  it("lets an admin read any record in the tenant", async () => {
    auth.getSession.mockResolvedValue({ ...teacher, role: "SCHOOL_ADMIN", employeeId: null });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("att-1");
    expect(db.teachingAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("lets a teacher read a record of a class they are assigned to", async () => {
    db.teachingAssignment.findFirst.mockResolvedValue({ id: "assignment" });
    expect((await call()).status).toBe(200);
    expect(db.teachingAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        employeeId: "employee-a",
        classSectionId: "class-1",
        classSection: { tenantId: "tenant-a" },
      },
    });
  });

  it("403s a teacher who is not assigned to the record's class", async () => {
    db.teachingAssignment.findFirst.mockResolvedValue(null);
    expect((await call()).status).toBe(403);
  });

  it("403s a guardian without checking assignments", async () => {
    auth.getSession.mockResolvedValue({ ...teacher, role: "GUARDIAN", employeeId: null });
    expect((await call()).status).toBe(403);
    expect(db.teachingAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("keeps 404 for a record in another tenant, before any role check", async () => {
    db.studentAttendance.findUnique.mockResolvedValue({
      ...record,
      classSection: { tenantId: "tenant-b" },
    });
    expect((await call()).status).toBe(404);
    expect(db.teachingAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    auth.getSession.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
});
