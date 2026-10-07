/**
 * ADM-13: academic years may not overlap another non-ARCHIVED year in the
 * tenant (inclusive ends), and an end date before the start is rejected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const db = vi.hoisted(() => ({
  academicYear: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  studentEnrollment: { count: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true, remaining: 10 }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { getSession } from "@/lib/auth";
import { POST } from "../academic-years/route";
import { PUT } from "../academic-years/[id]/route";

const ADMIN: SessionUser = {
  id: "u1",
  email: "a@t.local",
  name: "Admin",
  role: "SCHOOL_ADMIN",
  tenantId: "t-1",
  employeeId: null,
  parentId: null,
  permissions: [],
  customRoleCode: null,
};

const OVERLAP_MSG = "Rentang tanggal bertumpuk dengan tahun ajaran 2025/2026.";

function req(method: string, body: unknown) {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
const ctx = { params: Promise.resolve({ id: "y2" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(ADMIN);
  db.$transaction.mockImplementation(async (fn) => fn(db));
});

describe("POST /api/academic-years overlap (ADM-13)", () => {
  const body = { name: "2026/2027", startDate: "2026-06-30", endDate: "2027-06-29" };

  it("409 with an inline startDate error naming the other year; nothing is written", async () => {
    db.academicYear.findFirst.mockResolvedValue({ name: "2025/2026" });
    const res = await POST(req("POST", body));
    expect(res.status).toBe(409);
    expect((await res.json()).errors).toEqual([{ field: "startDate", message: OVERLAP_MSG }]);
    expect(db.academicYear.create).not.toHaveBeenCalled();
  });

  it("queries only this tenant's non-archived years, with an inclusive range test", async () => {
    db.academicYear.findFirst.mockResolvedValue(null);
    db.academicYear.create.mockResolvedValue({ id: "y2", ...body });
    expect((await POST(req("POST", body))).status).toBe(201);
    expect(db.academicYear.findFirst.mock.calls[0][0].where).toEqual({
      tenantId: "t-1",
      status: { not: "ARCHIVED" },
      startDate: { lte: "2027-06-29" },
      endDate: { gte: "2026-06-30" },
    });
  });

  it("400 on end before start, on the endDate field, without touching the database", async () => {
    const res = await POST(req("POST", { ...body, endDate: "2026-06-01" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors[0]).toEqual({ field: "endDate", message: "Tanggal selesai harus setelah tanggal mulai" });
    expect(db.academicYear.findFirst).not.toHaveBeenCalled();
    expect(db.academicYear.create).not.toHaveBeenCalled();
  });
});

describe("PUT /api/academic-years/[id] overlap (ADM-13)", () => {
  const existing = { id: "y2", tenantId: "t-1", status: "PLANNING", startDate: "2026-07-01", endDate: "2027-06-30" };

  // First findFirst is the tenant-ownership lookup, the second the overlap probe.
  function mockLookups(overlap: { name: string } | null, row = existing) {
    db.academicYear.findFirst.mockResolvedValueOnce(row).mockResolvedValueOnce(overlap);
  }

  it("409 on startDate naming the other year when the new range collides", async () => {
    mockLookups({ name: "2025/2026" });
    const res = await PUT(req("PUT", { startDate: "2026-06-30" }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).errors).toEqual([{ field: "startDate", message: OVERLAP_MSG }]);
    expect(db.academicYear.update).not.toHaveBeenCalled();
  });

  it("uses effective dates (body value, else stored) and excludes the year itself and archived years", async () => {
    mockLookups(null);
    db.academicYear.update.mockResolvedValue({ ...existing, startDate: "2026-08-01" });
    expect((await PUT(req("PUT", { startDate: "2026-08-01" }), ctx)).status).toBe(200);
    expect(db.academicYear.findFirst.mock.calls[1][0].where).toEqual({
      tenantId: "t-1",
      id: { not: "y2" },
      status: { not: "ARCHIVED" },
      startDate: { lte: "2027-06-30" },
      endDate: { gte: "2026-08-01" },
    });
  });

  it("400 when only one end is sent and the effective range is inverted", async () => {
    db.academicYear.findFirst.mockResolvedValueOnce(existing);
    const res = await PUT(req("PUT", { endDate: "2026-06-30" }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).errors[0].field).toBe("endDate");
    expect(db.academicYear.update).not.toHaveBeenCalled();
  });

  it("skips the overlap probe for a rename or a status flip on an unarchived year", async () => {
    db.academicYear.findFirst.mockResolvedValueOnce(existing);
    db.academicYear.update.mockResolvedValue(existing);
    expect((await PUT(req("PUT", { name: "Baru" }), ctx)).status).toBe(200);
    expect(db.academicYear.findFirst).toHaveBeenCalledTimes(1);
  });

  it("skips the probe when the year ends up ARCHIVED", async () => {
    db.academicYear.findFirst.mockResolvedValueOnce(existing);
    db.studentEnrollment.count.mockResolvedValue(0);
    db.academicYear.update.mockResolvedValue({ ...existing, status: "ARCHIVED" });
    expect((await PUT(req("PUT", { status: "ARCHIVED" }), ctx)).status).toBe(200);
    expect(db.academicYear.findFirst).toHaveBeenCalledTimes(1);
  });

  it("re-checks overlap when an ARCHIVED year is brought back", async () => {
    mockLookups({ name: "2025/2026" }, { ...existing, status: "ARCHIVED" });
    const res = await PUT(req("PUT", { status: "PLANNING" }), ctx);
    expect(res.status).toBe(409);
    expect(db.academicYear.update).not.toHaveBeenCalled();
  });
});
