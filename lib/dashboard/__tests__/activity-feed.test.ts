import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
    payrollRun: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    admission: { findMany: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    payment: { findMany: vi.fn() },
    reportCardEntry: { findMany: vi.fn() },
    classSection: { findMany: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn(),
}));

import { describeAuditEntry, getRecentActivity } from "@/lib/dashboard/activity-feed";
import { prisma } from "@/lib/db";

const mockAudit = prisma.auditLog.findMany as unknown as ReturnType<typeof vi.fn>;
const mockUser = prisma.user.findMany as unknown as ReturnType<typeof vi.fn>;

describe("getRecentActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAudit.mockResolvedValue([]);
    mockUser.mockResolvedValue([]);
  });

  it("returns empty array when no audit rows exist", async () => {
    const events = await getRecentActivity("tenant-1");
    expect(events).toEqual([]);
    expect(mockAudit).toHaveBeenCalledOnce();
    expect(mockAudit).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1" },
      orderBy: { createdAt: "desc" },
      take: 8,
    });
  });

  it("returns events with humanised verb for whitelisted entries", async () => {
    mockAudit.mockResolvedValue([
      {
        id: "a1",
        tenantId: "tenant-1",
        actorId: "u1",
        entity: "LeaveRequest",
        entityId: "lr1",
        action: "approve",
        before: null,
        after: null,
        createdAt: new Date("2026-05-03T10:00:00Z"),
      },
    ]);
    mockUser.mockResolvedValue([{ id: "u1", name: "Bu Sari", email: "sari@school.id" }]);
    (prisma.leaveRequest.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "lr1" },
    ]);

    const events = await getRecentActivity("tenant-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorName: "Bu Sari",
      actorInitials: "BS",
      verb: "menyetujui cuti lr1",
      href: "/admin/leave-requests",
    });
  });

  it("skips audit rows whose entity.action is not whitelisted", async () => {
    mockAudit.mockResolvedValue([
      {
        id: "a1",
        tenantId: "tenant-1",
        actorId: "u1",
        entity: "OrgConfig",
        entityId: "oc1",
        action: "update",
        before: null,
        after: null,
        createdAt: new Date(),
      },
    ]);
    mockUser.mockResolvedValue([{ id: "u1", name: "Admin", email: "a@s.id" }]);

    const events = await getRecentActivity("tenant-1");
    expect(events).toEqual([]);
  });

  it("skips rows whose target entity is hard-deleted (no name returned)", async () => {
    mockAudit.mockResolvedValue([
      {
        id: "a1",
        tenantId: "tenant-1",
        actorId: "u1",
        entity: "Employee",
        entityId: "missing-emp",
        action: "create",
        before: null,
        after: null,
        createdAt: new Date(),
      },
    ]);
    mockUser.mockResolvedValue([{ id: "u1", name: "Admin", email: "a@s.id" }]);
    (prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const events = await getRecentActivity("tenant-1");
    expect(events).toEqual([]);
  });

  it("falls back to email-prefix when actor.name is null", async () => {
    mockAudit.mockResolvedValue([
      {
        id: "a1",
        tenantId: "tenant-1",
        actorId: "u1",
        entity: "Invoice",
        entityId: "inv1",
        action: "create",
        before: null,
        after: null,
        createdAt: new Date(),
      },
    ]);
    mockUser.mockResolvedValue([{ id: "u1", name: null, email: "kepala@school.id" }]);
    (prisma.invoice.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "inv1", invoiceNumber: "INV-001" },
    ]);

    const events = await getRecentActivity("tenant-1");
    expect(events).toHaveLength(1);
    expect(events[0].actorName).toBe("kepala");
    expect(events[0].actorInitials).toBe("K");
    expect(events[0].verb).toBe("membuat tagihan INV-001");
  });

  it("honours the limit argument", async () => {
    mockAudit.mockResolvedValue([]);
    await getRecentActivity("tenant-1", 3);
    expect(mockAudit).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1" },
      orderBy: { createdAt: "desc" },
      take: 3,
    });
  });

  it("falls back actor name to 'Pengguna' when actor lookup misses", async () => {
    mockAudit.mockResolvedValue([
      {
        id: "a1",
        tenantId: "tenant-1",
        actorId: "ghost",
        entity: "Admission",
        entityId: "ad1",
        action: "create",
        before: null,
        after: null,
        createdAt: new Date(),
      },
    ]);
    mockUser.mockResolvedValue([]);
    (prisma.admission.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ad1", childName: "Aisyah" },
    ]);

    const events = await getRecentActivity("tenant-1");
    expect(events).toHaveLength(1);
    expect(events[0].actorName).toBe("Pengguna");
    expect(events[0].actorInitials).toBe("P");
    expect(events[0].verb).toBe("pendaftaran baru: Aisyah");
  });

  it("formats PayrollRun.periodStart (YYYY-MM-DD) into Indonesian month-year for display", async () => {
    mockAudit.mockResolvedValue([
      {
        id: "a1",
        tenantId: "tenant-1",
        actorId: "u1",
        entity: "PayrollRun",
        entityId: "pr1",
        action: "create",
        before: null,
        after: null,
        createdAt: new Date(),
      },
    ]);
    mockUser.mockResolvedValue([{ id: "u1", name: "Bu Sari", email: "sari@school.id" }]);
    (prisma.payrollRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "pr1", periodStart: "2026-04-01" },
    ]);

    const events = await getRecentActivity("tenant-1");
    expect(events).toHaveLength(1);
    expect(events[0].verb).toBe("membuat penggajian April 2026");
    expect(events[0].target).toBe("April 2026");
  });
});

