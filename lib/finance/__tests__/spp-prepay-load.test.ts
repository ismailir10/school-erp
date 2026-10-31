import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  fingerprintPlan,
  loadSppPrepayContext,
  planForContext,
  sppAvailability,
  type SppPrepayContext,
} from "../spp-prepay-load";
import type { OtherFeesPlan, PlanInvoice, PlanRow } from "../spp-prepay-plan";

const D = (v: string | number) => new Prisma.Decimal(v);

type Overrides = {
  student?: unknown;
  year?: unknown;
  enrollments?: unknown[];
  adjustments?: unknown[];
  invoices?: unknown[];
  labels?: unknown[];
  fees?: unknown[];
  bundles?: unknown[];
  components?: unknown[];
  oneTimeFees?: unknown[];
};

const YEAR = { id: "ay-1", name: "2026/2027", startDate: "2026-07-01", endDate: "2027-06-30" };

const ENROLLMENT = {
  id: "enr-1",
  studentId: "s-1",
  classSectionId: "cs-1",
  student: { id: "s-1", name: "Budi" },
  classSection: { name: "TKIT A", programId: "p-1", program: { name: "TKIT" } },
};

const SPP_FEE = { programId: "p-1", feeComponentId: "fc-spp", amount: D(500000), feeComponent: { label: "SPP" } };

// Whole academic year, the SPP part chosen.
const FULL = { from: "2026-07", to: "2027-06" };

const UANG_PANGKAL = { id: "fc-pangkal", label: "Uang Pangkal", sortOrder: 1 };
const SARANA = { id: "fc-sarana", label: "Sarana", sortOrder: 2 };

