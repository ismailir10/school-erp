import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import type { ResolvedLine } from "../apply-adjustments";
import {
  INVALID_COMPONENT_MESSAGE,
  planOtherFees,
  planSppPrepay,
  type MonthPrice,
  type PlanInvoice,
  type YearMonth,
} from "../spp-prepay-plan";

const D = (v: string | number) => new Prisma.Decimal(v);

function inv(over: Partial<PlanInvoice> & { id: string; periodLabel: string }): PlanInvoice {
  return {
    invoiceNumber: `INV-${over.id}`,
    status: "SENT",
    totalDue: D(500000),
    totalPaid: D(0),
    monthlyAmount: D(500000),
    hasMonthlyLine: true,
    hasOtherLine: false,
    feeComponentIds: [],
    hasLink: false,
    paymentLinkExpiresAt: null,
    ...over,
  };
}

function priceOf(amount: string | number): MonthPrice {
  const a = D(amount);
  const line: ResolvedLine = {
    feeComponentId: "fc-spp",
    labelSnapshot: "SPP",
    amount: a,
    adjustmentAmount: D(0),
    adjustmentNote: null,
    finalAmount: a,
  };
  return { lines: [line], total: a };
}

const flat = (amount: string | number) => () => priceOf(amount);
const julJun = { from: { year: 2026, month: 7 }, to: { year: 2027, month: 6 } };

