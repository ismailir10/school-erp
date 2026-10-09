import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Production path: Supabase is configured and the visitor has no session.
const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { updateSession } from "../middleware";

function get(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

describe("updateSession: public static assets with no session", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: null } });
  });

  it("serves the school photos (next/image fetches them with no cookies)", async () => {
    const res = await updateSession(get("/school/fun-cooking.webp"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("still serves the logo", async () => {
    const res = await updateSession(get("/logo.png"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not extend the bypass to look-alike paths or to portal pages", async () => {
    for (const path of ["/schoolfoo", "/school", "/admin/students", "/parent"]) {
      const res = await updateSession(get(path));
      expect(res.headers.get("location"), path).toBe("http://localhost/");
    }
  });
});
