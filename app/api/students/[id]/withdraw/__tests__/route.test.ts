import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { studentFindFirst, invoiceCount, studentUpdate, enrollmentUpdateMany, recordAudit, getSession } = vi.hoisted(() => ({
  studentFindFirst: vi.fn(),
  invoiceCount: vi.fn(),
  studentUpdate: vi.fn(),
  enrollmentUpdateMany: vi.fn(),
  recordAudit: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    student: { findFirst: studentFindFirst },
    invoice: { count: invoiceCount },
    $transaction: vi.fn((fn: (tx: Record<string, unknown>) => unknown) =>
      fn({ student: { update: studentUpdate }, studentEnrollment: { updateMany: enrollmentUpdateMany } }),
    ),
  },
}));
vi.mock("@/lib/audit", () => ({ recordAudit }));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole: () => true }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ success: true }), getClientIp: () => "127.0.0.1" }));

import { POST } from "../route";

const ctx = { params: Promise.resolve({ id: "s-1" }) };
const reqx = (body: unknown) =>
  new NextRequest("http://localhost/api/students/s-1/withdraw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SUPER_ADMIN" });
  studentFindFirst.mockResolvedValue({ id: "s-1", tenantId: "t-1", status: "ACTIVE" });
  invoiceCount.mockResolvedValue(0);
  studentUpdate.mockResolvedValue({ id: "s-1", status: "WITHDRAWN" });
  enrollmentUpdateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/students/[id]/withdraw", () => {
  it("withdraws the student and writes a withdraw audit row inside the transaction", async () => {
    const res = await POST(reqx({ reason: "Pindah kota", effectiveDate: "2026-10-01" }), ctx);
    expect(res.status).toBe(200);
    expect(studentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "WITHDRAWN", withdrawalDate: "2026-10-01" }) }),
    );
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      {
        tenantId: "t-1",
        actorId: "u-1",
        entity: "Student",
        entityId: "s-1",
        action: "withdraw",
        after: { withdrawalDate: "2026-10-01", reason: "Pindah kota" },
      },
      expect.objectContaining({ student: { update: studentUpdate } }),
    );
  });

  it("writes no audit row when the student is already withdrawn", async () => {
    studentFindFirst.mockResolvedValue({ id: "s-1", tenantId: "t-1", status: "WITHDRAWN" });
    const res = await POST(reqx({ reason: "Pindah kota" }), ctx);
    expect(res.status).toBe(400);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
