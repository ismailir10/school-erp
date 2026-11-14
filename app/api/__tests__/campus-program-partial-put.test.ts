/**
 * Data-integrity cycle 2026-09-29 (HR-9 + partial-PUT sweep):
 *  - campus lat/lng out of range -> 400 field errors, not a numeric overflow 500
 *  - PUT { status } (Aktifkan kembali / Nonaktifkan) must not wipe the
 *    campus address/lat/lng or the program description.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const db = vi.hoisted(() => ({
  campus: { create: vi.fn(), update: vi.fn() },
  program: { findFirst: vi.fn(), update: vi.fn() },
}));

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
import { POST as campusPost } from "../config/campuses/route";
import { PUT as campusPut } from "../config/campuses/[id]/route";
import { PUT as programPut } from "../programs/[id]/route";

const ADMIN: SessionUser = {
  id: "u1",
  email: "a@t.local",
  name: "Admin",
  role: "SCHOOL_ADMIN",
  tenantId: "t-1",
  employeeId: null,
  parentId: null,
  permissions: ["settings.edit", "academic.edit"],
  customRoleCode: null,
};

function req(method: string, body: unknown) {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
const params = { params: Promise.resolve({ id: "id-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(ADMIN);
  db.campus.create.mockResolvedValue({ id: "c1" });
  db.campus.update.mockResolvedValue({ id: "id-1" });
  db.program.findFirst.mockResolvedValue({ id: "id-1", tenantId: "t-1" });
  db.program.update.mockResolvedValue({ id: "id-1" });
});

describe("campus coordinates (HR-9)", () => {
  it("POST 400 with lat and lng field errors; nothing written", async () => {
    const res = await campusPost(req("POST", { name: "K", lat: 999, lng: -500 }));
    expect(res.status).toBe(400);
    const fields = (await res.json()).errors.map((e: { field: string }) => e.field).sort();
    expect(fields).toEqual(["lat", "lng"]);
    expect(db.campus.create).not.toHaveBeenCalled();
  });

  it("PUT 400 with a lat field error in the standard envelope", async () => {
    const res = await campusPut(req("PUT", { lat: 999 }), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validasi gagal");
    expect(json.errors).toEqual([{ field: "lat", message: "Latitude harus antara -90 dan 90" }]);
    expect(db.campus.update).not.toHaveBeenCalled();
  });
});

describe("PUT /api/config/campuses/[id] partial body", () => {
  it("status-only reactivation leaves address/lat/lng untouched", async () => {
    const res = await campusPut(req("PUT", { status: "ACTIVE" }), params);
    expect(res.status).toBe(200);
    const data = db.campus.update.mock.calls[0][0].data;
    expect(data.status).toBe("ACTIVE");
    expect(data.address).toBeUndefined();
    expect(data.lat).toBeUndefined();
    expect(data.lng).toBeUndefined();
  });

  it("explicit null / blank still clears; values are written", async () => {
    await campusPut(req("PUT", { address: "  ", lat: null, lng: null }), params);
    expect(db.campus.update.mock.calls[0][0].data).toMatchObject({ address: null, lat: null, lng: null });
    await campusPut(req("PUT", { address: " Jl. Aster 1 ", lat: "-6.2", lng: 106.8 }), params);
    expect(db.campus.update.mock.calls[1][0].data).toMatchObject({ address: "Jl. Aster 1", lat: -6.2, lng: 106.8 });
  });
});

describe("PUT /api/programs/[id] partial body", () => {
  it("status-only toggle leaves description untouched", async () => {
    const res = await programPut(req("PUT", { status: "INACTIVE" }), params);
    expect(res.status).toBe(200);
    const data = db.program.update.mock.calls[0][0].data;
    expect(data.status).toBe("INACTIVE");
    expect(data.description).toBeUndefined();
  });

  it("blank description still clears; a value is trimmed and written", async () => {
    await programPut(req("PUT", { description: "" }), params);
    expect(db.program.update.mock.calls[0][0].data.description).toBeNull();
    await programPut(req("PUT", { description: " Program A " }), params);
    expect(db.program.update.mock.calls[1][0].data.description).toBe("Program A");
  });
});

it("persists an edited program code", async () => {
  db.program.findFirst.mockResolvedValueOnce({ id: "id-1", tenantId: "t-1", code: "OLD" }).mockResolvedValueOnce(null);
  const res = await programPut(req("PUT", { code: "NEW" }), params);
  expect(res.status).toBe(200);
  expect(db.program.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ code: "NEW" }) }));
});
it("checks age intervals against the stored bound on partial program updates", async () => {
  db.program.findFirst.mockResolvedValue({ id: "id-1", tenantId: "t-1", ageMin: 48, ageMax: 84 });
  const res = await programPut(req("PUT", { ageMax: 12 }), params);
  expect(res.status).toBe(400);
  expect(db.program.update).not.toHaveBeenCalled();
});
