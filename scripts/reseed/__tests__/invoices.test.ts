import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  buildInvoicePeriods,
  computeInvoiceTotal,
  assertXenditReferencingSmokeRow,
  applyLinkExpiryFixtures,
} from "../invoices";

describe("buildInvoicePeriods", () => {
  const periods = buildInvoicePeriods();

  it("produces exactly 10 periods Jul-2025 → Apr-2026", () => {
    expect(periods).toHaveLength(10);
    expect(periods[0].label).toBe("Jul-2025");
    expect(periods[periods.length - 1].label).toBe("Apr-2026");
  });

  it("first 7 are HISTORICAL_PAID, last 3 are LIVE_XENDIT", () => {
    const live = periods.filter((p) => p.mode === "LIVE_XENDIT");
    const paid = periods.filter((p) => p.mode === "HISTORICAL_PAID");
    expect(paid).toHaveLength(7);
    expect(live).toHaveLength(3);
    expect(live.map((p) => p.label)).toEqual([
      "Feb-2026",
      "Mar-2026",
      "Apr-2026",
    ]);
  });

  it("dueDate is the 10th of each month", () => {
    for (const p of periods) {
      expect(p.dueDate.endsWith("-10")).toBe(true);
    }
  });
});

describe("Xendit referenceId format", () => {
  // The webhook handler at app/api/xendit/webhook/route.ts looks up the
  // invoice via `prisma.invoice.findUnique({ where: { id: data.reference_id } })`.
  // Any prefix (e.g. `staging-tagihan-`) breaks the lookup silently and the
  // webhook 200s with "Invoice not found".
  // Assert via static-source check that neither reseed entry point ever
  // sends a prefixed reference_id.
  it("scripts/reseed/invoices.ts never builds a prefixed referenceId", () => {
    const src = readFileSync(
      resolve(__dirname, "../invoices.ts"),
      "utf8",
    );
    // Block the historical prefix and any obvious reintroduction shape.
    expect(src).not.toMatch(/staging-tagihan/);
    expect(src).not.toMatch(/staging[-_]/);
    expect(src).not.toMatch(/referenceId:\s*['"`][^'"`]+['"`]\s*\+/); // no concat
    // Sanity: bare-id form is in the file.
    expect(src).toMatch(/referenceId:\s*inv\.id/);
  });

  it("scripts/finish-xendit.ts never builds a prefixed referenceId", () => {
    const src = readFileSync(
      resolve(__dirname, "../../finish-xendit.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/staging-tagihan/);
    expect(src).not.toMatch(/staging[-_]/);
    expect(src).not.toMatch(/referenceId:\s*['"`][^'"`]+['"`]\s*\+/);
    expect(src).toMatch(/referenceId:\s*inv\.id/);
  });
});

describe("assertXenditReferencingSmokeRow", () => {
  it("throws when no Xendit-linked invoice exists (full rate-limit scenario)", () => {
    expect(() => assertXenditReferencingSmokeRow(null)).toThrow(
      /zero invoices with xenditPaymentUrl/,
    );
  });

  it("throws when invoice id is prefixed (regression guard)", () => {
    expect(() =>
      assertXenditReferencingSmokeRow({
        id: "staging-tagihan-cm9abc12345678901234",
        xenditPaymentUrl: "https://dev.xen.to/aa",
      }),
    ).toThrow(/not a bare CUID/);
  });

  it("throws when invoice id is empty string", () => {
    expect(() =>
      assertXenditReferencingSmokeRow({
        id: "",
        xenditPaymentUrl: "https://dev.xen.to/aa",
      }),
    ).toThrow(/not a bare CUID/);
  });

  it("throws when xenditPaymentUrl is null despite passing query filter (defense)", () => {
    expect(() =>
      assertXenditReferencingSmokeRow({
        id: "cm9abc1234567890abcde",
        xenditPaymentUrl: null,
      }),
    ).toThrow(/null xenditPaymentUrl/);
  });

  it("passes for valid CUID + non-null URL", () => {
    expect(() =>
      assertXenditReferencingSmokeRow({
        id: "cm9abc1234567890abcde",
        xenditPaymentUrl: "https://dev.xen.to/aa",
      }),
    ).not.toThrow();
  });
});

describe("computeInvoiceTotal", () => {
  it("matches the cycle-doc fee table", () => {
    expect(computeInvoiceTotal("DCARE")).toBe(1_700_000);
    expect(computeInvoiceTotal("KB")).toBe(800_000);
    expect(computeInvoiceTotal("TKIT-A")).toBe(975_000);
    expect(computeInvoiceTotal("TKIT-B")).toBe(1_025_000);
  });
});

describe("applyLinkExpiryFixtures", () => {
  const now = new Date("2026-10-20T03:00:00Z");
  const row = (n: number) => ({
    id: `inv${n}`,
    invoiceNumber: `INV-2026-${String(n).padStart(4, "0")}`,
    totalDue: 800_000,
    createdBy: "u1",
  });

  function fakePrisma(liveCount: number, paid: { id: string; invoiceNumber: string } | null) {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      invoice: {
        findMany: vi.fn().mockResolvedValue(Array.from({ length: liveCount }, (_, i) => row(i + 1))),
        findFirst: vi.fn().mockResolvedValue(paid),
        update,
      },
      webhookEvent: { upsert: vi.fn().mockResolvedValue({}) },
      payment: { create: vi.fn().mockResolvedValue({}) },
    };
    return { prisma, update };
  }

  it("builds every fixture role relative to now", async () => {
    const { prisma, update } = fakePrisma(9, { id: "p1", invoiceNumber: "INV-2025-0001" });
    const picked = await applyLinkExpiryFixtures(prisma as never, "t1", now);
    expect(Object.keys(picked).sort()).toEqual([
      "earlyExpiredNoLink", "expiredEvent", "future", "noDate", "overdueLink", "overdueNoLink",
      "paidStaleLink", "partialLink", "partialNoLink", "past",
    ]);
    const dataFor = (id: string) => update.mock.calls.filter((c) => c[0].where.id === id).map((c) => c[0].data);
    expect(dataFor("inv2")[0].paymentLinkExpiresAt.getTime()).toBeLessThan(now.getTime());
    expect(dataFor("inv3")[0].paymentLinkExpiresAt).toBeNull();
    expect(dataFor("inv4")[0].paymentLinkExpiresAt.getTime()).toBeGreaterThan(now.getTime());
    const early = dataFor("inv5")[0];
    expect(early).toMatchObject({ xenditPaymentUrl: null, xenditSessionId: null, paymentLinkExpiresAt: null });
    expect(early.dueDate > "2026-10-20").toBe(true);
    // paid invoice: past date, never cleared
    expect(dataFor("p1")[0].paymentLinkExpiresAt.getTime()).toBeLessThan(now.getTime());
    expect(prisma.webhookEvent.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.payment.create).toHaveBeenCalledTimes(2);
  });

  it("copes with fewer live invoices than roles and no paid invoice", async () => {
    const { prisma } = fakePrisma(2, null);
    const picked = await applyLinkExpiryFixtures(prisma as never, "t1", now);
    expect(Object.keys(picked).sort()).toEqual(["future", "past"]);
  });
});
