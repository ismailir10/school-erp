/** Campus geofence radius (docs/cycles/2026-11-07-attendance-geofence-gate.md): 10–1000 m, default 50. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const db = vi.hoisted(() => ({ campus: { create: vi.fn(), update: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});
vi.mock("@/lib/auth-guard", () => ({ verifyTenantOwnership: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true, remaining: 10 }),
  getClientIp: () => "127.0.0.1",
}));

import { getSession } from "@/lib/auth";
import { POST } from "../config/campuses/route";
import { PUT } from "../config/campuses/[id]/route";

const ADMIN: SessionUser = {
  id: "u1", email: "a@t.local", name: "Admin", role: "SCHOOL_ADMIN", tenantId: "t-1",
  employeeId: null, parentId: null, permissions: [], customRoleCode: null,
};
const req = (method: string, body: unknown) =>
  new Request("http://localhost/api/x", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) as never;
const params = { params: Promise.resolve({ id: "id-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(ADMIN);
  db.campus.create.mockResolvedValue({ id: "c1" });
  db.campus.update.mockResolvedValue({ id: "id-1" });
});

describe("campus radiusMeters", () => {
  it("POST stores a given radius and leaves it to the column default when omitted", async () => {
    await POST(req("POST", { name: "K", radiusMeters: "80" }));
    expect(db.campus.create.mock.calls[0][0].data.radiusMeters).toBe(80);
    await POST(req("POST", { name: "K" }));
    expect(db.campus.create.mock.calls[1][0].data.radiusMeters).toBeUndefined();
  });

  it("POST/PUT 400 with a radiusMeters field error when out of range", async () => {
    const post = await POST(req("POST", { name: "K", radiusMeters: 5000 }));
    expect(post.status).toBe(400);
    expect((await post.json()).errors).toEqual([{ field: "radiusMeters", message: "Radius maksimal 1000 meter" }]);
    const put = await PUT(req("PUT", { radiusMeters: 3 }), params);
    expect(put.status).toBe(400);
    expect(db.campus.create).not.toHaveBeenCalled();
    expect(db.campus.update).not.toHaveBeenCalled();
  });

  it("PUT writes the radius; PUT { status } leaves it alone", async () => {
    await PUT(req("PUT", { radiusMeters: 120 }), params);
    expect(db.campus.update.mock.calls[0][0].data.radiusMeters).toBe(120);
    await PUT(req("PUT", { status: "ACTIVE" }), params);
    expect(db.campus.update.mock.calls[1][0].data.radiusMeters).toBeUndefined();
  });
});