describe("planSppPrepay", () => {
  it("plans a full academic year with create / settle / skip months", () => {
    const priceFor = vi.fn(flat(500000));
    const plan = planSppPrepay({
      range: julJun,
      invoices: [
        inv({ id: "i-okt", periodLabel: "Oktober 2026", totalPaid: D(500000), status: "PAID" }),
        inv({ id: "i-nov", periodLabel: "November 2026", hasLink: true }),
      ],
      priceFor,
      firstInvoicedMonth: { year: 2026, month: 10 },
    });

    expect(plan.rows).toHaveLength(12);
    expect(plan.rows.map((r) => r.periodLabel)).toEqual([
      "Juli 2026", "Agustus 2026", "September 2026", "Oktober 2026", "November 2026", "Desember 2026",
      "Januari 2027", "Februari 2027", "Maret 2027", "April 2027", "Mei 2027", "Juni 2027",
    ]);
    const byAction = (a: string) => plan.rows.filter((r) => r.action === a).length;
    expect(byAction("SKIP_PAID")).toBe(1);
    expect(byAction("SETTLE")).toBe(1);
    expect(byAction("CREATE")).toBe(10);
    expect(plan.rows[3]).toMatchObject({ action: "SKIP_PAID", invoiceIds: ["i-okt"], amount: D(0) });
    expect(plan.rows[4]).toMatchObject({ action: "SETTLE", invoiceIds: ["i-nov"], hadLink: true });
    expect(plan.rows[0]).toMatchObject({ action: "CREATE", dueDate: "2026-07-31", invoiceIds: [], hadLink: false });
    expect(plan.rows[0].lines).toHaveLength(1);
    expect(plan.rows[7].dueDate).toBe("2027-02-28");
    // 10 created + 1 settled, the paid October adds nothing
    expect(plan.total.equals(D(5500000))).toBe(true);
    expect(plan.blocked).toBe(false);
    expect(plan.issues).toEqual([]);
    // priceFor is called once per CREATE month only
    expect(priceFor).toHaveBeenCalledTimes(10);
  });

  it("treats a month whose only SPP invoice is cancelled as CREATE", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 10 } },
      invoices: [inv({ id: "c1", periodLabel: "Oktober 2026", status: "CANCELLED" })],
      priceFor: flat(500000),
      firstInvoicedMonth: null,
    });
    expect(plan.rows[0]).toMatchObject({ action: "CREATE", invoiceIds: [] });
    expect(plan.issues).toEqual([]);
  });

  it("does not count a non-SPP invoice wearing the month label", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 10 } },
      invoices: [
        inv({ id: "bundle", periodLabel: "Oktober 2026", hasMonthlyLine: false, totalPaid: D(500000), status: "PAID" }),
      ],
      priceFor: flat(500000),
      firstInvoicedMonth: null,
    });
    expect(plan.rows[0].action).toBe("CREATE");
    expect(plan.issues).toEqual([]);
  });

  it("settles only the remaining balance of a partly paid invoice", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 10 } },
      invoices: [inv({ id: "p1", periodLabel: "Okt 2026", status: "PARTIALLY_PAID", totalDue: D(484000), totalPaid: D(200000) })],
      priceFor: flat(500000),
      firstInvoicedMonth: null,
    });
    expect(plan.rows[0].action).toBe("SETTLE");
    expect(plan.rows[0].amount.equals(D(284000))).toBe(true);
    expect(plan.total.equals(D(284000))).toBe(true);
  });

  it("settles every unpaid invoice of a month and warns", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 10 } },
      invoices: [
        inv({ id: "a", periodLabel: "Oktober 2026", totalDue: D(300000) }),
        inv({ id: "b", periodLabel: "oktober 2026", totalDue: D(200000), totalPaid: D(50000) }),
        inv({ id: "c", periodLabel: "Oktober 2026", status: "PAID", totalPaid: D(500000) }),
      ],
      priceFor: flat(500000),
      firstInvoicedMonth: null,
    });
    expect(plan.rows[0]).toMatchObject({ action: "SETTLE", invoiceIds: ["a", "b"] });
    expect(plan.rows[0].amount.equals(D(450000))).toBe(true);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]).toMatchObject({ code: "MULTIPLE_MONTHLY_INVOICES", blocking: false, year: 2026, month: 10 });
    expect(plan.blocked).toBe(false);
  });

  it("skips a month whose invoices are all paid, listing the paid ids", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 10 } },
      invoices: [inv({ id: "p", periodLabel: "Oktober 2026", status: "PAID", totalPaid: D(500000) })],
      priceFor: flat(500000),
      firstInvoicedMonth: null,
    });
    expect(plan.rows[0]).toMatchObject({ action: "SKIP_PAID", invoiceIds: ["p"], lines: [] });
    expect(plan.total.equals(D(0))).toBe(true);
  });

  it("warns about an SPP invoice whose label names no single month, paid or not", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 10 } },
      invoices: [
        inv({ id: "sem", periodLabel: "Semester 1 2026/2027" }),
        inv({ id: "sem-paid", periodLabel: "Okt - Des 2026", status: "PAID", totalPaid: D(500000) }),
        inv({ id: "sem-cancelled", periodLabel: "Semester 2", status: "CANCELLED" }),
        inv({ id: "no-spp", periodLabel: "Biaya Sekolah Tahap 1", hasMonthlyLine: false }),
      ],
      priceFor: flat(500000),
      firstInvoicedMonth: null,
    });
    // A paid yearly invoice matters most: without the warning the family is prepaid twice.
    expect(plan.issues.map((i) => i.invoiceId).sort()).toEqual(["sem", "sem-paid"]);
    for (const issue of plan.issues) expect(issue).toMatchObject({ code: "UNPARSABLE_LABEL", blocking: false });
    expect(plan.issues.find((i) => i.invoiceId === "sem-paid")?.message).toMatch(/lunas/i);
    expect(plan.rows[0].action).toBe("CREATE");
    expect(plan.blocked).toBe(false);
  });

  it("warns when settling an invoice that also carries one-time fees", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 11 } },
      invoices: [
        inv({ id: "okt", periodLabel: "Oktober 2026", totalDue: D(1500000), hasOtherLine: true }),
        inv({ id: "nov", periodLabel: "November 2026" }),
      ],
      priceFor: flat(500000),
      firstInvoicedMonth: null,
    });
    const warn = plan.issues.filter((i) => i.code === "SETTLES_OTHER_LINES");
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ blocking: false, invoiceId: "okt", year: 2026, month: 10 });
    expect(warn[0].message).toMatch(/sekali bayar/);
    expect(plan.rows.map((r) => r.action)).toEqual(["SETTLE", "SETTLE"]);
    expect(plan.blocked).toBe(false);
  });

  it("hands the owing and the fully paid unreadable-label cautions the invoice they point at", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 10 } },
      invoices: [
        inv({
          id: "sem",
          invoiceNumber: "INV-2026-0100",
          periodLabel: "Semester 1 2026/2027",
          totalDue: D(3000000),
          monthlyAmount: D(1650000),
        }),
        inv({
          id: "spmb",
          invoiceNumber: "INV-2026-0123",
          periodLabel: "SPMB Tahap 1",
          status: "PAID",
          totalDue: D(3000000),
          totalPaid: D(3000000),
          monthlyAmount: D(1650000),
        }),
      ],
      priceFor: flat(500000),
      firstInvoicedMonth: null,
    });
    expect(plan.issues.find((i) => i.invoiceId === "sem")?.invoice).toEqual({
      id: "sem",
      invoiceNumber: "INV-2026-0100",
      periodLabel: "Semester 1 2026/2027",
      status: "SENT",
      totalDue: 3000000,
      monthlyAmount: 1650000,
    });
    expect(plan.issues.find((i) => i.invoiceId === "spmb")?.invoice).toEqual({
      id: "spmb",
      invoiceNumber: "INV-2026-0123",
      periodLabel: "SPMB Tahap 1",
      status: "PAID",
      totalDue: 3000000,
      monthlyAmount: 1650000,
    });
  });

  it("hands the one-time-fees caution its invoice, and leaves other cautions without one", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 12 } },
      invoices: [
        inv({
          id: "okt",
          invoiceNumber: "INV-2026-0200",
          periodLabel: "Oktober 2026",
          totalDue: D(1500000),
          monthlyAmount: D(500000),
          hasOtherLine: true,
        }),
        inv({ id: "dup-1", periodLabel: "November 2026" }),
        inv({ id: "dup-2", periodLabel: "November 2026" }),
      ],
      priceFor: (ym) => (ym.month === 12 ? null : priceOf(500000)),
      firstInvoicedMonth: null,
    });
    const other = plan.issues.find((i) => i.code === "SETTLES_OTHER_LINES");
    expect(other?.invoice).toEqual({
      id: "okt",
      invoiceNumber: "INV-2026-0200",
      periodLabel: "Oktober 2026",
      status: "SENT",
      totalDue: 1500000,
      monthlyAmount: 500000,
    });
    const codes = plan.issues.map((i) => i.code).sort();
    expect(codes).toEqual(["MULTIPLE_MONTHLY_INVOICES", "NO_PRICE", "SETTLES_OTHER_LINES"]);
    for (const issue of plan.issues) {
      if (issue.code !== "SETTLES_OTHER_LINES") expect(issue.invoice).toBeUndefined();
    }
    expect(plan.issues.find((i) => i.code === "RANGE_INVALID")).toBeUndefined();
  });

  it("gives RANGE_INVALID no invoice either", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 12 }, to: { year: 2026, month: 10 } },
      invoices: [],
      priceFor: flat(500000),
      firstInvoicedMonth: null,
    });
    expect(plan.issues[0].code).toBe("RANGE_INVALID");
    expect(plan.issues[0].invoice).toBeUndefined();
  });

  it("blocks with NO_PRICE when a created month cannot be priced", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 11 } },
      invoices: [inv({ id: "okt", periodLabel: "Oktober 2026" })],
      priceFor: () => null,
      firstInvoicedMonth: null,
    });
    expect(plan.blocked).toBe(true);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]).toMatchObject({ code: "NO_PRICE", blocking: true, year: 2026, month: 11 });
    expect(plan.rows[1]).toMatchObject({ action: "CREATE", lines: [] });
    expect(plan.rows[1].amount.equals(D(0))).toBe(true);
    // the settle month is still planned
    expect(plan.rows[0].action).toBe("SETTLE");
  });

  it("prices each month with its own year-month", () => {
    const seen: YearMonth[] = [];
    planSppPrepay({
      range: { from: { year: 2026, month: 12 }, to: { year: 2027, month: 2 } },
      invoices: [],
      priceFor: (ym) => {
        seen.push(ym);
        return priceOf(ym.month === 1 ? 450000 : 500000);
      },
      firstInvoicedMonth: null,
    });
    expect(seen).toEqual([
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
    ]);
  });

  it("blocks a range longer than 12 months", () => {
    const priceFor = vi.fn(flat(500000));
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 7 }, to: { year: 2027, month: 7 } },
      invoices: [],
      priceFor,
      firstInvoicedMonth: null,
    });
    expect(plan.rows).toEqual([]);
    expect(plan.blocked).toBe(true);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]).toMatchObject({ code: "RANGE_INVALID", blocking: true });
    expect(plan.total.equals(D(0))).toBe(true);
    expect(priceFor).not.toHaveBeenCalled();
  });

  it("allows exactly 12 months and blocks a reversed range", () => {
    const ok = planSppPrepay({ range: julJun, invoices: [], priceFor: flat(1), firstInvoicedMonth: null });
    expect(ok.rows).toHaveLength(12);
    const reversed = planSppPrepay({
      range: { from: { year: 2027, month: 6 }, to: { year: 2026, month: 7 } },
      invoices: [],
      priceFor: flat(1),
      firstInvoicedMonth: null,
    });
    expect(reversed.rows).toEqual([]);
    expect(reversed.blocked).toBe(true);
    expect(reversed.issues[0].code).toBe("RANGE_INVALID");
  });

  it("flags months earlier than the first invoiced month", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 7 }, to: { year: 2026, month: 11 } },
      invoices: [],
      priceFor: flat(500000),
      firstInvoicedMonth: { year: 2026, month: 10 },
    });
    expect(plan.rows.map((r) => r.beforeFirstBilling)).toEqual([true, true, true, false, false]);

    const none = planSppPrepay({
      range: { from: { year: 2026, month: 7 }, to: { year: 2026, month: 8 } },
      invoices: [],
      priceFor: flat(500000),
      firstInvoicedMonth: null,
    });
    expect(none.rows.every((r) => !r.beforeFirstBilling)).toBe(true);
  });

  it("propagates hadLink and the latest link expiry on SETTLE rows", () => {
    const early = new Date("2026-11-05T10:00:00Z");
    const late = new Date("2026-11-20T10:00:00Z");
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 12 } },
      invoices: [
        inv({ id: "a", periodLabel: "Oktober 2026", hasLink: true, paymentLinkExpiresAt: early }),
        inv({ id: "b", periodLabel: "Oktober 2026", hasLink: true, paymentLinkExpiresAt: late }),
        inv({ id: "c", periodLabel: "Oktober 2026" }),
        inv({ id: "d", periodLabel: "November 2026", hasLink: true, paymentLinkExpiresAt: null }),
        inv({ id: "e", periodLabel: "Desember 2026" }),
      ],
      priceFor: flat(500000),
      firstInvoicedMonth: null,
    });
    expect(plan.rows[0].hadLink).toBe(true);
    expect(plan.rows[0].linkExpiresAt).toEqual(late);
    expect(plan.rows[1].hadLink).toBe(true);
    expect(plan.rows[1].linkExpiresAt).toBeNull();
    expect(plan.rows[2].hadLink).toBe(false);
    expect(plan.rows[2].linkExpiresAt).toBeNull();
  });

  it("sums with Decimal arithmetic and no float drift", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 12 } },
      invoices: [inv({ id: "nov", periodLabel: "November 2026", totalDue: D("499000.10"), totalPaid: D("0.00") })],
      priceFor: (ym) => (ym.month === 10 ? priceOf("484000") : priceOf("499000.20")),
      firstInvoicedMonth: null,
    });
    expect(plan.rows.map((r) => r.amount.toString())).toEqual(["484000", "499000.1", "499000.2"]);
    // 0.1 + 0.2 style drift would break this with JS numbers
    expect(plan.total.toString()).toBe("1482000.3");
    expect(plan.total).toBeInstanceOf(Prisma.Decimal);
  });

  it("adds 484000 and 499000 exactly", () => {
    const plan = planSppPrepay({
      range: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 11 } },
      invoices: [],
      priceFor: (ym) => (ym.month === 10 ? priceOf(484000) : priceOf(499000)),
      firstInvoicedMonth: null,
    });
    expect(plan.total.equals(D(983000))).toBe(true);
  });
});

