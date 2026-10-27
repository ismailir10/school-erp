import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

/**
 * Cycle 2026-10-27-class-program-visibility (T1): PATCH /api/admin/classes/[id]
 * may move a class to another program — the billing run reads the class's own
 * program, so a wrongly linked class bills the wrong fee structure. The move
 * needs an ACTIVE program of the same tenant and is refused once the class's
 * students hold invoices this year.
 */

const { requirePermission, db, tx, recordAudit } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    studentEnrollment: { count: vi.fn(), findFirst: vi.fn() },
    classSection: { updateMany: vi.fn() },
    classTrack: { updateMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    billingRunRow: { findMany: vi.fn() },
  };
  const db = {
    classSection: { findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    program: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { requirePermission: vi.fn(), db, tx, recordAudit: vi.fn() };
});

vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/audit", () => ({ recordAudit }));
const { ensureYearWritableForClass } = vi.hoisted(() => ({ ensureYearWritableForClass: vi.fn() }));
vi.mock("@/lib/classes/year-guard", () => ({ ensureYearWritableForClass }));

import { PATCH } from "@/app/api/admin/classes/[id]/route";

const ALLOW = { session: { tenantId: "t1", id: "u1", role: "SCHOOL_ADMIN" } };
const ctx = { params: Promise.resolve({ id: "c1" }) };

function req(body: unknown) {
  return new Request("http://localhost/api/admin/classes/c1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const BEFORE = {
  id: "c1",
  name: "TK A 1",
  capacity: 20,
  slotTemplate: "FULL_DAY",
  ageGroup: "A",
  status: "ACTIVE",
  classTrackId: "ct1",
  academicYearId: "ay1",
  campusId: "cp1",
  programId: "p-b",
  program: { type: "SEMESTER" },
  academicYear: { startDate: "2026-07-01" },
};

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue(ALLOW);
  db.classSection.findFirst.mockImplementation(async (args: { where: { name?: unknown } }) =>
    args.where.name ? null : BEFORE,
  );
  db.classSection.findFirstOrThrow.mockResolvedValue({ ...BEFORE, programId: "p-a" });
  db.program.findFirst.mockResolvedValue({ id: "p-a", type: "SEMESTER" });
  tx.invoice.findMany.mockResolvedValue([]);
  tx.billingRunRow.findMany.mockResolvedValue([]);
  tx.classSection.updateMany.mockResolvedValue({ count: 1 });
  tx.studentEnrollment.findFirst.mockResolvedValue(null);
  ensureYearWritableForClass.mockResolvedValue({ ok: true });
});

