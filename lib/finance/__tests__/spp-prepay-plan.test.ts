import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import type { ResolvedLine } from "../apply-adjustments";
import { planSppPrepay, type MonthPrice, type PlanInvoice, type YearMonth } from "../spp-prepay-plan";

const D = (v: string | number) => new Prisma.Decimal(v);

function inv(over: Partial<PlanInvoice> & { id: string; periodLabel: string }): PlanInvoice {
  return {
    status: "SENT",
    totalDue: D(500000),
    totalPaid: D(0),
    hasMonthlyLine: true,
    hasOtherLine: false,
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