describe("planOtherFees (cycle 2026-10-30-prepay-other-fees)", () => {
  const components = [
    { id: "fc-pangkal", label: "Uang Pangkal" },
    { id: "fc-sarana", label: "Sarana" },
  ];
  const input = {
    label: "Biaya Sekolah Tahap 1 TA 2027/2028",
    lines: [
      { feeComponentId: "fc-pangkal", amount: 5000000 },
      { feeComponentId: "fc-sarana", amount: 1500000 },
    ],
  };
  const unpaidPangkal = (over: Partial<PlanInvoice> = {}) =>
    inv({
      id: "i-pangkal",
      periodLabel: "Uang Pangkal",
      invoiceNumber: "INV-2026-0042",
      hasMonthlyLine: false,
      hasOtherLine: true,
      monthlyAmount: D(0),
      totalDue: D(5000000),
      feeComponentIds: ["fc-pangkal"],
      ...over,
    });

  it("no input is no plan and no issues (the SPP-only request)", () => {
    expect(planOtherFees({ input: null, components, invoices: [unpaidPangkal()] })).toEqual({ plan: null, issues: [] });
    expect(planOtherFees({ input: undefined, components, invoices: [] })).toEqual({ plan: null, issues: [] });
  });

  it("plans the lines with the component's own label and an exact Decimal total", () => {
    const { plan, issues } = planOtherFees({ input, components, invoices: [] });
    expect(issues).toEqual([]);
    expect(plan?.label).toBe("Biaya Sekolah Tahap 1 TA 2027/2028");
    expect(plan?.lines.map((l) => [l.feeComponentId, l.label, l.amount.toString()])).toEqual([
      ["fc-pangkal", "Uang Pangkal", "5000000"],
      ["fc-sarana", "Sarana", "1500000"],
    ]);
    expect(plan?.total).toBeInstanceOf(Prisma.Decimal);
    expect(plan?.total.toString()).toBe("6500000");
  });

  it("a component that is not in the tenant's enabled one-time list blocks the whole part", () => {
    const { plan, issues } = planOtherFees({
      input: { ...input, lines: [...input.lines, { feeComponentId: "fc-foreign-or-spp", amount: 1000 }] },
      components,
      invoices: [],
    });
    expect(plan).toBeNull();
    expect(issues).toEqual([{ code: "INVALID_COMPONENT", blocking: true, message: INVALID_COMPONENT_MESSAGE }]);
  });

  describe("caution for an unpaid invoice that already carries a chosen component (D7)", () => {
    it("names the invoice, is non-blocking, and points to Catat Pembayaran", () => {
      const { issues } = planOtherFees({ input, components, invoices: [unpaidPangkal({ status: "SENT" })] });
      expect(issues).toEqual([
        {
          code: "UNPAID_SAME_COMPONENT",
          blocking: false,
          message:
            "Siswa ini sudah punya tagihan belum lunas yang memuat Uang Pangkal. Jika wali membayar tagihan itu, gunakan Catat Pembayaran di tagihan tersebut.",
          invoiceId: "i-pangkal",
          invoice: {
            id: "i-pangkal",
            invoiceNumber: "INV-2026-0042",
            periodLabel: "Uang Pangkal",
            status: "SENT",
            totalDue: 5000000,
            monthlyAmount: 0,
          },
        },
      ]);
    });

    it.each(["DRAFT", "SENT", "PARTIALLY_PAID", "OVERDUE", "PENDING_PAYMENT_LINK"])("applies to a %s invoice", (status) => {
      const { issues } = planOtherFees({ input, components, invoices: [unpaidPangkal({ status })] });
      expect(issues.map((i) => i.code)).toEqual(["UNPAID_SAME_COMPONENT"]);
    });

    it.each(["PAID", "CANCELLED"])("ignores a %s invoice", (status) => {
      expect(planOtherFees({ input, components, invoices: [unpaidPangkal({ status })] }).issues).toEqual([]);
    });

    it("ignores an unpaid invoice that carries only other components (e.g. this month's SPP)", () => {
      const spp = inv({ id: "i-spp", periodLabel: "Oktober 2026", feeComponentIds: ["fc-spp"] });
      expect(planOtherFees({ input, components, invoices: [spp] }).issues).toEqual([]);
    });

    it("gives one caution per invoice, listing each matched component once, and one per invoice", () => {
      const both = unpaidPangkal({ id: "i-both", feeComponentIds: ["fc-pangkal", "fc-sarana", "fc-pangkal", "fc-spp"] });
      const sarana = unpaidPangkal({ id: "i-sarana", feeComponentIds: ["fc-sarana"] });
      const { issues } = planOtherFees({ input, components, invoices: [both, sarana] });
      expect(issues.map((i) => i.invoiceId)).toEqual(["i-both", "i-sarana"]);
      expect(issues[0].message).toContain("memuat Uang Pangkal, Sarana.");
      expect(issues[1].message).toContain("memuat Sarana.");
      expect(issues.every((i) => !i.blocking)).toBe(true);
    });

    it("a caution never makes the plan null: confirm stays possible", () => {
      const { plan } = planOtherFees({ input, components, invoices: [unpaidPangkal()] });
      expect(plan?.total.toString()).toBe("6500000");
    });
  });
});
