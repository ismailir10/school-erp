import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

// No Supabase and no demo session: a path is either public (passes through) or bounced to "/".
function get(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`), { headers: { "x-forwarded-for": "1.2.3.4" } });
}

describe("proxy: public static assets", () => {
  beforeEach(() => {
    __resetRateLimitForTest();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("DEMO_MODE", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets next/image fetch the public school photos without a session", async () => {
    const res = await proxy(get("/school/suasana-kelas.webp"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("still lets the logo through (the existing public asset)", async () => {
    const res = await proxy(get("/logo.png"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not extend the bypass to look-alike paths", async () => {
    for (const path of ["/schoolfoo", "/school", "/schools/x.webp"]) {
      const res = await proxy(get(path));
      expect(res.headers.get("location"), path).toContain("http://localhost/");
    }
  });

  it("keeps portal pages gated", async () => {
    const res = await proxy(get("/admin/students"));
    expect(res.headers.get("location")).toContain("http://localhost/");
  });
});
