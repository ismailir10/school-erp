import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  fingerprintPlan,
  loadSppPrepayContext,
  planForContext,
  type SppPrepayContext,
} from "../spp-prepay-load";
import type { PlanInvoice, PlanRow } from "../spp-prepay-plan";

const D = (v: string | number) => new Prisma.Decimal(v);

type Overrides = {
  student?: unknown;
  year?: unknown;
  enrollments?: unknown[];
  adjustments?: unknown[];
  invoices?: unknown[];
  labels?: unknown[];
  fees?: unknown[];
};

const YEAR = { id: "ay-1", name: "2026/2027", startDate: "2026-07-01", endDate: "2027-06-30" };

const ENROLLMENT = {
  studentId: "s-1",
  classSectionId: "cs-1",
  student: { id: "s-1", name: "Budi" },
  classSection: { name: "TKIT A", programId: "p-1", program: { name: "TKIT" } },
};

const SPP_FEE = { programId: "p-1", feeComponentId: "fc-spp", amount: D(500000), feeComponent: { label: "SPP" } };

function dbMock(over: Overrides = {}) {
  const has = <K extends keyof Overrides>(k: K) => Object.prototype.hasOwnProperty.call(over, k);
  return {
    student: {
      findFirst: vi.fn().mockResolvedValue(has("student") ? over.student : { id: "s-1", name: "Budi" }),
    },
    academicYear: { findFirst: vi.fn().mockResolvedValue(has("year") ? over.year : YEAR) },
    studentEnrollment: { findMany: vi.fn().mockResolvedValue(over.enrollments ?? [ENROLLMENT]) },
    programFeeStructure: { findMany: vi.fn().mockResolvedValue(over.fees ?? [SPP_FEE]) },
    studentFeeAdjustment: { findMany: vi.fn().mockResolvedValue(over.adjustments ?? []) },
    studentGuardian: { findFirst: vi.fn().mockResolvedValue({ parentId: "par-1" }) },
    // Two reads: the student's own invoices (where.studentId) and the tenant-wide distinct labels.
    invoice: {
      findMany: vi.fn(async (args: { where: { studentId?: string } }) =>
        args.where.studentId ? (over.invoices ?? []) : (over.labels ?? []),
      ),
    },
  };
}

const load = (db: ReturnType<typeof dbMock>, extra: { from?: string; to?: string } = {}) =>
  loadSppPrepayContext(db as never, { tenantId: "t-1", studentId: "s-1", ...extra });

async function loadOk(db: ReturnType<typeof dbMock>, extra: { from?: string; to?: string } = {}) {
  const ctx = await load(db, extra);
  if (!ctx.ok) throw new Error(`expected a context, got ${ctx.code}`);
  return ctx;
}

function invoiceRow(over: Record<string, unknown> = {}) {
  return {
    id: "i-1",
    periodLabel: "Oktober 2026",
    status: "SENT",
    totalDue: D(500000),
    totalPaid: D(0),
    xenditPaymentUrl: null,
    paymentLinkExpiresAt: null,
    lines: [{ feeComponent: { isRecurring: true } }],
    ...over,
  };
}

