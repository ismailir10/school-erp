/**
 * Coverage for the student enrollment leave (cuti) API, cycle
 * docs/cycles/2026-10-29-student-enrollment-leave.md:
 *   GET/POST  /api/students/[id]/leaves
 *   PUT       /api/students/[id]/leaves/[leaveId]
 *   GET       /api/students/[id]/leaves/[leaveId]/open-invoices
 *
 * One `db` mock plays both `prisma` and the `tx` handed to `$transaction`, so
 * the writes inside the transaction and the reads around it hit the same fns.
 * recordAudit is real (it writes through `auditLog.create`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { LEAVE_RECORDED_AFTER_DRAFT_REASON } from "@/lib/finance/leave-exclusion";

const db = vi.hoisted(() => ({
  student: { findFirst: vi.fn() },
  studentEnrollment: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  enrollmentLeave: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  billingRun: { findMany: vi.fn() },
  billingRunRow: { updateMany: vi.fn() },
  invoice: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});
const { rateLimit, ensureYearWritableById } = vi.hoisted(() => ({
  rateLimit: vi.fn((..._args: unknown[]) => ({ success: true })),
  ensureYearWritableById: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit, getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/classes/year-guard", () => ({ ensureYearWritableById }));

import { getSession } from "@/lib/auth";
import { GET, POST } from "../students/[id]/leaves/route";
import { PUT } from "../students/[id]/leaves/[leaveId]/route";
import { GET as GET_OPEN_INVOICES } from "../students/[id]/leaves/[leaveId]/open-invoices/route";

const ALL = ["students.view", "students.edit", "invoices.create", "invoices.view", "invoices.void"];

function session(permissions: string[] = ALL, tenantId = "tnt-1") {
  return {
    id: "u-1",
    email: "admin@test.com",
    name: "Admin",
    role: "SCHOOL_ADMIN" as const,
    tenantId,
    employeeId: null,
    parentId: null,
    permissions,
    customRoleCode: null,
  };
}
const as = (permissions?: string[]) => vi.mocked(getSession).mockResolvedValue(session(permissions) as never);

const json = (body: unknown) =>
  new Request("http://localhost/api/students/stu-1/leaves", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
const params = { params: Promise.resolve({ id: "stu-1" }) };
const leaveParams = { params: Promise.resolve({ id: "stu-1", leaveId: "lv-1" }) };

const validBody = { enrollmentId: "enr-1", startMonth: "2026-12", endMonth: "2027-01", reason: "Pulang kampung" };

// Year 2026/2027: window 2026-07 .. 2027-06.
function enrollmentRow(over: Record<string, unknown> = {}) {
  return {
    id: "enr-1",
    studentId: "stu-1",
    status: "ACTIVE",
    classSectionId: "cs-1",
    classSection: {
      tenantId: "tnt-1",
      academicYearId: "ay-1",
      academicYear: { name: "2026/2027", startDate: "2026-07-13", endDate: "2027-06-30" },
    },
    ...over,
  };
}

// An open billing run in year ay-1 whose scope covers class cs-1 (the placement under test).
const runIn = (id: string, periodLabel: string, status: string, over: Record<string, unknown> = {}) => ({
  id,
  periodLabel,
  status,
  academicYearId: "ay-1",
  scope: { classSectionIds: ["cs-1"], includeStudentIds: [] },
  ...over,
});

const createdLeave = {
  id: "lv-1",
  tenantId: "tnt-1",
  studentId: "stu-1",
  enrollmentId: "enr-1",
  startMonth: "2026-12",
  endMonth: "2027-01",
  reason: "Pulang kampung",
  status: "ACTIVE",
  createdBy: "u-1",
};

beforeEach(() => {
  vi.resetAllMocks();
  rateLimit.mockReturnValue({ success: true });
  ensureYearWritableById.mockResolvedValue({ ok: true, tenantId: "tnt-1", yearStatus: "ACTIVE" });
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(db));
  db.$executeRaw.mockResolvedValue(1);
  db.auditLog.create.mockResolvedValue({});
  db.student.findFirst.mockResolvedValue({ id: "stu-1", tenantId: "tnt-1", status: "ACTIVE" });
  db.studentEnrollment.findFirst.mockResolvedValue(enrollmentRow());
  db.studentEnrollment.count.mockResolvedValue(0);
  db.enrollmentLeave.findFirst.mockResolvedValue(null);
  db.enrollmentLeave.create.mockResolvedValue(createdLeave);
  db.billingRun.findMany.mockResolvedValue([]);
  db.billingRunRow.updateMany.mockResolvedValue({ count: 0 });
  db.invoice.findMany.mockResolvedValue([]);
  as();
});

describe("POST /api/students/[id]/leaves", () => {
  it("401/403 without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(json(validBody), params)).status).toBe(403);
  });

  it("403 for a non-admin role", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...session(), role: "TEACHER" } as never);
    expect((await POST(json(validBody), params)).status).toBe(403);
  });

  it("403 without students.edit", async () => {
    as(["students.view", "invoices.create"]);
    const res = await POST(json(validBody), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", missing: "students.edit" });
    expect(db.enrollmentLeave.create).not.toHaveBeenCalled();
  });

  it("403 with students.edit but no invoices.create", async () => {
    as(["students.view", "students.edit", "invoices.view"]);
    const res = await POST(json(validBody), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", missing: "invoices.create" });
    expect(db.enrollmentLeave.create).not.toHaveBeenCalled();
  });

  it("429 when rate limited", async () => {
    rateLimit.mockReturnValue({ success: false });
    expect((await POST(json(validBody), params)).status).toBe(429);
  });

  it("404 for another tenant's student (tenant-scoped lookup)", async () => {
    db.student.findFirst.mockResolvedValue(null);
    const res = await POST(json(validBody), params);
    expect(res.status).toBe(404);
    expect(db.student.findFirst).toHaveBeenCalledWith({ where: { id: "stu-1", tenantId: "tnt-1" } });
    expect(db.enrollmentLeave.create).not.toHaveBeenCalled();
  });

  it("404 when the enrollment belongs to another student", async () => {
    db.studentEnrollment.findFirst.mockResolvedValue(enrollmentRow({ studentId: "stu-other" }));
    expect((await POST(json(validBody), params)).status).toBe(404);
    expect(db.enrollmentLeave.create).not.toHaveBeenCalled();
  });

  it("404 when the enrollment's class belongs to another tenant", async () => {
    db.studentEnrollment.findFirst.mockResolvedValue(
      enrollmentRow({ classSection: { ...enrollmentRow().classSection, tenantId: "tnt-2" } }),
    );
    expect((await POST(json(validBody), params)).status).toBe(404);
  });

  it("404 when the enrollment does not exist", async () => {
    db.studentEnrollment.findFirst.mockResolvedValue(null);
    expect((await POST(json(validBody), params)).status).toBe(404);
  });

  it.each([
    ["an invalid month", { ...validBody, startMonth: "2026-13" }, "startMonth"],
    ["an end before the start", { ...validBody, startMonth: "2027-02", endMonth: "2027-01" }, "endMonth"],
    ["a too-short reason", { ...validBody, reason: "ab" }, "reason"],
    ["a missing enrollment", { ...validBody, enrollmentId: "" }, "enrollmentId"],
  ])("400 for %s", async (_label, body, field) => {
    const res = await POST(json(body), params);
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error).toBe("Validasi gagal");
    expect(payload.errors.map((e: { field: string }) => e.field)).toContain(field);
    expect(db.enrollmentLeave.create).not.toHaveBeenCalled();
  });

  it("ignores a studentId in the body: the student comes from the enrollment", async () => {
    const res = await POST(json({ ...validBody, studentId: "stu-evil" }), params);
    expect(res.status).toBe(201);
    expect(db.enrollmentLeave.create.mock.calls[0][0].data.studentId).toBe("stu-1");
  });

  it("409 when the enrollment is not ACTIVE", async () => {
    db.studentEnrollment.findFirst.mockResolvedValue(enrollmentRow({ status: "WITHDRAWN" }));
    const res = await POST(json(validBody), params);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("ENROLLMENT_NOT_ACTIVE");
    expect(db.enrollmentLeave.create).not.toHaveBeenCalled();
  });

  it("409 when the student is not ACTIVE", async () => {
    db.student.findFirst.mockResolvedValue({ id: "stu-1", tenantId: "tnt-1", status: "WITHDRAWN" });
    const res = await POST(json(validBody), params);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("STUDENT_NOT_ACTIVE");
  });

  it("returns the year guard's 403 for an archived year", async () => {
    ensureYearWritableById.mockResolvedValue(
      NextResponse.json({ error: "Tahun ajaran sudah diarsipkan.", code: "YEAR_ARCHIVED" }, { status: 403 }),
    );
    const res = await POST(json(validBody), params);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("YEAR_ARCHIVED");
    expect(ensureYearWritableById).toHaveBeenCalledWith("ay-1", "tnt-1", expect.any(String));
    expect(db.enrollmentLeave.create).not.toHaveBeenCalled();
  });

  it.each([
    ["starts before the window", { startMonth: "2026-06", endMonth: "2026-08" }],
    ["ends after the window", { startMonth: "2027-05", endMonth: "2027-07" }],
    ["lies wholly outside the year", { startMonth: "2028-01", endMonth: "2028-02" }],
  ])("400 when the leave %s", async (_label, months) => {
    const res = await POST(json({ ...validBody, ...months }), params);
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.code).toBe("OUTSIDE_ACADEMIC_YEAR");
    expect(payload.error).toContain("2026/2027");
    expect(db.enrollmentLeave.create).not.toHaveBeenCalled();
  });

  it("accepts a leave touching both ends of the window (13-month year capped at 12)", async () => {
    const res = await POST(json({ ...validBody, startMonth: "2026-07", endMonth: "2027-06" }), params);
    expect(res.status).toBe(201);
  });

  it("409 when the year has no usable dates", async () => {
    db.studentEnrollment.findFirst.mockResolvedValue(
      enrollmentRow({
        classSection: { tenantId: "tnt-1", academicYearId: "ay-1", academicYear: { name: "X", startDate: "2026-07-01", endDate: "2026-01-01" } },
      }),
    );
    const res = await POST(json(validBody), params);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("NO_ACADEMIC_YEAR_WINDOW");
  });

  it("409 'tumpang tindih' when an ACTIVE leave of the same enrollment overlaps", async () => {
    db.enrollmentLeave.findFirst.mockResolvedValue({ id: "lv-existing" });
    const res = await POST(json(validBody), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Cuti ini tumpang tindih dengan cuti lain.", code: "LEAVE_OVERLAP" });
    expect(db.enrollmentLeave.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("takes the per-enrollment advisory lock before the overlap check, and the check is ACTIVE-only and inclusive", async () => {
    const order: string[] = [];
    db.$executeRaw.mockImplementation(async (...args: unknown[]) => {
      order.push("lock");
      // tagged template: values after the strings array
      expect(args.slice(1)).toEqual(["enrollment-leave:enr-1"]);
      return 1;
    });
    db.enrollmentLeave.findFirst.mockImplementation(async () => {
      order.push("overlap-check");
      return null;
    });
    db.enrollmentLeave.create.mockImplementation(async () => {
      order.push("create");
      return createdLeave;
    });
    const res = await POST(json(validBody), params);
    expect(res.status).toBe(201);
    expect(order).toEqual(["lock", "overlap-check", "create"]);
    expect(db.enrollmentLeave.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: "tnt-1",
        enrollmentId: "enr-1",
        status: "ACTIVE",
        startMonth: { lte: "2027-01" },
        endMonth: { gte: "2026-12" },
      },
      select: { id: true },
    });
  });

  it("creates the leave and audits it (happy path)", async () => {
    const res = await POST(json({ ...validBody, reason: "  Pulang kampung  " }), params);
    expect(res.status).toBe(201);
    expect(db.enrollmentLeave.create).toHaveBeenCalledWith({
      data: {
        tenantId: "tnt-1",
        studentId: "stu-1",
        enrollmentId: "enr-1",
        startMonth: "2026-12",
        endMonth: "2027-01",
        reason: "Pulang kampung",
        createdBy: "u-1",
      },
    });
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
      tenantId: "tnt-1",
      actorId: "u-1",
      entity: "EnrollmentLeave",
      entityId: "lv-1",
      action: "create",
      after: expect.objectContaining({ enrollmentId: "enr-1", startMonth: "2026-12", endMonth: "2027-01" }),
    });
    const body = await res.json();
    expect(body).toMatchObject({
      leave: { id: "lv-1" },
      affectedRuns: [],
      openInvoices: [],
      canVoid: true,
      otherActiveEnrollments: false,
    });
  });

  it("rolls back (500) when the audit write fails, instead of keeping an unaudited leave", async () => {
    db.auditLog.create.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(json(validBody), params);
    expect(res.status).toBe(500);
  });

  it("parks only the student's unclaimed PENDING rows in open covering runs that bill this placement", async () => {
    db.billingRun.findMany.mockResolvedValue([
      runIn("run-dec", "Desember 2026", "DRAFT"),
      runIn("run-jan", "Januari 2027", "COMMITTING", { scope: { classSectionIds: [], includeStudentIds: ["stu-1"] } }),
      runIn("run-feb", "Februari 2027", "DRAFT"), // outside the leave
      runIn("run-sem", "Semester 1 2026/2027", "DRAFT"), // not a single month
      runIn("run-school", "Desember 2026", "DRAFT", { scope: { classSectionIds: ["cs-school"], includeStudentIds: [] } }), // another class: never billed this placement
      runIn("run-old-year", "Desember 2026", "DRAFT", { academicYearId: "ay-0" }), // another academic year
    ]);
    db.billingRunRow.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(json(validBody), params);
    expect(res.status).toBe(201);

    // Only DRAFT/COMMITTING runs of the tenant are looked at (COMMITTED never is).
    expect(db.billingRun.findMany.mock.calls[0][0].where).toEqual({
      tenantId: "tnt-1",
      status: { in: ["DRAFT", "COMMITTING"] },
    });
    expect(db.billingRunRow.updateMany).toHaveBeenCalledTimes(2);
    for (const [i, runId] of ["run-dec", "run-jan"].entries()) {
      expect(db.billingRunRow.updateMany.mock.calls[i][0]).toEqual({
        where: {
          billingRunId: runId,
          studentId: "stu-1",
          status: "PENDING",
          invoiceId: null,
        },
        data: { status: "EXCLUDED", error: LEAVE_RECORDED_AFTER_DRAFT_REASON },
      });
    }
    const body = await res.json();
    expect(body.affectedRuns).toEqual([
      { id: "run-dec", periodLabel: "Desember 2026", status: "DRAFT" },
      { id: "run-jan", periodLabel: "Januari 2027", status: "COMMITTING" },
    ]);
    expect(db.auditLog.create.mock.calls[0][0].data.after.excludedFromRunIds).toEqual(["run-dec", "run-jan"]);
  });

  it("does not report a run in affectedRuns when the student had no uncommitted row there", async () => {
    db.billingRun.findMany.mockResolvedValue([runIn("run-dec", "Desember 2026", "DRAFT")]);
    db.billingRunRow.updateMany.mockResolvedValue({ count: 0 }); // COMMITTED / claimed / not in scope
    const body = await (await POST(json(validBody), params)).json();
    expect(body.affectedRuns).toEqual([]);
  });

  it("returns the cancellable open invoices when the caller has invoices.view", async () => {
    db.invoice.findMany.mockResolvedValue([
      {
        id: "inv-1",
        invoiceNumber: "INV-1",
        periodLabel: "Desember 2026",
        status: "SENT",
        totalDue: "500000",
        dueDate: "2026-12-31",
        lines: [{ labelSnapshot: "SPP", finalAmount: "500000", feeComponent: { isRecurring: true } }],
      },
      // Another label for a month inside the leave: matched by month, so listed.
      {
        id: "inv-2",
        invoiceNumber: "INV-2",
        periodLabel: "Jan 2027",
        status: "OVERDUE",
        totalDue: "100",
        dueDate: "2027-01-31",
        lines: [],
      },
      // Not a single month: never listed.
      {
        id: "inv-3",
        invoiceNumber: "INV-3",
        periodLabel: "Semester 1 2026/2027",
        status: "SENT",
        totalDue: "1",
        dueDate: "2027-01-31",
        lines: [],
      },
    ]);
    db.studentEnrollment.count.mockResolvedValue(1);
    const body = await (await POST(json(validBody), params)).json();
    expect(body.openInvoices.map((i: { id: string }) => i.id)).toEqual(["inv-1", "inv-2"]);
    expect(body.otherActiveEnrollments).toBe(true);
    // Paid/partly-paid invoices are excluded by the query itself.
    const where = db.invoice.findMany.mock.calls[0][0].where;
    expect(where.status.in).not.toContain("PAID");
    expect(where.totalPaid).toEqual({ lte: 0 });
    expect(where.payments.none.amount).toEqual({ gt: 0 });
  });

  it("openInvoices is null without invoices.view, and canVoid follows invoices.void", async () => {
    as(["students.view", "students.edit", "invoices.create"]);
    const body = await (await POST(json(validBody), params)).json();
    expect(body.openInvoices).toBeNull();
    expect(body.canVoid).toBe(false);
    expect(db.invoice.findMany).not.toHaveBeenCalled();
  });

  it("still returns 201 when the post-commit invoice lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.invoice.findMany.mockRejectedValue(new Error("boom"));
    const res = await POST(json(validBody), params);
    expect(res.status).toBe(201);
    expect((await res.json()).openInvoices).toBeNull();
  });
});

describe("GET /api/students/[id]/leaves", () => {
  const enrollmentView = (over: Record<string, unknown> = {}) => ({
    id: "enr-1",
    status: "ACTIVE",
    classSection: {
      name: "D'Care A",
      program: { name: "Daycare" },
      academicYear: { id: "ay-1", name: "2026/2027", status: "ACTIVE", startDate: "2026-07-13", endDate: "2027-06-30" },
    },
    ...over,
  });

  it("403 without students.view", async () => {
    as(["invoices.view"]);
    const res = await GET({} as never, params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", missing: "students.view" });
  });

  it("404 for another tenant's student", async () => {
    db.student.findFirst.mockResolvedValue(null);
    const res = await GET({} as never, params);
    expect(res.status).toBe(404);
    expect(db.student.findFirst.mock.calls[0][0].where).toEqual({ id: "stu-1", tenantId: "tnt-1" });
    expect(db.enrollmentLeave.findMany).not.toHaveBeenCalled();
  });

  it("lists leaves newest first with enrollment info, and eligibility per enrollment", async () => {
    db.enrollmentLeave.findMany.mockResolvedValue([
      { ...createdLeave, createdAt: new Date("2026-10-29T00:00:00Z"), cancelledBy: null, cancelledAt: null, enrollment: enrollmentView() },
    ]);
    db.studentEnrollment.findMany.mockResolvedValue([
      enrollmentView(),
      enrollmentView({
        id: "enr-old",
        classSection: {
          name: "TK B",
          program: { name: "Sekolah" },
          academicYear: { id: "ay-0", name: "2025/2026", status: "ARCHIVED", startDate: "2025-07-14", endDate: "2026-06-30" },
        },
      }),
      enrollmentView({ id: "enr-wd", status: "WITHDRAWN" }),
    ]);

    const res = await GET({} as never, params);
    expect(res.status).toBe(200);
    expect(db.enrollmentLeave.findMany.mock.calls[0][0]).toMatchObject({
      where: { tenantId: "tnt-1", studentId: "stu-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "lv-1",
      enrollmentId: "enr-1",
      startMonth: "2026-12",
      endMonth: "2027-01",
      reason: "Pulang kampung",
      status: "ACTIVE",
      enrollment: {
        id: "enr-1",
        status: "ACTIVE",
        className: "D'Care A",
        programName: "Daycare",
        academicYearId: "ay-1",
        academicYearName: "2026/2027",
      },
    });
    expect(body.enrollments).toEqual([
      expect.objectContaining({ id: "enr-1", eligible: true, ineligibleReason: null, window: { from: "2026-07", to: "2027-06" } }),
      expect.objectContaining({ id: "enr-old", eligible: false, ineligibleReason: expect.any(String) }),
      expect.objectContaining({ id: "enr-wd", eligible: false, ineligibleReason: expect.any(String) }),
    ]);
    // Enrollments are tenant-scoped through the class.
    expect(db.studentEnrollment.findMany.mock.calls[0][0].where).toEqual({
      studentId: "stu-1",
      classSection: { tenantId: "tnt-1" },
    });
  });

  it("marks every enrollment ineligible for a non-ACTIVE student", async () => {
    db.student.findFirst.mockResolvedValue({ id: "stu-1", status: "WITHDRAWN" });
    db.enrollmentLeave.findMany.mockResolvedValue([]);
    db.studentEnrollment.findMany.mockResolvedValue([enrollmentView()]);
    const body = await (await GET({} as never, params)).json();
    expect(body.enrollments[0].eligible).toBe(false);
  });
});

describe("PUT /api/students/[id]/leaves/[leaveId] (cancel)", () => {
  const put = (body: unknown = { status: "INACTIVE" }) =>
    new Request("http://localhost/api/students/stu-1/leaves/lv-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never;

  beforeEach(() => {
    db.enrollmentLeave.findFirst.mockResolvedValue({ ...createdLeave });
    db.enrollmentLeave.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...createdLeave,
      ...data,
    }));
  });

  it("403 without students.edit, and with students.edit but no invoices.create", async () => {
    as(["students.view", "invoices.create"]);
    let res = await PUT(put(), leaveParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ missing: "students.edit" });
    as(["students.edit"]);
    res = await PUT(put(), leaveParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ missing: "invoices.create" });
    expect(db.enrollmentLeave.update).not.toHaveBeenCalled();
  });

  it("400 for any status other than INACTIVE", async () => {
    expect((await PUT(put({ status: "ACTIVE" }), leaveParams)).status).toBe(400);
    expect((await PUT(put({}), leaveParams)).status).toBe(400);
    expect(db.enrollmentLeave.update).not.toHaveBeenCalled();
  });

  it("404 when the leave is another tenant's or another student's (scoped lookup)", async () => {
    db.enrollmentLeave.findFirst.mockResolvedValue(null);
    const res = await PUT(put(), leaveParams);
    expect(res.status).toBe(404);
    expect(db.enrollmentLeave.findFirst.mock.calls[0][0].where).toEqual({
      id: "lv-1",
      tenantId: "tnt-1",
      studentId: "stu-1",
    });
  });

  it("cancels an ACTIVE leave under the same advisory lock, stamps who/when, and audits", async () => {
    const res = await PUT(put(), leaveParams);
    expect(res.status).toBe(200);
    expect(db.$executeRaw.mock.calls[0].slice(1)).toEqual(["enrollment-leave:enr-1"]);
    const data = db.enrollmentLeave.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "INACTIVE", cancelledBy: "u-1" });
    expect(data.cancelledAt).toBeInstanceOf(Date);
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entity: "EnrollmentLeave",
      entityId: "lv-1",
      action: "cancel",
      actorId: "u-1",
      before: { status: "ACTIVE" },
      after: expect.objectContaining({ status: "INACTIVE" }),
    });
    expect(await res.json()).toMatchObject({ leave: { id: "lv-1", status: "INACTIVE" }, affectedRuns: [] });
  });

  it("409 on a second cancel (already INACTIVE), with no write", async () => {
    db.enrollmentLeave.findFirst.mockResolvedValue({ ...createdLeave, status: "INACTIVE" });
    const res = await PUT(put(), leaveParams);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("ALREADY_CANCELLED");
    expect(db.enrollmentLeave.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("reports open runs covering the leave but never mutates runs or invoices", async () => {
    db.studentEnrollment.findUnique.mockResolvedValue({ classSectionId: "cs-1", classSection: { academicYearId: "ay-1" } });
    db.billingRun.findMany.mockResolvedValue([
      runIn("run-dec", "Desember 2026", "DRAFT"),
      runIn("run-mar", "Maret 2027", "DRAFT"),
      runIn("run-school", "Desember 2026", "DRAFT", { scope: { classSectionIds: ["cs-school"], includeStudentIds: [] } }),
    ]);
    const body = await (await PUT(put(), leaveParams)).json();
    expect(body.affectedRuns).toEqual([{ id: "run-dec", periodLabel: "Desember 2026", status: "DRAFT" }]);
    expect(db.billingRunRow.updateMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/students/[id]/leaves/[leaveId]/open-invoices", () => {
  const leaveRow = {
    id: "lv-1",
    studentId: "stu-1",
    enrollmentId: "enr-1",
    startMonth: "2026-12",
    endMonth: "2027-01",
    status: "ACTIVE",
    enrollment: { classSection: { academicYearId: "ay-1" } },
  };
  const invoiceRow = (over: Record<string, unknown> = {}) => ({
    id: "inv-1",
    invoiceNumber: "INV-1",
    periodLabel: "Desember 2026",
    status: "SENT",
    totalDue: "550000",
    dueDate: "2026-12-31",
    lines: [
      { labelSnapshot: "SPP", finalAmount: "500000", feeComponent: { isRecurring: true } },
      { labelSnapshot: "Seragam", finalAmount: "50000", feeComponent: { isRecurring: false } },
    ],
    ...over,
  });

  beforeEach(() => {
    db.enrollmentLeave.findFirst.mockResolvedValue(leaveRow);
  });

  it("403 without invoices.view, and without students.view", async () => {
    as(["students.view"]);
    let res = await GET_OPEN_INVOICES({} as never, leaveParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ missing: "invoices.view" });
    as(["invoices.view"]);
    res = await GET_OPEN_INVOICES({} as never, leaveParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ missing: "students.view" });
    expect(db.invoice.findMany).not.toHaveBeenCalled();
  });

  it("404 for a leave of another tenant or student", async () => {
    db.enrollmentLeave.findFirst.mockResolvedValue(null);
    const res = await GET_OPEN_INVOICES({} as never, leaveParams);
    expect(res.status).toBe(404);
    expect(db.enrollmentLeave.findFirst.mock.calls[0][0].where).toEqual({
      id: "lv-1",
      tenantId: "tnt-1",
      studentId: "stu-1",
    });
  });

  it("returns cancellable invoices for the leave's months, with the note", async () => {
    db.invoice.findMany.mockResolvedValue([
      invoiceRow(),
      invoiceRow({ id: "inv-feb", periodLabel: "Februari 2027" }),
      invoiceRow({ id: "inv-other", periodLabel: "Semester 1 2026/2027" }),
    ]);
    db.studentEnrollment.count.mockResolvedValue(1);
    const res = await GET_OPEN_INVOICES({} as never, leaveParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openInvoices).toEqual([
      {
        id: "inv-1",
        invoiceNumber: "INV-1",
        periodLabel: "Desember 2026",
        status: "SENT",
        totalDue: 550000,
        dueDate: "2026-12-31",
        lines: [
          { label: "SPP", finalAmount: 500000, isRecurring: true },
          { label: "Seragam", finalAmount: 50000, isRecurring: false },
        ],
        hasOneOffLines: true,
      },
    ]);
    expect(body.note).toBe("Tagihan dengan label periode lain tidak ditampilkan.");
    expect(body.canVoid).toBe(true);
    expect(body.otherActiveEnrollments).toBe(true);
    expect(body.leave).toEqual({ id: "lv-1", startMonth: "2026-12", endMonth: "2027-01", status: "ACTIVE" });
  });

  it("excludes invoices that took payment via the query filter (paid / partly paid)", async () => {
    await GET_OPEN_INVOICES({} as never, leaveParams);
    const where = db.invoice.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: "tnt-1", studentId: "stu-1" });
    expect(where.status.in).not.toContain("PAID");
    expect(where.status.in).not.toContain("CANCELLED");
    expect(where.totalPaid).toEqual({ lte: 0 });
    expect(where.payments).toEqual({ none: { status: { not: "REVERSED" }, amount: { gt: 0 } } });
  });

  it("canVoid is false without invoices.void", async () => {
    as(["students.view", "invoices.view"]);
    const body = await (await GET_OPEN_INVOICES({} as never, leaveParams)).json();
    expect(body.canVoid).toBe(false);
  });
});