// DOC-6: the feed whitelisted `StudentEnrollment.create` etc. while the app
// writes namespaced actions (`class.enrollment.add`) — the feed stayed empty.
// These pairs are copied from the `recordAudit(` call sites in app/api.
describe("describeAuditEntry — pairs the app actually writes", () => {
  const cases: Array<[string, string, string, unknown, string, string]> = [
    ["StudentEnrollment", "class.enrollment.add", "Aisyah", { className: "TKIT A" }, "memasukkan Aisyah ke kelas TKIT A", "/admin/classes"],
    ["StudentEnrollment", "class.enrollment.remove", "Aisyah", null, "mengeluarkan Aisyah dari kelasnya", "/admin/classes"],
    ["Payment", "record", "INV-001", null, "mencatat pembayaran INV-001", "/admin/invoices"],
    ["Payment", "reverse", "INV-001", null, "membatalkan pembayaran INV-001", "/admin/invoices"],
    ["Invoice", "void", "INV-002", null, "membatalkan tagihan INV-002", "/admin/invoices"],
    ["ReportCardEntry", "publish", "Aisyah", null, "menerbitkan rapor Aisyah", "/admin/report-cards"],
    ["ReportCardEntry", "unpublish", "Aisyah", null, "menarik kembali rapor Aisyah", "/admin/report-cards"],
    ["ClassSection", "class.create", "TKIT B", null, "membuat kelas TKIT B", "/admin/classes"],
    ["LeaveRequest", "cancel", "Bu Sari", null, "membatalkan cuti Bu Sari", "/admin/leave-requests"],
    ["PayrollRun", "cancel", "April 2026", null, "membatalkan penggajian April 2026", "/admin/payroll"],
    ["Employee", "deactivate", "Pak Budi", null, "menonaktifkan karyawan Pak Budi", "/admin/employees"],
    ["Employee", "restore", "Pak Budi", null, "mengaktifkan kembali karyawan Pak Budi", "/admin/employees"],
  ];

  it.each(cases)("%s.%s", (entity, action, target, after, verb, href) => {
    expect(describeAuditEntry(entity, action, target, { before: null, after })).toEqual({ verb, href });
  });

  it("falls back gracefully when the enrolment payload carries no class name", () => {
    expect(describeAuditEntry("StudentEnrollment", "class.enrollment.add", "Aisyah")?.verb).toBe(
      "memasukkan Aisyah ke sebuah kelas",
    );
  });

  it("keeps hiding rows that are noise or whose target is hard-deleted", () => {
    expect(describeAuditEntry("StudentEnrollment", "student.enroll.age-override", "x")).toBeNull();
    expect(describeAuditEntry("ClassSection", "class.delete", "x")).toBeNull();
    expect(describeAuditEntry("AssessmentEntry", "bulk-upsert", "x")).toBeNull();
  });
});

describe("getRecentActivity — real audit rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.mockResolvedValue([{ id: "u1", name: "Bu Sari", email: "sari@school.id" }]);
  });

  const row = (over: Record<string, unknown>) => ({
    id: "a1",
    tenantId: "tenant-1",
    actorId: "u1",
    before: null,
    after: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    ...over,
  });

  it("shows an enrolment added through the class roster, naming the student and class", async () => {
    mockAudit.mockResolvedValue([
      row({
        entity: "StudentEnrollment",
        entityId: "en1",
        action: "class.enrollment.add",
        after: { studentId: "s1", classSectionId: "c1", className: "TKIT A" },
      }),
    ]);
    (prisma.studentEnrollment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "en1", student: { name: "Aisyah" } },
    ]);

    const events = await getRecentActivity("tenant-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      verb: "memasukkan Aisyah ke kelas TKIT A",
      target: "Aisyah",
      href: "/admin/classes",
    });
  });

  it("shows a recorded payment against its invoice number", async () => {
    mockAudit.mockResolvedValue([row({ entity: "Payment", entityId: "p1", action: "record" })]);
    (prisma.payment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "p1", invoice: { invoiceNumber: "INV-009" } },
    ]);

    const events = await getRecentActivity("tenant-1");
    expect(events.map((e) => e.verb)).toEqual(["mencatat pembayaran INV-009"]);
  });

  it("shows a published report card and a created class, skips unlisted pairs", async () => {
    mockAudit.mockResolvedValue([
      row({ id: "a1", entity: "ReportCardEntry", entityId: "r1", action: "publish" }),
      row({ id: "a2", entity: "ClassSection", entityId: "c1", action: "class.create" }),
      row({ id: "a3", entity: "ClassSection", entityId: "c1", action: "class.delete" }),
    ]);
    (prisma.reportCardEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "r1", student: { name: "Aisyah" } },
    ]);
    (prisma.classSection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "c1", name: "TKIT B" },
    ]);

    const events = await getRecentActivity("tenant-1");
    expect(events.map((e) => e.verb)).toEqual(["menerbitkan rapor Aisyah", "membuat kelas TKIT B"]);
  });
});