function dbMock(over: Overrides = {}) {
  const has = <K extends keyof Overrides>(k: K) => Object.prototype.hasOwnProperty.call(over, k);
  return {
    student: {
      findFirst: vi.fn().mockResolvedValue(has("student") ? over.student : { id: "s-1", name: "Budi" }),
    },
    academicYear: { findFirst: vi.fn().mockResolvedValue(has("year") ? over.year : YEAR) },
    studentEnrollment: { findMany: vi.fn().mockResolvedValue(over.enrollments ?? [ENROLLMENT]) },
    // Prepay is deliberately leave-unaware: the loader must never read this.
    enrollmentLeave: {
      findMany: vi.fn().mockResolvedValue([{ enrollmentId: "enr-1", startMonth: "2026-07", endMonth: "2027-06" }]),
    },
    // Two reads: the billable (recurring) fee table for pricing, and the one-time table for the prefill.
    programFeeStructure: {
      findMany: vi.fn(async (args: { where: { feeComponent?: { isRecurring?: boolean } } }) =>
        args.where.feeComponent?.isRecurring === false ? (over.oneTimeFees ?? []) : (over.fees ?? [SPP_FEE]),
      ),
    },
    feeComponentDef: { findMany: vi.fn().mockResolvedValue(over.components ?? []) },
    programBundleFee: { findMany: vi.fn().mockResolvedValue(over.bundles ?? []) },
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
    invoiceNumber: "INV-2026-0001",
    periodLabel: "Oktober 2026",
    status: "SENT",
    totalDue: D(500000),
    totalPaid: D(0),
    xenditPaymentUrl: null,
    paymentLinkExpiresAt: null,
    lines: [{ feeComponentId: "fc-spp", finalAmount: D(500000), feeComponent: { isRecurring: true } }],
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

  it("no ACTIVE academic year only makes SPP unavailable: no year, no pricing, one-time components still load", async () => {
    const db = dbMock({ year: null, components: [UANG_PANGKAL] });
    const ctx = await loadOk(db, FULL);
    expect(ctx.academicYear).toBeNull();
    expect(ctx.sppChosen).toBe(true);
    expect(ctx.range).toBeNull();
    expect(ctx.defaultRange).toBeNull();
    expect(ctx.noProgram).toBe(true);
    expect(ctx.oneTimeComponents).toEqual([{ ...UANG_PANGKAL, prefillAmount: null }]);
    expect(db.studentEnrollment.findMany).not.toHaveBeenCalled();
    expect(sppAvailability(ctx)).toMatchObject({ available: false, reason: { code: "NO_ACADEMIC_YEAR" } });
    // Chosen but unavailable: one blocking issue and no rows.
    const plan = planForContext(ctx);
    expect(plan.rows).toEqual([]);
    expect(plan.issues).toEqual([expect.objectContaining({ code: "NO_ACADEMIC_YEAR", blocking: true })]);
    // Not chosen: nothing to block.
    expect(planForContext(await loadOk(dbMock({ year: null }))).blocked).toBe(false);
  });

  it("the SPP part is chosen only by giving a range; the academic year's own range is offered as the default", async () => {
    const ctx = await loadOk(dbMock());
    expect(ctx.sppChosen).toBe(false);
    expect(ctx.range).toBeNull();
    expect(ctx.rangeYm).toBeNull();
    expect(ctx.defaultRange).toEqual({ from: "2026-07", to: "2027-06" });
    expect(ctx.academicYear).toEqual({ id: "ay-1", name: "2026/2027", from: "2026-07", to: "2027-06" });
    expect(planForContext(ctx)).toMatchObject({ rows: [], issues: [], blocked: false });
    expect(sppAvailability(ctx)).toEqual({
      available: true,
      reason: null,
      defaultRange: { from: "2026-07", to: "2027-06" },
    });
  });

  it("a range covering the academic year (Juli to Juni) plans twelve months", async () => {
    const ctx = await loadOk(dbMock(), FULL);
    expect(ctx.sppChosen).toBe(true);
    expect(ctx.range).toEqual({ from: "2026-07", to: "2027-06" });
    expect(ctx.rangeYm).toEqual({ from: { year: 2026, month: 7 }, to: { year: 2027, month: 6 } });
    expect(ctx.program).toBe("TKIT");
    expect(ctx.parentId).toBe("par-1");
  });

  it("a year that touches 13 calendar months bills only its own 12 (Juli to Juni)", async () => {
    // 13 Juli to 11 Juli: the second Juli belongs to the next year, so it is neither the default
    // nor allowed (a Juli 2027 invoice at this year's price would make next year's run skip it).
    const year = { id: "ay-1", name: "2026/2027", startDate: "2026-07-13", endDate: "2027-07-11" };
    const ctx = await loadOk(dbMock({ year }), FULL);
    expect(ctx.academicYear).toMatchObject({ from: "2026-07", to: "2027-06" });
    expect(ctx.defaultRange).toEqual({ from: "2026-07", to: "2027-06" });
    expect(ctx.range).toEqual({ from: "2026-07", to: "2027-06" });
    const outside = await load(dbMock({ year }), { from: "2026-08", to: "2027-07" });
    expect(outside).toMatchObject({ ok: false, code: "RANGE_OUTSIDE_YEAR" });
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
    // Nothing is read for pricing a student who cannot be priced: no fee table, no first-billed labels.
    expect(db.studentFeeAdjustment.findMany).not.toHaveBeenCalled();
    expect(db.invoice.findMany).toHaveBeenCalledTimes(1); // only the student's own invoices (the one-time caution)

    const plan = planForContext(await loadOk(db, FULL));
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

  it("is leave-unaware: an active leave neither blocks pricing nor changes the plan, and leaves are never read", async () => {
    const db = dbMock();
    const ctx = await loadOk(db, FULL);
    expect(db.enrollmentLeave.findMany).not.toHaveBeenCalled();
    // The October month is covered by the stubbed leave and is still priced at the full fee.
    expect(ctx.priceFor({ year: 2026, month: 10 })?.total.toString()).toBe("500000");
    const plan = planForContext(ctx);
    expect(plan.blocked).toBe(false);
    expect(plan.issues.some((i) => i.code === "NO_PRICE")).toBe(false);
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
      const ctx = await loadOk(dbMock({ fees: [] }), FULL);
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

  describe("harga paket sekolah + daycare", () => {
    const DC_ENROLLMENT = {
      id: "enr-2",
      studentId: "s-1",
      classSectionId: "cs-2",
      student: { id: "s-1", name: "Budi" },
      classSection: { name: "Daycare", programId: "p-2", program: { name: "D'Care" } },
    };
    const DC_FEE = { programId: "p-2", feeComponentId: "fc-spp", amount: D(1100000), feeComponent: { label: "SPP" } };
    const BUNDLE = { schoolProgramId: "p-1", daycareProgramId: "p-2", feeComponentId: "fc-spp", amount: D(1560000) };
    const both = (over: Overrides = {}) =>
      dbMock({ enrollments: [ENROLLMENT, DC_ENROLLMENT], fees: [SPP_FEE, DC_FEE], ...over });

    it("reads the active bundles of the year for the student's programs and prices the pair with them", async () => {
      const db = both({ bundles: [BUNDLE] });
      const ctx = await loadOk(db);
      expect(db.programBundleFee.findMany).toHaveBeenCalledTimes(1);
      const where = db.programBundleFee.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ tenantId: "t-1", academicYearId: "ay-1", status: "ACTIVE" });
      expect(where.schoolProgramId.in.sort()).toEqual(["p-1", "p-2"]);
      const price = ctx.priceFor({ year: 2026, month: 10 });
      expect(price?.total.toString()).toBe("1560000");
      expect(price?.lines).toHaveLength(1);
      expect(price?.lines[0].labelSnapshot).toBe("SPP (D'Care + TKIT)");
    });

    it("prices the sum without a bundle", async () => {
      const ctx = await loadOk(both());
      expect(ctx.priceFor({ year: 2026, month: 10 })?.total.toString()).toBe("1600000");
    });

    it("applies a percent waiver to the bundle amount", async () => {
      const pct = {
        id: "adj-p",
        academicYearId: "ay-1",
        feeComponentId: "fc-spp",
        type: "DISCOUNT",
        mode: "PERCENT",
        value: D(10),
        reason: "Saudara",
        status: "ACTIVE",
        validFrom: null,
        validTo: null,
      };
      const ctx = await loadOk(both({ bundles: [BUNDLE], adjustments: [pct] }));
      expect(ctx.priceFor({ year: 2026, month: 10 })?.total.toString()).toBe("1404000");
    });

    it("makes no bundle query for a student with one program, and stays leave-unaware with two", async () => {
      const single = dbMock();
      await loadOk(single);
      expect(single.programBundleFee.findMany).not.toHaveBeenCalled();
      const db = both({ bundles: [BUNDLE] });
      await loadOk(db);
      expect(db.enrollmentLeave.findMany).not.toHaveBeenCalled();
    });
  });

  describe("one-time components and prefill (cycle 2026-10-30-prepay-other-fees)", () => {
    it("lists the tenant's enabled, ACTIVE, non-recurring components in display order", async () => {
      const db = dbMock({ components: [UANG_PANGKAL, SARANA] });
      const ctx = await loadOk(db);
      expect(db.feeComponentDef.findMany).toHaveBeenCalledWith({
        where: { tenantId: "t-1", isEnabled: true, isRecurring: false, status: "ACTIVE" },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        select: { id: true, label: true, sortOrder: true },
      });
      expect(ctx.oneTimeComponents.map((c) => c.id)).toEqual(["fc-pangkal", "fc-sarana"]);
    });

    it("prefills each component from the student's program fee table for the resolved year", async () => {
      const db = dbMock({
        components: [UANG_PANGKAL, SARANA],
        oneTimeFees: [{ programId: "p-1", feeComponentId: "fc-pangkal", amount: D(5000000) }],
      });
      const ctx = await loadOk(db);
      expect(ctx.oneTimeComponents).toEqual([
        { ...UANG_PANGKAL, prefillAmount: 5000000 },
        { ...SARANA, prefillAmount: null }, // no fee-table row for this program: the admin types it
      ]);
      expect(db.programFeeStructure.findMany).toHaveBeenCalledWith({
        where: {
          programId: { in: ["p-1"] },
          academicYearId: "ay-1",
          status: "ACTIVE",
          feeComponent: { tenantId: "t-1", isEnabled: true, isRecurring: false, status: "ACTIVE" },
        },
        select: { feeComponentId: true, amount: true },
      });
    });

    it("a student in two programs is prefilled with the sum, as the Billing Run bills each program", async () => {
      const ctx = await loadOk(
        dbMock({
          enrollments: [
            ENROLLMENT,
            { ...ENROLLMENT, id: "enr-2", classSectionId: "cs-2", classSection: { name: "Daycare", programId: "p-2", program: { name: "D'Care" } } },
          ],
          components: [UANG_PANGKAL],
          oneTimeFees: [
            { programId: "p-1", feeComponentId: "fc-pangkal", amount: D(5000000) },
            { programId: "p-2", feeComponentId: "fc-pangkal", amount: D(1000000) },
          ],
        }),
      );
      expect(ctx.oneTimeComponents[0].prefillAmount).toBe(6000000);
    });

    it("a student with no program gets the components with no prefill and no fee table is read", async () => {
      const db = dbMock({
        enrollments: [],
        components: [UANG_PANGKAL],
        oneTimeFees: [{ programId: "p-1", feeComponentId: "fc-pangkal", amount: D(5000000) }],
      });
      const ctx = await loadOk(db);
      expect(ctx.noProgram).toBe(true);
      expect(ctx.oneTimeComponents).toEqual([{ ...UANG_PANGKAL, prefillAmount: null }]);
      expect(db.programFeeStructure.findMany).not.toHaveBeenCalled();
      expect(sppAvailability(ctx)).toMatchObject({ available: false, reason: { code: "NO_PROGRAM" } });
    });

    it("loads the student's invoices even when SPP cannot be priced (the caution needs them)", async () => {
      const ctx = await loadOk(
        dbMock({
          enrollments: [],
          components: [UANG_PANGKAL],
          invoices: [
            invoiceRow({
              id: "i-pangkal",
              periodLabel: "Uang Pangkal",
              lines: [{ feeComponentId: "fc-pangkal", finalAmount: D(500000), feeComponent: { isRecurring: false } }],
            }),
          ],
        }),
      );
      expect(ctx.invoices.map((i) => i.id)).toEqual(["i-pangkal"]);
      const plan = planForContext(ctx, { label: "Biaya Sekolah Tahap 1 TA 2027/2028", lines: [{ feeComponentId: "fc-pangkal", amount: 1000000 }] });
      expect(plan.blocked).toBe(false);
      expect(plan.issues).toEqual([expect.objectContaining({ code: "UNPAID_SAME_COMPONENT", blocking: false, invoiceId: "i-pangkal" })]);
    });

    it("plans one-time lines with SPP not chosen: grand total is the one-time total, no SPP rows", async () => {
      const ctx = await loadOk(dbMock({ components: [UANG_PANGKAL, SARANA] }));
      const plan = planForContext(ctx, {
        label: "Biaya Sekolah Tahap 1 TA 2027/2028",
        lines: [
          { feeComponentId: "fc-pangkal", amount: 5000000 },
          { feeComponentId: "fc-sarana", amount: 1500000 },
        ],
      });
      expect(plan.rows).toEqual([]);
      expect(plan.sppTotal.toString()).toBe("0");
      expect(plan.otherFees?.total.toString()).toBe("6500000");
      expect(plan.total.toString()).toBe("6500000");
    });

    it("grand total adds the SPP months and the one-time invoice", async () => {
      const ctx = await loadOk(dbMock({ components: [UANG_PANGKAL] }), { from: "2026-10", to: "2026-11" });
      const plan = planForContext(ctx, { label: "Seragam TA 2026/2027", lines: [{ feeComponentId: "fc-pangkal", amount: 250000 }] });
      expect(plan.sppTotal.toString()).toBe("1000000");
      expect(plan.total.toString()).toBe("1250000");
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
              lines: [
                { feeComponentId: "fc-pangkal", finalAmount: D(1000000), feeComponent: { isRecurring: false } },
                { feeComponentId: "fc-sarana", finalAmount: D(250000), feeComponent: { isRecurring: false } },
              ],
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
      expect(ctx.invoices.map((i) => i.feeComponentIds)).toEqual([["fc-spp"], ["fc-pangkal", "fc-sarana"], []]);
      expect(ctx.invoices[0].paymentLinkExpiresAt).toEqual(new Date("2026-11-05T00:00:00Z"));
      expect(ctx.invoices[0].totalDue.toString()).toBe("500000");
      expect(ctx.invoices[0].invoiceNumber).toBe("INV-2026-0001");
    });

    it("monthlyAmount sums only the recurring lines of a mixed invoice", async () => {
      const ctx = await loadOk(
        dbMock({
          invoices: [
            invoiceRow({
              id: "i-mix",
              lines: [
                { feeComponentId: "fc-spp", finalAmount: D(1650000), feeComponent: { isRecurring: true } },
                { feeComponentId: "fc-seragam", finalAmount: D(1350000), feeComponent: { isRecurring: false } },
              ],
            }),
            invoiceRow({
              id: "i-one",
              lines: [{ feeComponentId: "fc-seragam", finalAmount: D(900000), feeComponent: { isRecurring: false } }],
            }),
            invoiceRow({ id: "i-none", lines: [] }),
          ],
        }),
      );
      expect(ctx.invoices.map((i) => [i.id, i.monthlyAmount.toString()])).toEqual([
        ["i-mix", "1650000"],
        ["i-one", "0"],
        ["i-none", "0"],
      ]);
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
        FULL,
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

  it("flips when a payment link appears or is replaced between preview and confirm", () => {
    const base = fingerprintPlan({ rows: [row()] }, [inv()]);
    const linked = fingerprintPlan({ rows: [row()] }, [
      { ...inv(), hasLink: true, paymentLinkExpiresAt: new Date("2026-11-01T02:00:00Z") },
    ]);
    const replaced = fingerprintPlan({ rows: [row()] }, [
      { ...inv(), hasLink: true, paymentLinkExpiresAt: new Date("2026-11-08T02:00:00Z") },
    ]);
    expect(new Set([base, linked, replaced]).size).toBe(3);
  });

  it("includes the one-time payload: another label, component or amount is a different plan", () => {
    const other = (over: Partial<OtherFeesPlan> = {}): OtherFeesPlan => ({
      label: "Biaya Sekolah Tahap 1 TA 2027/2028",
      lines: [
        { feeComponentId: "fc-a", label: "A", amount: D(1000000) },
        { feeComponentId: "fc-b", label: "B", amount: D(500000) },
      ],
      total: D(1500000),
      ...over,
    });
    const fp = (o: OtherFeesPlan | null) => fingerprintPlan({ rows: [], otherFees: o });
    const base = fp(other());
    expect(fp(other())).toBe(base);
    // Line order does not matter; the label, a component and an amount do.
    expect(fp(other({ lines: [...other().lines].reverse() }))).toBe(base);
    expect(fp(other({ label: "Biaya Sekolah Tahap 2 TA 2027/2028" }))).not.toBe(base);
    expect(fp(other({ lines: [other().lines[0], { feeComponentId: "fc-c", label: "C", amount: D(500000) }] }))).not.toBe(base);
    expect(fp(other({ lines: [{ ...other().lines[0], amount: D(900000) }, other().lines[1]] }))).not.toBe(base);
    expect(fp(null)).not.toBe(base);
  });

  it("is unchanged for an SPP-only plan (no one-time part)", () => {
    expect(fingerprintPlan({ rows: [row()], otherFees: null }, [inv()])).toBe(fingerprintPlan({ rows: [row()] }, [inv()]));
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