describe("PATCH /api/admin/classes/[id] — program change", () => {
  it("moves the class to the new program and audits it as a program change", async () => {
    const res = await PATCH(req({ programId: "p-a" }), ctx);

    expect(res.status).toBe(200);
    expect(tx.classSection.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", tenantId: "t1", programId: "p-b" },
      data: { programId: "p-a" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        entity: "ClassSection",
        entityId: "c1",
        action: "class.program_change",
        before: expect.objectContaining({ programId: "p-b" }),
        after: expect.objectContaining({ programId: "p-a" }),
      }),
    );
  });

  it("only accepts an ACTIVE program of the caller's own tenant", async () => {
    await PATCH(req({ programId: "p-a" }), ctx);

    expect(db.program.findFirst).toHaveBeenCalledWith({
      where: { id: "p-a", tenantId: "t1", status: "ACTIVE" },
      select: { id: true, type: true },
    });
  });

  it("rejects an unknown, inactive or foreign program on the program field", async () => {
    db.program.findFirst.mockResolvedValue(null);

    const res = await PATCH(req({ programId: "p-x" }), ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("programId");
    expect(body.errors).toEqual([{ field: "programId", message: body.error }]);
    expect(tx.classSection.updateMany).not.toHaveBeenCalled();
  });

  it("refuses with a 409 once the class's students hold invoices this year", async () => {
    tx.invoice.findMany.mockResolvedValue([{ studentId: "s1" }, { studentId: "s2" }]);

    const res = await PATCH(req({ programId: "p-a" }), ctx);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("PROGRAM_HAS_INVOICES");
    expect(body.field).toBe("programId");
    expect(body.error).toContain("2 siswa");
    expect(tx.classSection.updateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("counts this tenant's non-cancelled invoices from the year's billing runs or since its Jakarta start", async () => {
    tx.billingRunRow.findMany.mockResolvedValue([{ invoiceId: "inv-run" }, { invoiceId: null }]);

    await PATCH(req({ programId: "p-a" }), ctx);

    const enrolled = {
      enrollments: { some: { classSectionId: "c1", status: { not: "WITHDRAWN" } } },
    };
    expect(tx.billingRunRow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "COMMITTED",
          invoiceId: { not: null },
          billingRun: { tenantId: "t1", academicYearId: "ay1" },
          student: enrolled,
        },
      }),
    );
    expect(tx.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "t1",
          status: { not: "CANCELLED" },
          student: enrolled,
          OR: [
            { id: { in: ["inv-run"] } },
            { createdAt: { gte: new Date("2026-07-01T00:00:00+07:00") } },
          ],
        },
      }),
    );
  });

  it("serialises on the class with an advisory lock before checking", async () => {
    await PATCH(req({ programId: "p-a" }), ctx);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("refuses a move to a program of another type when a student would hold two enrolments in it", async () => {
    db.program.findFirst.mockResolvedValue({ id: "p-d", type: "YEAR_ROUND" });
    tx.studentEnrollment.findFirst.mockResolvedValue({
      student: { name: "Aisyah", enrollments: [{ classSection: { name: "Daycare 1" } }] },
    });

    const res = await PATCH(req({ programId: "p-d" }), ctx);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("PROGRAM_TYPE_CONFLICT");
    expect(body.field).toBe("programId");
    expect(body.error).toContain("Aisyah");
    expect(body.error).toContain("Daycare 1");
    expect(tx.classSection.updateMany).not.toHaveBeenCalled();
  });

  it("allows a move to a program of another type when nobody clashes", async () => {
    db.program.findFirst.mockResolvedValue({ id: "p-d", type: "YEAR_ROUND" });

    const res = await PATCH(req({ programId: "p-d" }), ctx);

    expect(res.status).toBe(200);
    expect(tx.studentEnrollment.findFirst).toHaveBeenCalledTimes(1);
  });

  it("does not look for enrolment clashes when the program type stays the same", async () => {
    await PATCH(req({ programId: "p-a" }), ctx);

    expect(tx.studentEnrollment.findFirst).not.toHaveBeenCalled();
  });

  it("answers 409 instead of overwriting when someone else moved the class first", async () => {
    tx.classSection.updateMany.mockResolvedValue({ count: 0 });

    const res = await PATCH(req({ programId: "p-a" }), ctx);

    expect(res.status).toBe(409);
    expect((await res.json()).field).toBe("programId");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("leaves a class of an archived year alone", async () => {
    ensureYearWritableForClass.mockResolvedValue(
      NextResponse.json({ error: "Tahun ajaran sudah diarsipkan.", code: "YEAR_ARCHIVED" }, { status: 403 }),
    );

    const res = await PATCH(req({ programId: "p-a" }), ctx);

    expect(res.status).toBe(403);
    expect(db.program.findFirst).not.toHaveBeenCalled();
    expect(tx.classSection.updateMany).not.toHaveBeenCalled();
  });

  it("allows the move in a planning year", async () => {
    ensureYearWritableForClass.mockResolvedValue({ ok: true, tenantId: "t1", yearStatus: "PLANNING" });

    expect((await PATCH(req({ programId: "p-a" }), ctx)).status).toBe(200);
  });

  it("treats the class's current program as no change and skips every program check", async () => {
    const res = await PATCH(req({ programId: "p-b", name: "TK A 1b" }), ctx);

    expect(res.status).toBe(200);
    expect(db.program.findFirst).not.toHaveBeenCalled();
    expect(tx.invoice.findMany).not.toHaveBeenCalled();
    expect(tx.classSection.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", tenantId: "t1" },
      data: { name: "TK A 1b" },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "update" }));
  });

  it("does not check invoices for an edit that leaves the program alone", async () => {
    await PATCH(req({ capacity: 25 }), ctx);

    expect(tx.invoice.findMany).not.toHaveBeenCalled();
  });

  it("rejects an empty programId with a validation error", async () => {
    const res = await PATCH(req({ programId: "" }), ctx);

    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([
      { field: "programId", message: "Program wajib dipilih" },
    ]);
  });
});
