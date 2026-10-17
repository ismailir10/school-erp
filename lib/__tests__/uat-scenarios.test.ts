import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/xendit/helpers", () => ({
  createXenditSessionForInvoice: vi.fn(),
}));

import { getScenario, listScenarioKeys, uatScenarios } from "../uat/scenarios";
import { createXenditSessionForInvoice } from "@/lib/xendit/helpers";

const mockCreateSession = vi.mocked(createXenditSessionForInvoice);

function fakePrisma(candidates: { id: string; invoiceNumber: string }[]) {
  return {
    invoice: {
      findMany: vi.fn().mockResolvedValue(candidates),
    },
  } as unknown as Parameters<typeof uatScenarios["parent-payment"]["prep"]>[0]["prisma"];
}

describe("uat scenarios registry", () => {
  it("exposes parent-payment scenario", () => {
    expect(getScenario("parent-payment")).toBeDefined();
    expect(listScenarioKeys()).toContain("parent-payment");
  });

  it("returns undefined for unknown scenario", () => {
    expect(getScenario("does-not-exist")).toBeUndefined();
  });
});

describe("parent-payment scenario", () => {
  beforeEach(() => {
    mockCreateSession.mockReset();
  });

  it("skips work when no candidates need a payment link", async () => {
    const scenario = getScenario("parent-payment")!;
    const result = await scenario.prep({ tenantId: "t1", prisma: fakePrisma([]) });
    expect(result.ok).toBe(true);
    expect(result.actions[0]).toMatch(/nothing to do/);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("creates a Xendit session for each candidate", async () => {
    mockCreateSession.mockResolvedValue({ paymentUrl: "https://checkout.xendit.co/x", created: true });
    const scenario = getScenario("parent-payment")!;
    const prisma = fakePrisma([
      { id: "i1", invoiceNumber: "INV-2026-0001" },
      { id: "i2", invoiceNumber: "INV-2026-0002" },
    ]);
    const result = await scenario.prep({ tenantId: "t1", prisma });
    expect(result.ok).toBe(true);
    expect(mockCreateSession).toHaveBeenCalledTimes(2);
    expect(result.actions[0]).toMatch(/2 candidate invoice\(s\): 2 Xendit links created, 0 failed/);
  });

  it("is idempotent: second run sees no candidates and does nothing", async () => {
    mockCreateSession.mockResolvedValue({ paymentUrl: "https://checkout.xendit.co/x", created: true });
    const scenario = getScenario("parent-payment")!;

    // First run: 1 candidate
    const firstResult = await scenario.prep({
      tenantId: "t1",
      prisma: fakePrisma([{ id: "i1", invoiceNumber: "INV-2026-0001" }]),
    });
    expect(firstResult.actions[0]).toMatch(/1 Xendit links created/);

    // Second run: findMany returns [] because the URL is no longer null
    const secondResult = await scenario.prep({
      tenantId: "t1",
      prisma: fakePrisma([]),
    });
    expect(secondResult.actions[0]).toMatch(/nothing to do/);
  });

  it("reports per-invoice failures without aborting the run", async () => {
    mockCreateSession
      .mockResolvedValueOnce({ paymentUrl: "https://ok", created: true })
      .mockRejectedValueOnce(new Error("Xendit 500"))
      .mockResolvedValueOnce(null);
    const scenario = getScenario("parent-payment")!;
    const prisma = fakePrisma([
      { id: "i1", invoiceNumber: "INV-2026-0001" },
      { id: "i2", invoiceNumber: "INV-2026-0002" },
      { id: "i3", invoiceNumber: "INV-2026-0003" },
    ]);
    const result = await scenario.prep({ tenantId: "t1", prisma });
    expect(result.ok).toBe(true);
    expect(result.actions[0]).toMatch(/1 Xendit links created, 2 failed/);
    expect(result.actions.some((a) => a.includes("INV-2026-0002") && a.includes("Xendit 500"))).toBe(true);
    expect(result.actions.some((a) => a.includes("INV-2026-0003"))).toBe(true);
  });
});
