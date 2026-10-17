import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

process.env.CRON_SECRET = "test-cron-secret";

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: vi.fn(),
  },
}));

import { GET } from "../cron/finance-maintenance/route";

function makeReq(opts: { authorization?: string; userAgent?: string }) {
  const headers: Record<string, string> = {};
  if (opts.authorization !== undefined) headers["authorization"] = opts.authorization;
  if (opts.userAgent !== undefined) headers["user-agent"] = opts.userAgent;
  return new Request("http://localhost:3000/api/cron/finance-maintenance", {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
});

describe("GET /api/cron/finance-maintenance", () => {
  it("returns 500 + logs when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { prisma } = await import("@/lib/db");

    const res = await GET(
      makeReq({
        authorization: "Bearer anything",
        userAgent: "vercel-cron/1.0",
      }) as never,
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Server misconfigured");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("CRON_SECRET not set"),
    );
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns 401 when bearer token is wrong", async () => {
    const { prisma } = await import("@/lib/db");

    const res = await GET(
      makeReq({
        authorization: "Bearer wrong-token",
        userAgent: "vercel-cron/1.0",
      }) as never,
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("returns 401 when authorization header is missing", async () => {
    const res = await GET(
      makeReq({ userAgent: "vercel-cron/1.0" }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when bearer is correct but UA is not vercel-cron", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { prisma } = await import("@/lib/db");

    const res = await GET(
      makeReq({
        authorization: "Bearer test-cron-secret",
        userAgent: "curl/8.1.2",
      }) as never,
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Suspicious UA"),
    );
    warnSpy.mockRestore();
  });

  it("returns 403 when UA is missing entirely", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET(
      makeReq({ authorization: "Bearer test-cron-secret" }) as never,
    );
    expect(res.status).toBe(403);
    warnSpy.mockRestore();
  });

  it("returns 200 with counts when bearer + UA are correct", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$executeRaw)
      .mockResolvedValueOnce(7) // purge
      .mockResolvedValueOnce(3); // promote

    const res = await GET(
      makeReq({
        authorization: "Bearer test-cron-secret",
        userAgent: "vercel-cron/1.0",
      }) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      webhookPurged: 7,
      overduePromoted: 3,
    });
    expect(typeof body.ranAt).toBe("string");
    expect(() => new Date(body.ranAt)).not.toThrow();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it("issues a DELETE on WebhookEvent older than 90 days and an UPDATE on Invoice", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$executeRaw)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await GET(
      makeReq({
        authorization: "Bearer test-cron-secret",
        userAgent: "vercel-cron/1.0",
      }) as never,
    );

    // Inspect tagged-template invocation: prisma.$executeRaw is called with
    // a TemplateStringsArray as its first arg. Reconstruct the SQL string.
    const calls = vi.mocked(prisma.$executeRaw).mock.calls;
    expect(calls).toHaveLength(2);

    const sql0 = (calls[0]?.[0] as TemplateStringsArray | undefined)?.join("?");
    expect(sql0).toBeDefined();
    expect(sql0).toMatch(/DELETE FROM\s+"WebhookEvent"/);
    expect(sql0).toMatch(/createdAt"\s*<\s*NOW\(\)\s*-\s*INTERVAL\s*'90 days'/);

    const sql1 = (calls[1]?.[0] as TemplateStringsArray | undefined)?.join("?");
    expect(sql1).toBeDefined();
    expect(sql1).toMatch(/UPDATE\s+"Invoice"\s+SET\s+"status"\s*=\s*'OVERDUE'/);
    expect(sql1).toMatch(/"status"\s*=\s*'SENT'/);
    expect(sql1).toMatch(/Asia\/Jakarta/);
    expect(sql1).toMatch(/dueDate"\s*</);
  });
});

afterAll(() => {
  delete process.env.CRON_SECRET;
});