describe("loadSppPrepayContext", () => {
  it("scopes the student to the tenant and ACTIVE status; unknown student is a typed failure", async () => {
    const db = dbMock({ student: null });
    const res = await load(db);
    expect(res).toMatchObject({ ok: false, code: "STUDENT_NOT_FOUND" });
    expect(db.student.findFirst).toHaveBeenCalledWith({
      where: { id: "s-1", tenantId: "t-1", status: "ACTIVE" },
      select: { id: true, name: true },
    });
    expect(db.studentEnrollment.findMany).not.toHaveBeenCalled();
  });

  it("no ACTIVE academic year is a typed failure", async () => {
    const res = await load(dbMock({ year: null }));
    expect(res).toMatchObject({ ok: false, code: "NO_ACADEMIC_YEAR" });
  });

  it("defaults the range to the whole academic year (Juli to Juni)", async () => {
    const ctx = await loadOk(dbMock());
    expect(ctx.academicYear).toEqual({ id: "ay-1", name: "2026/2027", from: "2026-07", to: "2027-06" });
    expect(ctx.range).toEqual({ from: "2026-07", to: "2027-06" });
    expect(ctx.rangeYm).toEqual({ from: { year: 2026, month: 7 }, to: { year: 2027, month: 6 } });
    expect(ctx.program).toBe("TKIT");
    expect(ctx.parentId).toBe("par-1");
  });

  it("accepts a narrower range and refuses one that is reversed or leaves the year", async () => {
    const narrow = await loadOk(dbMock(), { from: "2026-10", to: "2026-12" });
    expect(narrow.range).toEqual({ from: "2026-10", to: "2026-12" });

    expect(await load(dbMock(), { from: "2026-12", to: "2026-10" })).toMatchObject({ ok: false, code: "RANGE_INVALID" });
    expect(await load(dbMock(), { from: "2026-06" })).toMatchObject({ ok: false, code: "RANGE_OUTSIDE_YEAR" });
    expect(await load(dbMock(), { to: "2027-07" })).toMatchObject({ ok: false, code: "RANGE_OUTSIDE_YEAR" });
  });

  it("no enrollment in the year => noProgram, no pricing, blocked NO_PROGRAM plan with no rows", async () => {
    const db = dbMock({ enrollments: [] });
    const ctx = await loadOk(db);
    expect(ctx.noProgram).toBe(true);
    expect(ctx.program).toBeNull();
    expect(ctx.priceFor({ year: 2026, month: 10 })).toBeNull();
    // Nothing else is read for a student who cannot be priced.
    expect(db.invoice.findMany).not.toHaveBeenCalled();

    const plan = planForContext(ctx);
    expect(plan.rows).toEqual([]);
    expect(plan.blocked).toBe(true);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]).toMatchObject({
      code: "NO_PROGRAM",
      blocking: true,
      message:
        "Siswa belum punya kelas di tahun ajaran ini, jadi SPP belum bisa dihitung. Daftarkan ke kelas lebih dulu.",
    });
  });

  it("reads enrollments only from classes of the active academic year, and only BILLABLE fees", async () => {
    const db = dbMock();
    await loadOk(db);
    expect(db.studentEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId: "s-1",
          status: "ACTIVE",
          student: { status: "ACTIVE" },
          classSection: { tenantId: "t-1", academicYearId: "ay-1" },
        },
      }),
    );
    expect(db.programFeeStructure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          programId: { in: ["p-1"] },
          academicYearId: "ay-1",
          feeComponent: { isEnabled: true, isRecurring: true },
        },
      }),
    );
    expect(db.studentFeeAdjustment.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t-1", studentId: "s-1", academicYearId: "ay-1", status: "ACTIVE" },
    });
  });

  describe("priceFor", () => {
    const waiver = {
      id: "adj-1",
      academicYearId: "ay-1",
      feeComponentId: "fc-spp",
      type: "DISCOUNT",
      mode: "FIXED",
      value: D(100000),
      reason: "Keringanan yatim",
      status: "ACTIVE",
      validFrom: "2026-10-01",
      validTo: "2026-12-31",
    };

    it("prices a month at the program SPP", async () => {
      const ctx = await loadOk(dbMock());
      const price = ctx.priceFor({ year: 2026, month: 8 });
      expect(price?.total.toString()).toBe("500000");
      expect(price?.lines).toHaveLength(1);
      expect(price?.lines[0]).toMatchObject({ feeComponentId: "fc-spp", labelSnapshot: "SPP" });
      expect(price?.lines[0].finalAmount.toString()).toBe("500000");
    });

    it("applies a waiver only in months whose due date is inside its validity window", async () => {
      const ctx = await loadOk(dbMock({ adjustments: [waiver] }));
      const totalOf = (year: number, month: number) => ctx.priceFor({ year, month })?.total.toString();
      expect(totalOf(2026, 9)).toBe("500000"); // due 2026-09-30, before validFrom
      expect(totalOf(2026, 10)).toBe("400000"); // due 2026-10-31, inside
      expect(totalOf(2026, 12)).toBe("400000"); // due 2026-12-31, validTo is inclusive
      expect(totalOf(2027, 1)).toBe("500000"); // due 2027-01-31, after validTo
      const oct = ctx.priceFor({ year: 2026, month: 10 });
      expect(oct?.lines[0]).toMatchObject({ adjustmentNote: "Keringanan yatim" });
      expect(oct?.lines[0].adjustmentAmount.toString()).toBe("-100000");
    });

    it("cannot price a program with no billable fee structure", async () => {
      const ctx = await loadOk(dbMock({ fees: [] }));
      expect(ctx.noProgram).toBe(false);
      expect(ctx.priceFor({ year: 2026, month: 10 })).toBeNull();
      expect(planForContext(ctx).issues.some((i) => i.code === "NO_PRICE" && i.blocking)).toBe(true);
    });

    it("treats a fully waived (Rp 0) month as not priceable", async () => {
      const full = { ...waiver, value: D(500000), validFrom: null, validTo: null };
      const ctx = await loadOk(dbMock({ adjustments: [full] }));
      expect(ctx.priceFor({ year: 2026, month: 10 })).toBeNull();
    });
  });

  describe("invoices and firstInvoicedMonth", () => {
    it("maps the student's invoices; hasMonthlyLine is true only with a recurring line", async () => {
      const ctx = await loadOk(
        dbMock({
          invoices: [
            invoiceRow({
              id: "i-1",
              xenditPaymentUrl: "https://pay.example/x",
              paymentLinkExpiresAt: new Date("2026-11-05T00:00:00Z"),
            }),
            invoiceRow({
              id: "i-2",
              periodLabel: "Biaya Sekolah Tahap 1 TA 2027/2028",
              lines: [{ feeComponent: { isRecurring: false } }, { feeComponent: { isRecurring: false } }],
            }),
            invoiceRow({ id: "i-3", periodLabel: "November 2026", lines: [] }),
          ],
        }),
      );
      expect(ctx.invoices.map((i) => [i.id, i.hasMonthlyLine, i.hasLink])).toEqual([
        ["i-1", true, true],
        ["i-2", false, false],
        ["i-3", false, false],
      ]);
      expect(ctx.invoices[0].paymentLinkExpiresAt).toEqual(new Date("2026-11-05T00:00:00Z"));
      expect(ctx.invoices[0].totalDue.toString()).toBe("500000");
    });

    it("reads the student's invoices ascending by id and the labels tenant-wide, non-cancelled, recurring, distinct", async () => {
      const db = dbMock();
      await loadOk(db);
      const calls = db.invoice.findMany.mock.calls.map((c) => c[0] as Record<string, unknown>);
      const own = calls.find((c) => (c.where as { studentId?: string }).studentId);
      const labels = calls.find((c) => !(c.where as { studentId?: string }).studentId);
      expect(own).toMatchObject({ where: { tenantId: "t-1", studentId: "s-1" }, orderBy: { id: "asc" } });
      expect(labels).toMatchObject({
        where: {
          tenantId: "t-1",
          status: { not: "CANCELLED" },
          lines: { some: { feeComponent: { isRecurring: true } } },
        },
        distinct: ["periodLabel"],
        select: { periodLabel: true },
      });
      expect(labels?.take).toEqual(expect.any(Number));
    });

    it("firstInvoicedMonth is the earliest parsable month; unreadable labels are ignored", async () => {
      const ctx = await loadOk(
        dbMock({
          labels: [
            { periodLabel: "November 2026" },
            { periodLabel: "Semester 1 2026/2027" },
            { periodLabel: "oktober 2026" },
            { periodLabel: "Desember 2026" },
          ],
        }),
      );
      expect(ctx.firstInvoicedMonth).toEqual({ year: 2026, month: 10 });
    });

    it("firstInvoicedMonth is null when the school never billed a month", async () => {
      const ctx = await loadOk(dbMock({ labels: [{ periodLabel: "Semester 1 2026/2027" }] }));
      expect(ctx.firstInvoicedMonth).toBeNull();
    });

    it("a loaded context plans end to end (settle, skip, create) and flags months before the first billing", async () => {
      const ctx = await loadOk(
        dbMock({
          invoices: [
            invoiceRow({ id: "i-okt", periodLabel: "Oktober 2026", status: "PAID", totalPaid: D(500000) }),
            invoiceRow({ id: "i-nov", periodLabel: "November 2026", xenditPaymentUrl: "https://pay.example/x" }),
          ],
          labels: [{ periodLabel: "Oktober 2026" }, { periodLabel: "November 2026" }],
        }),
      );
      const plan = planForContext(ctx);
      const byMonth = (m: number) => plan.rows.find((r) => r.year === 2026 && r.month === m);
      expect(byMonth(7)).toMatchObject({ action: "CREATE", beforeFirstBilling: true });
      expect(byMonth(10)).toMatchObject({ action: "SKIP_PAID", invoiceIds: ["i-okt"] });
      expect(byMonth(11)).toMatchObject({ action: "SETTLE", invoiceIds: ["i-nov"], hadLink: true });
      expect(plan.total.toString()).toBe(String(500000 * 11)); // 12 months minus the paid October
      expect(plan.blocked).toBe(false);
    });
  });
});

