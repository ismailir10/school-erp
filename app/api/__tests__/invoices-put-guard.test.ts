/**
 * FINX-3 — `PUT /api/invoices/[id]` only moves DRAFT -> SENT. Any other target
 * status is rejected with 409 before a write, so status can't drift from the
 * payment ledger (e.g. CANCELLED/PAID on a partially paid invoice).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { invoice: { findUnique, update } },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

function session(role: "SUPER_ADMIN" | "SCHOOL_ADMIN" = "SUPER_ADMIN") {
  return {
    id: "u-1",
    email: "admin@test.com",
    name: "Admin",
    role,
    tenantId: "tnt-1",
    employeeId: null,
    parentId: null,
    permissions: [] as string[],
    customRoleCode: null,
  };
}

function putReq(body: unknown) {
  return new Request("http://localhost/api/invoices/inv-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callPut(body: unknown) {
  const { PUT } = await import("../invoices/[id]/route");
  return PUT(putReq(body) as never, { params: Promise.resolve({ id: "inv-1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PUT /api/invoices/[id] status guard (FINX-3)", () => {
  beforeEach(async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(session());
  });

  it.each([
    ["CANCELLED", "Gunakan Batalkan tagihan untuk membatalkan tagihan."],
    ["PAID", "Status lunas mengikuti pembayaran yang dicatat. Gunakan Catat Pembayaran."],
    ["PARTIALLY_PAID", "Status lunas mengikuti pembayaran yang dicatat. Gunakan Catat Pembayaran."],
    ["DRAFT", "Status tagihan tidak bisa diubah langsung."],
    ["OVERDUE", "Status tagihan tidak bisa diubah langsung."],
    ["PENDING_PAYMENT_LINK", "Status tagihan tidak bisa diubah langsung."],
  ])("%s on a partially paid invoice -> 409, no write", async (status, message) => {
    findUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "tnt-1",
      status: "PARTIALLY_PAID",
      sentAt: new Date("2026-10-01"),
    });

    const res = await callPut({ status });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: message });
    expect(update).not.toHaveBeenCalled();
  });

  it("also blocks SCHOOL_ADMIN", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue({ ...session("SCHOOL_ADMIN"), permissions: ["invoices.create"] });
    findUnique.mockResolvedValueOnce({ id: "inv-1", tenantId: "tnt-1", status: "SENT", sentAt: null });

    const res = await callPut({ status: "CANCELLED" });

    expect(res.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("DRAFT -> SENT still succeeds", async () => {
    findUnique.mockResolvedValueOnce({ id: "inv-1", tenantId: "tnt-1", status: "DRAFT", sentAt: null });
    update.mockResolvedValueOnce({ id: "inv-1", status: "SENT" });

    const res = await callPut({ status: "SENT" });

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv-1" },
        data: expect.objectContaining({ status: "SENT", sentAt: expect.any(Date) }),
      }),
    );
  });

  it("SENT -> SENT is idempotent (200)", async () => {
    findUnique.mockResolvedValueOnce({ id: "inv-1", tenantId: "tnt-1", status: "SENT", sentAt: new Date("2026-10-01") });
    update.mockResolvedValueOnce({ id: "inv-1", status: "SENT" });

    const res = await callPut({ status: "SENT" });

    expect(res.status).toBe(200);
  });

  it("SENT on a PAID invoice keeps the existing 409", async () => {
    findUnique.mockResolvedValueOnce({ id: "inv-1", tenantId: "tnt-1", status: "PAID", sentAt: null });

    const res = await callPut({ status: "SENT" });

    expect(res.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("404 for another tenant's invoice, no write", async () => {
    findUnique.mockResolvedValueOnce({ id: "inv-1", tenantId: "tnt-other", status: "DRAFT", sentAt: null });

    const res = await callPut({ status: "SENT" });

    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
});
