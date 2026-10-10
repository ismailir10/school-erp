import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { appFindFirst, tenantFindUnique, getSession, isAdminRole } = vi.hoisted(() => ({
  appFindFirst: vi.fn(),
  tenantFindUnique: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { enrollmentApplication: { findFirst: appFindFirst }, tenant: { findUnique: tenantFindUnique } },
}));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));

import { GET } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const ctx = (id = "app-1") => ({ params: Promise.resolve({ id }) });
const get = () => GET(new NextRequest("https://talib.example/api/enrollments/app-1/fee/reminder"), ctx());

const app = (over: Record<string, unknown> = {}) => ({
  status: "SUBMITTED",
  accessToken: "SECRET-TOKEN",
  childName: "Aisyah",
  ayahData: {},
  ibuData: {},
  admission: { parentName: "Siti", parentPhone: null, parentWhatsapp: "0812-3456-7890" },
  fee: { status: "UNPAID", amount: "240000" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view", "admissions.edit"] });
  isAdminRole.mockReturnValue(true);
  appFindFirst.mockResolvedValue(app());
  tenantFindUnique.mockResolvedValue({ name: "Sekolah Contoh" });
});

describe("GET /api/enrollments/[id]/fee/reminder", () => {
  it("redirects to WhatsApp on the parent's number with the reminder written", async () => {
    const res = await get();
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location.startsWith("https://wa.me/6281234567890?text=")).toBe(true);

    const text = decodeURIComponent(location.split("?text=")[1]);
    expect(text).toContain("Bapak/Ibu Siti");
    expect(text).toContain("ananda Aisyah");
    // The discounted amount the parent actually owes.
    expect(text).toContain("Rp 240.000");
    expect(text).toContain("https://talib.example/pendaftaran/SECRET-TOKEN");
  });

  it("signs with the session tenant's own school name, never a hard-coded one", async () => {
    const text = decodeURIComponent((await get()).headers.get("location")!.split("?text=")[1]);
    expect(text).toContain("Kami dari Sekolah Contoh.");
    expect(tenantFindUnique.mock.calls[0][0].where).toEqual({ id: "t-1" });
  });

  it("is never cached: the URL carries a credential", async () => {
    expect((await get()).headers.get("cache-control")).toBe("no-store");
  });

  it("looks the application up by id AND the session's tenant", async () => {
    await get();
    expect(appFindFirst.mock.calls[0][0].where).toEqual({ id: "app-1", tenantId: "t-1" });
  });

  it("404 for another tenant's (or an unknown) application, and for one with no fee", async () => {
    appFindFirst.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    appFindFirst.mockResolvedValue(app({ fee: null }));
    expect((await get()).status).toBe(404);
  });

  it.each(["PAID", "WAIVED"])("409 for a %s fee: nothing to chase", async (status) => {
    appFindFirst.mockResolvedValue(app({ fee: { status, amount: "300000" } }));
    const res = await get();
    expect(res.status).toBe(409);
    expect(res.headers.get("location")).toBeNull();
  });

  it("409 for a REJECTED application: its pay link is closed, so a reminder would send the parent to a dead end", async () => {
    appFindFirst.mockResolvedValue(app({ status: "REJECTED" }));
    const res = await get();
    expect(res.status).toBe(409);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).not.toContain("SECRET-TOKEN");
  });

  it("422 when there is no number WhatsApp can open, and no redirect", async () => {
    appFindFirst.mockResolvedValue(app({ admission: { parentName: "Siti", parentPhone: "123", parentWhatsapp: null } }));
    const res = await get();
    expect(res.status).toBe(422);
    expect(res.headers.get("location")).toBeNull();
    expect((await res.json()).error).toMatch(/nomor WhatsApp/);
  });

  it("falls back to the Ibu's then the Ayah's phone from the form", async () => {
    appFindFirst.mockResolvedValue(app({ admission: { parentName: "Siti", parentPhone: null, parentWhatsapp: null }, ayahData: { phone: "0815-5555-6666" } }));
    expect((await get()).headers.get("location")).toContain("https://wa.me/6281555556666?text=");
  });

  it("403 for a viewer without admissions.edit, before anything is read (the link carries the token)", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    const res = await get();
    expect(res.status).toBe(403);
    expect(appFindFirst).not.toHaveBeenCalled();
  });

  it("403 for a non-admin and with no session", async () => {
    isAdminRole.mockReturnValue(false);
    expect((await get()).status).toBe(403);
    getSession.mockResolvedValue(null);
    isAdminRole.mockReturnValue(true);
    expect((await get()).status).toBe(403);
    expect(appFindFirst).not.toHaveBeenCalled();
  });

  it("429 after 60 taps in a minute from one session", async () => {
    for (let i = 0; i < 60; i++) expect((await get()).status).toBe(302);
    expect((await get()).status).toBe(429);
  });

  it("never returns the token in a body", async () => {
    appFindFirst.mockResolvedValue(app({ fee: { status: "PAID", amount: "1" } }));
    expect(await (await get()).text()).not.toContain("SECRET-TOKEN");
  });
});
