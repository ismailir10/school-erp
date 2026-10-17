import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GatewayApiError } from "../types";

const { state, xendit, doku, processor } = vi.hoisted(() => ({
  state: { row: {} as Record<string, unknown> },
  xendit: { id: "xendit", createSession: vi.fn(), fetchPaymentStatus: vi.fn() },
  doku: { id: "doku", createSession: vi.fn(), fetchPaymentStatus: vi.fn() },
  processor: vi.fn(),
}));

vi.mock("../xendit/client", async (original) => ({
  ...await original<typeof import("../xendit/client")>(), xenditGateway: xendit,
}));
vi.mock("../doku/client", async (original) => ({
  ...await original<typeof import("../doku/client")>(), dokuGateway: doku,
}));
vi.mock("../webhook-processor", () => ({ processPaymentEvent: processor }));
vi.mock("@/lib/auth", () => ({ getSession: async () => ({ id: "u1", tenantId: "t1", role: "GUARDIAN", parentId: "p1" }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ success: true }) }));
vi.mock("@/lib/db", () => ({
  prisma: {
    parent: { findFirst: async () => ({ guardians: [{ studentId: "s1" }] }) },
    invoice: {
      findUnique: async () => ({ ...state.row }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(where)) return { count: 0 };
        Object.assign(state.row, data);
        return { count: 1 };
      },
    },
  },
}));

function matches(where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Record<string, unknown>[]).some(matches);
    const value = state.row[key];
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (condition && typeof condition === "object") {
      const c = condition as Record<string, unknown>;
      if ("lt" in c) return value instanceof Date && value < (c.lt as Date);
      if ("lte" in c) return value instanceof Date && value <= (c.lte as Date);
      if ("notIn" in c) return !(c.notIn as unknown[]).includes(value);
    }
    return value === condition;
  });
}

import { getGateway } from "../registry";
import { paymentLinkProvider } from "../link-provider";
import { POST } from "@/app/api/guardian/invoices/[id]/payment-link/route";