describe("fingerprintPlan", () => {
  const row = (over: Partial<PlanRow> = {}): PlanRow => ({
    year: 2026,
    month: 11,
    periodLabel: "November 2026",
    dueDate: "2026-11-30",
    action: "SETTLE",
    amount: D(500000),
    lines: [],
    invoiceIds: ["i-nov"],
    hadLink: true,
    linkExpiresAt: null,
    beforeFirstBilling: false,
    ...over,
  });
  const inv = (over: Partial<PlanInvoice> = {}) => ({ id: "i-nov", totalDue: D(500000), totalPaid: D(0), ...over });

  it("is a sha256 hex digest, stable for the same plan, and ignores invoice id order", () => {
    const a = fingerprintPlan({ rows: [row()] }, [inv()]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintPlan({ rows: [row()] }, [inv()])).toBe(a);

    const two = (ids: string[]) =>
      fingerprintPlan({ rows: [row({ invoiceIds: ids, amount: D(900000) })] }, [
        inv({ id: "i-a", totalDue: D(400000) }),
        inv({ id: "i-b", totalDue: D(500000) }),
      ]);
    expect(two(["i-a", "i-b"])).toBe(two(["i-b", "i-a"]));
  });

  it("changes when a balance changes", () => {
    const before = fingerprintPlan({ rows: [row()] }, [inv()]);
    const afterPartial = fingerprintPlan(
      { rows: [row({ amount: D(300000) })] },
      [inv({ totalPaid: D(200000) })],
    );
    expect(afterPartial).not.toBe(before);
  });

  it("changes when only the per-invoice split changes (same summed amount)", () => {
    const rows = [row({ invoiceIds: ["i-a", "i-b"], amount: D(500000) })];
    const split1 = fingerprintPlan({ rows }, [
      inv({ id: "i-a", totalDue: D(300000) }),
      inv({ id: "i-b", totalDue: D(200000) }),
    ]);
    const split2 = fingerprintPlan({ rows }, [
      inv({ id: "i-a", totalDue: D(200000) }),
      inv({ id: "i-b", totalDue: D(300000) }),
    ]);
    expect(split1).not.toBe(split2);
  });

  it("changes when the action or the amount of a month changes", () => {
    const settle = fingerprintPlan({ rows: [row()] }, [inv()]);
    const create = fingerprintPlan({ rows: [row({ action: "CREATE", invoiceIds: [] })] });
    const repriced = fingerprintPlan({ rows: [row({ action: "CREATE", invoiceIds: [], amount: D(450000) })] });
    expect(new Set([settle, create, repriced]).size).toBe(3);
  });

  it("is not affected by data a preview does not act on (link expiry, labels)", () => {
    const a = fingerprintPlan({ rows: [row()] }, [inv()]);
    const b = fingerprintPlan({ rows: [row({ linkExpiresAt: new Date(), periodLabel: "x" })] }, [inv()]);
    expect(b).toBe(a);
  });

  it("flips when a context's invoice is paid between two loads", async () => {
    const make = async (totalPaid: Prisma.Decimal): Promise<SppPrepayContext> =>
      loadOk(
        dbMock({
          invoices: [invoiceRow({ id: "i-nov", periodLabel: "November 2026", totalPaid })],
          labels: [{ periodLabel: "November 2026" }],
        }),
        { from: "2026-11", to: "2026-11" },
      );
    const ctxA = await make(D(0));
    const ctxA2 = await make(D(0));
    const ctxB = await make(D(100000));
    const fp = (c: SppPrepayContext) => fingerprintPlan(planForContext(c), c.invoices);
    expect(fp(ctxA)).toBe(fp(ctxA2));
    expect(fp(ctxB)).not.toBe(fp(ctxA));
  });
});
