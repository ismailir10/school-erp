import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  },
}));

vi.mock("@/lib/payments/registry", () => ({
  getGateway: vi.fn(),
}));

/**
 * The gateway charges `totalDue − totalPaid`, so the line items must sum to
 * that. A partly paid invoice goes out as one "Sisa tagihan" line; a never-paid
 * one keeps its real lines.
 */

const lines = [
  { labelSnapshot: "SPP Oktober", finalAmount: 200000 },
  { labelSnapshot: "Seragam", finalAmount: 50000 },
];

async function itemsFor(totalPaid: number) {
  const { getGateway } = await import("@/lib/payments/registry");
  const { prisma } = await import("@/lib/db");

  const createSession = vi.fn().mockResolvedValue({
    id: "sess-1",
    paymentUrl: "https://checkout.example.test/abc",
    status: "PENDING",
    expiresAt: "2026-11-10T16:59:59Z",
  });
  vi.mocked(getGateway).mockReturnValue({
    id: "doku",
    createSession,
    ping: vi.fn(),
    fetchPaymentStatus: vi.fn(),
  });
  vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
    id: "inv-1",
    tenantId: "tnt-1",
    status: totalPaid > 0 ? "PARTIAL" : "SENT",
    totalDue: 250000,
    totalPaid,
    invoiceNumber: "INV-2026-0042",
    periodLabel: "Okt 2026",
    dueDate: "2026-11-10",
    student: { name: "Aisy", guardians: [] },
    lines,
  } as never);

  const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
  await createPaymentSessionForInvoice("inv-1", "tnt-1");

  return createSession.mock.calls[0][0] as {
    amount: number;
    items: { name: string; quantity: number; price: number }[];
  };
}

describe("createPaymentSessionForInvoice — line items match the charge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://talib.annisaasekolahku.com";
  });

  it("sends one 'Sisa tagihan' line for a partly paid invoice, equal to the amount", async () => {
    const params = await itemsFor(100000);

    expect(params.amount).toBe(150000);
    expect(params.items).toEqual([{ name: "Sisa tagihan INV-2026-0042", quantity: 1, price: 150000 }]);
    expect(params.items.reduce((sum, i) => sum + i.price * i.quantity, 0)).toBe(params.amount);
  });

  it("keeps the real lines for an invoice with nothing paid", async () => {
    const params = await itemsFor(0);

    expect(params.amount).toBe(250000);
    expect(params.items).toEqual([
      { name: "SPP Oktober", quantity: 1, price: 200000 },
      { name: "Seragam", quantity: 1, price: 50000 },
    ]);
  });
});
