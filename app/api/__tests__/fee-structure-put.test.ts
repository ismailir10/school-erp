/**
 * Coverage for `PUT /api/fee-structure` — payments-module-hardening audit
 * (2026-07-27). The route previously trusted its TS-annotated body verbatim:
 * no zod parse (negative amounts persisted and flowed into batch invoice
 * generation's totalDue) and no tenant-ownership check on `feeComponentId`
 * (a foreign tenant's cuid was durably attached and readable back through
 * GET's `include: { feeComponent: true }`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  program: { findFirst: vi.fn() },
  academicYear: { findFirst: vi.fn() },
  feeComponentDef: { count: vi.fn() },
  programFeeStructure: { findMany: vi.fn(), upsert: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { PUT } from "../fee-structure/route";
import { getSession } from "@/lib/auth";

const ADMIN = {
  id: "u1",
  email: "a@t.local",
  name: "Admin",
  role: "SCHOOL_ADMIN",
  tenantId: "t-1",
  employeeId: null,
  parentId: null,
  permissions: ["fees.view", "fees.edit"] as string[],
  customRoleCode: null,
};

function makeReq(body: unknown) {
  return new Request("http://localhost/api/fee-structure", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID_BODY = {
  programId: "prog-1",
  academicYearId: "ay-1",
  fees: [{ feeComponentId: "fc-1", amount: 250_000 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(ADMIN as never);
  db.program.findFirst.mockResolvedValue({ id: "prog-1" });
  db.academicYear.findFirst.mockResolvedValue({ id: "ay-1" });
  db.feeComponentDef.count.mockResolvedValue(1);
  db.programFeeStructure.upsert.mockResolvedValue({});
});

describe("PUT /api/fee-structure", () => {
  it("403 for non-admin role", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...ADMIN, role: "TEACHER" } as never);
    const res = await PUT(makeReq(VALID_BODY) as never);
    expect(res.status).toBe(403);
    expect(db.programFeeStructure.upsert).not.toHaveBeenCalled();
  });

  it("400 on malformed JSON body", async () => {
    const res = await PUT(makeReq("not-json{{") as never);
    expect(res.status).toBe(400);
    expect(db.programFeeStructure.upsert).not.toHaveBeenCalled();
  });

  it("400 on negative amount (regression: flowed into batch totalDue)", async () => {
    const res = await PUT(
      makeReq({
        ...VALID_BODY,
        fees: [{ feeComponentId: "fc-1", amount: -50_000 }],
      }) as never,
    );
    expect(res.status).toBe(400);
    expect(db.programFeeStructure.upsert).not.toHaveBeenCalled();
  });

  it("404 when a feeComponentId belongs to another tenant (IDOR guard)", async () => {
    // 2 distinct ids submitted, only 1 owned by t-1.
    db.feeComponentDef.count.mockResolvedValue(1);
    const res = await PUT(
      makeReq({
        ...VALID_BODY,
        fees: [
          { feeComponentId: "fc-1", amount: 100_000 },
          { feeComponentId: "fc-foreign", amount: 100_000 },
        ],
      }) as never,
    );
    expect(res.status).toBe(404);
    expect(db.feeComponentDef.count).toHaveBeenCalledWith({
      where: { id: { in: ["fc-1", "fc-foreign"] }, tenantId: "t-1" },
    });
    expect(db.programFeeStructure.upsert).not.toHaveBeenCalled();
  });

  it("200 happy path — upsert tenant-stamped, zero amount allowed (unpriced row)", async () => {
    db.feeComponentDef.count.mockResolvedValue(2);
    const res = await PUT(
      makeReq({
        ...VALID_BODY,
        fees: [
          { feeComponentId: "fc-1", amount: 250_000 },
          { feeComponentId: "fc-2", amount: 0 },
        ],
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(db.programFeeStructure.upsert).toHaveBeenCalledTimes(2);
    expect(db.programFeeStructure.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ tenantId: "t-1", feeComponentId: "fc-1" }),
      }),
    );
  });

  it("404 when program belongs to another tenant", async () => {
    db.program.findFirst.mockResolvedValue(null);
    const res = await PUT(makeReq(VALID_BODY) as never);
    expect(res.status).toBe(404);
    expect(db.programFeeStructure.upsert).not.toHaveBeenCalled();
  });
});


it("denies an invoice viewer who lacks fees.edit before touching tariffs", async () => {
  vi.mocked(getSession).mockResolvedValue({ ...ADMIN, permissions: ["invoices.view"] } as never);
  const res = await PUT(makeReq(VALID_BODY) as never);
  expect(res.status).toBe(403);
  expect(db.programFeeStructure.upsert).not.toHaveBeenCalled();
});