const pending = { state: "PENDING", rawStatus: "ACTIVE", paymentId: null, amount: null, currency: "IDR", channelCode: null, raw: {} };
const ask = () => POST(new NextRequest("https://school.test/api/guardian/invoices/inv1/payment-link", { method: "POST" }), { params: Promise.resolve({ id: "inv1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PAYMENT_GATEWAY", "doku");
  vi.stubEnv("DEMO_MODE", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.row = {
    id: "inv1", tenantId: "t1", studentId: "s1", status: "OVERDUE", invoiceNumber: "INV-1",
    totalDue: 850000, totalPaid: 0, periodLabel: "April", dueDate: "2026-04-10",
    xenditSessionId: "62efe4c33e45294d63f585f2", xenditPaymentUrl: "https://dev.xen.to/old",
    paymentCheckedAt: null, student: { name: "Siswa", guardians: [] }, lines: [],
  };
  xendit.fetchPaymentStatus.mockResolvedValue({ ...pending });
  doku.fetchPaymentStatus.mockResolvedValue({ ...pending });
  doku.createSession.mockResolvedValue({ id: "new-doku", paymentUrl: "https://sandbox.doku.com/checkout/link/new", status: "PENDING", expiresAt: new Date().toISOString() });
  processor.mockImplementation(async (event) => {
    if (event.kind === "SESSION_EXPIRED") {
      Object.assign(state.row, { xenditSessionId: null, xenditPaymentUrl: null });
      return { httpStatus: 200, body: { status: "LINK_CLEARED" } };
    }
    state.row.status = "PAID";
    return { httpStatus: 200, body: { status: "PAID" } };
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("stored provider survives an active-gateway switch", () => {
  it("checks a live legacy Xendit link at Xendit and preserves it", async () => {
    expect(await (await ask()).json()).toEqual({ paymentUrl: "https://dev.xen.to/old", created: false });
    expect(xendit.fetchPaymentStatus).toHaveBeenCalledWith({ invoiceId: "inv1", sessionId: "62efe4c33e45294d63f585f2" });
    expect(doku.fetchPaymentStatus).not.toHaveBeenCalled();
    expect(doku.createSession).not.toHaveBeenCalled();
    expect(getGateway().id).toBe("doku");
  });

  it("replaces an expired legacy link through DOKU even when the pre-check and claim share a millisecond", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T00:00:00Z"));
    xendit.fetchPaymentStatus.mockResolvedValue({ ...pending, state: "EXPIRED", rawStatus: "EXPIRED" });
    expect(await (await ask()).json()).toEqual({ paymentUrl: "https://sandbox.doku.com/checkout/link/new", created: true });
    expect(processor).toHaveBeenCalledWith(expect.objectContaining({ provider: "xendit", kind: "SESSION_EXPIRED", expectedPaymentUrl: "https://dev.xen.to/old" }));
    expect(doku.createSession).toHaveBeenCalledTimes(1);
    expect(xendit.createSession).not.toHaveBeenCalled();
  });

  it("an already paid legacy checkout is credited instead of replaced", async () => {
    xendit.fetchPaymentStatus.mockResolvedValue({ ...pending, state: "COMPLETED", rawStatus: "PAID", paymentId: "legacy-paid", amount: 850000 });
    expect((await ask()).status).toBe(409);
    expect(processor).toHaveBeenCalledWith(expect.objectContaining({ kind: "PAYMENT_COMPLETED", paymentId: "legacy-paid" }));
    expect(doku.createSession).not.toHaveBeenCalled();
  });

  it.each(["UNAVAILABLE", "401", "network"])("a %s result preserves the genuine link and returns an honest error, including the throttled retry", async (reason) => {
    if (reason === "UNAVAILABLE") xendit.fetchPaymentStatus.mockResolvedValue({ ...pending, state: "UNAVAILABLE", rawStatus: null });
    else xendit.fetchPaymentStatus.mockRejectedValue(new GatewayApiError({ status: reason === "401" ? 401 : null, code: reason as "401" | "network", retriable: reason === "network", message: "Unavailable" }));
    expect((await ask()).status).toBe(502);
    expect((await ask()).status).toBe(502);
    expect(state.row.xenditPaymentUrl).toBe("https://dev.xen.to/old");
    expect(xendit.fetchPaymentStatus).toHaveBeenCalledTimes(1);
    expect(doku.createSession).not.toHaveBeenCalled();
    expect(processor).not.toHaveBeenCalled();
  });
});

describe("synthetic links", () => {
  it.each(["xendit", "doku"])("retires the exact demo.%s.local placeholder outside DEMO_MODE", async (provider) => {
    state.row.xenditPaymentUrl = `https://demo.${provider}.local/checkout/inv1`;
    state.row.xenditSessionId = "demo_session_inv1";
    expect(await (await ask()).json()).toMatchObject({ created: true });
    expect(processor).toHaveBeenCalledWith(expect.objectContaining({ kind: "SESSION_EXPIRED", sessionId: "demo_session_inv1", expectedPaymentUrl: `https://demo.${provider}.local/checkout/inv1` }));
    expect(xendit.fetchPaymentStatus).not.toHaveBeenCalled();
    expect(doku.fetchPaymentStatus).not.toHaveBeenCalled();
    expect(doku.createSession).toHaveBeenCalledTimes(1);
  });

  it("preserves the synthetic link in DEMO_MODE", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    state.row.xenditPaymentUrl = "https://demo.xendit.local/checkout/inv1";
    expect(await (await ask()).json()).toMatchObject({ created: false });
    expect(processor).not.toHaveBeenCalled();
    expect(doku.createSession).not.toHaveBeenCalled();
  });

  it.each([
    "https://dev.xen.to.attacker.test/x", "https://demo.xendit.local.attacker.test/x",
    "https://demo.xendit.local@attacker.test/x", "https://attacker.test@dev.xen.to/x",
    "http://demo.xendit.local/x", "https://demo.xendit.local:8443/x", "not-a-url",
  ])("never trusts an unrelated checkout URL: %s", async (url) => {
    state.row.xenditPaymentUrl = url;
    expect(paymentLinkProvider(url)).toBeNull();
    expect((await ask()).status).toBe(502);
    expect(state.row.xenditPaymentUrl).toBe(url);
    expect(processor).not.toHaveBeenCalled();
    expect(doku.fetchPaymentStatus).not.toHaveBeenCalled();
    expect(xendit.fetchPaymentStatus).not.toHaveBeenCalled();
  });
});
