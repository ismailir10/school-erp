/**
 * Validation coverage for `POST /api/invoices/[id]/payments` — the route now
 * parses through `recordPaymentSchema` (payments-module-hardening audit,
 * 2026-07-27). Previously the hand-rolled check let any `method` string
 * persist verbatim into Payment.method (plain String column, no DB enum).
 * Lock/overpayment behavior is covered by the route's advisory-lock design
 * shared with xendit-webhook tests; this file covers the validation boundary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  invoice: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ success: true, remaining: 19 }) }));
vi.mock("@/lib/generated/prisma/client", () => ({
  Prisma: {
    Decimal: class {
      private v: string;
      constructor(x: unknown) {
        this.v = String(x);
      }
      toString() {
        return this.v;
      }
    },
    PrismaClientKnownRequestError: class extends Error {},
  },
}));

import { POST } from "../invoices/[id]/payments/route";
import { getSession } from "@/lib/auth";

const ADMIN = {
  id: "u1",
  email: "a@t.local",
  name: "Admin",
  role: "SCHOOL_ADMIN",
  tenantId: "t-1",
  employeeId: null,
  parentId: null,
  permissions: ["payments.record"] as string[],
  customRoleCode: null,
};

const ctx = { params: Promise.resolve({ id: "inv-1" }) };

function makeReq(body: unknown) {
  return new Request("http://localhost/api/invoices/inv-1/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(ADMIN as never);
});

describe("POST /api/invoices/[id]/payments — validation boundary", () => {
  it("400 for an unknown payment method (regression: persisted verbatim before)", async () => {
    const res = await POST(
      makeReq({ amount: 100_000, method: "GOPAY_MANUAL" }) as never,
      ctx,
    );
    expect(res.status).toBe(400);
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("400 for negative amount", async () => {
    const res = await POST(makeReq({ amount: -5000, method: "CASH" }) as never, ctx);
    expect(res.status).toBe(400);
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("400 for malformed JSON body", async () => {
    const res = await POST(makeReq("not-json{{") as never, ctx);
    expect(res.status).toBe(400);
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("accepts amount as a string — the dialog posts payForm verbatim (regression)", async () => {
    db.invoice.findFirst.mockResolvedValue(null); // stop at pre-check; validation is the target
    const res = await POST(
      makeReq({ amount: "50000", method: "CASH", reference: "", notes: "" }) as never,
      ctx,
    );
    expect(res.status).toBe(404); // past validation, failed pre-check as mocked
    expect(db.invoice.findFirst).toHaveBeenCalled();
  });

  it("400 for empty-string amount", async () => {
    const res = await POST(
      makeReq({ amount: "", method: "CASH", reference: "", notes: "" }) as never,
      ctx,
    );
    expect(res.status).toBe(400);
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("method defaults to CASH and valid body reaches the tenant pre-check", async () => {
    db.invoice.findFirst.mockResolvedValue(null); // cross-tenant/missing → 404
    const res = await POST(makeReq({ amount: 100_000 }) as never, ctx);
    expect(res.status).toBe(404);
    expect(db.invoice.findFirst).toHaveBeenCalledWith({
      where: { id: "inv-1", tenantId: "t-1" },
      select: { id: true },
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("403 for guardian role", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...ADMIN, role: "GUARDIAN" } as never);
    const res = await POST(makeReq({ amount: 100_000, method: "CASH" }) as never, ctx);
    expect(res.status).toBe(403);
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
  });
});
