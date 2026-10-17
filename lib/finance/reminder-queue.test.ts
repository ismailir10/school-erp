import { describe, it, expect } from "vitest";
import { buildReminderQueue, compareReminderQueue, invoiceRemaining, toReminderRow, type ReminderInvoice } from "./reminder-queue";

function inv(over: Partial<ReminderInvoice> & { phone?: string | null } = {}): ReminderInvoice {
  const { phone = "0812-1111-2222", ...rest } = over;
  return {
    id: "i1",
    invoiceNumber: "INV-2026-0001",
    periodLabel: "Oktober 2026",
    dueDate: "2026-10-10",
    status: "SENT",
    totalDue: "500000",
    totalPaid: "100000",
    xenditPaymentUrl: "https://checkout.doku.com/x",
    lastRemindedAt: null,
    lastRemindedBy: null,
    remindCount: 0,
    student: { name: "Aisyah", guardians: [{ parent: { name: "Budi", whatsapp: phone, phone: null } }] },
    ...rest,
  };
}

describe("invoiceRemaining", () => {
  it("is due minus paid, from Decimal-ish values", () => {
    expect(invoiceRemaining({ totalDue: "500000.00", totalPaid: "125000.50" })).toBe(374999.5);
  });
});

describe("compareReminderQueue", () => {
  it("puts never-reminded first, then oldest reminder, then oldest due date, then number", () => {
    const list = [
      inv({ id: "recent", lastRemindedAt: new Date("2026-10-16"), dueDate: "2026-09-01" }),
      inv({ id: "old", lastRemindedAt: new Date("2026-10-01"), dueDate: "2026-10-20" }),
      inv({ id: "never-late", dueDate: "2026-10-15", invoiceNumber: "INV-B" }),
      inv({ id: "never-early-b", dueDate: "2026-10-05", invoiceNumber: "INV-B" }),
      inv({ id: "never-early-a", dueDate: "2026-10-05", invoiceNumber: "INV-A" }),
    ];
    expect(list.sort(compareReminderQueue).map((i) => i.id)).toEqual([
      "never-early-a",
      "never-early-b",
      "never-late",
      "old",
      "recent",
    ]);
  });
});

describe("buildReminderQueue", () => {
  it("counts owed invoices with no guardian or no usable number instead of listing them", () => {
    const { queue, excludedNoNumber } = buildReminderQueue([
      inv({ id: "ok" }),
      inv({ id: "no-number", phone: "-" }),
      inv({ id: "no-guardian", student: { name: "X", guardians: [] } }),
    ]);
    expect(queue.map((c) => c.invoice.id)).toEqual(["ok"]);
    expect(excludedNoNumber).toBe(2);
  });

  it("skips invoices with nothing left to pay without counting them as excluded", () => {
    const { queue, excludedNoNumber } = buildReminderQueue([inv({ totalPaid: "500000" }), inv({ totalPaid: "600000" })]);
    expect(queue).toEqual([]);
    expect(excludedNoNumber).toBe(0);
  });
});

describe("toReminderRow", () => {
  const candidate = (i: ReminderInvoice) => buildReminderQueue([i]).queue[0];

  it("carries the link in the wa.me message when the invoice has one", () => {
    const row = toReminderRow(candidate(inv()), null);
    expect(row).toMatchObject({ hasLink: true, remaining: 400000, totalDue: 500000, totalPaid: 100000, guardianName: "Budi" });
    expect(decodeURIComponent(row.waUrl ?? "")).toContain("https://checkout.doku.com/x");
  });

  it("has no waUrl without a link", () => {
    const row = toReminderRow(candidate(inv({ xenditPaymentUrl: null })), null);
    expect(row.hasLink).toBe(false);
    expect(row.waUrl).toBeNull();
  });

  it("serialises the last reminder", () => {
    const row = toReminderRow(candidate(inv({ lastRemindedAt: new Date("2026-10-16T01:00:00Z"), remindCount: 2 })), "Siti");
    expect(row).toMatchObject({ lastRemindedAt: "2026-10-16T01:00:00.000Z", lastRemindedByName: "Siti", remindCount: 2 });
  });
});
