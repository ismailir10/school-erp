import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { enrollmentApplication: { findUnique } },
}));

import { GET } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

function req(query: string, ip = "1.2.3.4") {
  return new NextRequest(`http://localhost/api/enrollments/token/tok/wilayah${query}`, {
    headers: { "x-forwarded-for": ip },
  });
}
const ctx = { params: Promise.resolve({ token: "tok" }) };
const future = new Date(Date.now() + 86_400_000);
const open = () => findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  open();
});

describe("GET /api/enrollments/token/[token]/wilayah", () => {
  it("kode pos lookup returns region entries only", async () => {
    const res = await GET(req("?kodepos=40115"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(await res.json()).toEqual({
      results: [{ kodePos: "40115", kelurahan: "Citarum", kecamatan: "Bandung Wetan", kotaKab: "Kota Bandung", provinsi: "Jawa Barat" }],
    });
    // Only the access check touched the row; nothing from it is read for the answer.
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique.mock.calls[0][0].where).toEqual({ accessToken: "tok" });
  });

  it("returns several entries for a shared kode pos and an empty list for an unknown one", async () => {
    const shared = await (await GET(req("?kodepos=99351"), ctx)).json();
    expect(shared.results.length).toBeGreaterThanOrEqual(3);
    const none = await GET(req("?kodepos=00000"), ctx);
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ results: [] });
  });

  it("trims whitespace around the kode pos", async () => {
    const res = await GET(req("?kodepos=%2040115%20"), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).results).toHaveLength(1);
  });

  it("name search returns at most 20 results", async () => {
    const res = await GET(req("?q=citarum"), ctx);
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results.some((e: { kodePos: string }) => e.kodePos === "40115")).toBe(true);
    const many = await (await GET(req("?q=bandung"), ctx)).json();
    expect(many.results).toHaveLength(20);
  });

  it("400 with an Indonesian message for neither, both, or invalid parameters", async () => {
    for (const q of ["", "?kodepos=40115&q=citarum", "?kodepos=4011", "?kodepos=abcde", "?kodepos=", "?kodepos=401155", "?q=ci", "?q=", "?q=a%20b", `?q=${"x".repeat(200)}`]) {
      const res = await GET(req(q), ctx);
      expect(res.status, q).toBe(400);
      const body = await res.json();
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(5);
      expect(body.results).toBeUndefined();
    }
  });

  it("404 for an unknown token and no lookup runs", async () => {
    findUnique.mockResolvedValue(null);
    const res = await GET(req("?kodepos=40115"), ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("410 for an expired token", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: new Date(Date.now() - 1000), tenantId: "t-1" });
    expect((await GET(req("?kodepos=40115"), ctx)).status).toBe(410);
  });

  it("409 once the form is submitted", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "SUBMITTED", tokenExpiresAt: future, tenantId: "t-1" });
    const res = await GET(req("?q=citarum"), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).results).toBeUndefined();
  });

  it("an INVITED form with a fee row still answers (the fee never gates the form)", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1", fee: { status: "UNPAID" } });
    expect((await GET(req("?kodepos=40115"), ctx)).status).toBe(200);
  });

  it("429 after 60 requests a minute from one IP, without touching the database", async () => {
    for (let i = 0; i < 60; i++) {
      expect((await GET(req("?kodepos=40115", "9.9.9.9"), ctx)).status).toBe(200);
    }
    findUnique.mockClear();
    const res = await GET(req("?kodepos=40115", "9.9.9.9"), ctx);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(findUnique).not.toHaveBeenCalled();
    // Another client is unaffected.
    expect((await GET(req("?kodepos=40115", "8.8.8.8"), ctx)).status).toBe(200);
  });
});
