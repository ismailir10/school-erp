import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

process.env.CRON_SECRET = "test-cron-secret";

const { healMock, revalidateMock } = vi.hoisted(() => ({
  healMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: vi.fn(),
  },
}));
// The helper's selection and deadline are pinned in lib/payments/__tests__/missing-links.test.ts.
vi.mock("@/lib/payments/missing-links", () => ({
  createMissingPaymentLinks: healMock,
  LINK_START_DEADLINE_MS: 22_000,
}));
vi.mock("next/cache", () => ({ revalidateTag: revalidateMock }));

import { prisma } from "@/lib/db";
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

const tallies = { created: 0, failed: 0, skipped: 0, remaining: 0 };
const authed = () =>
  makeReq({ authorization: "Bearer test-cron-secret", userAgent: "vercel-cron/1.0" }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
  healMock.mockResolvedValue({ ...tallies });
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
    // A partly paid invoice past its due date is Lewat Tempo too (D3), but only while it
    // still owes money.
    expect(sql1).toMatch(/"status"\s*=\s*'SENT'/);
    expect(sql1).toMatch(/"status"\s*=\s*'PARTIALLY_PAID'\s+AND\s+"totalPaid"\s*<\s*"totalDue"/);
    expect(sql1).toMatch(/Asia\/Jakarta/);
    expect(sql1).toMatch(/dueDate"\s*</);
  });
});

describe("link heal phase", () => {
  beforeEach(() => {
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
  });

  it("runs after the promotion, over every school, 50 at a time, within a 22 s start budget", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const t0 = new Date("2026-10-17T01:00:00Z").getTime();
      vi.setSystemTime(t0);
      const order: string[] = [];
      vi.mocked(prisma.$executeRaw).mockReset();
      vi.mocked(prisma.$executeRaw).mockImplementation((async () => {
        order.push("sql");
        return 0;
      }) as never);
      healMock.mockImplementation(async () => {
        order.push("heal");
        return { ...tallies };
      });

      await GET(authed());

      expect(order).toEqual(["sql", "sql", "heal"]);
      expect(healMock).toHaveBeenCalledTimes(1);
      const opts = healMock.mock.calls[0][0];
      expect(opts.tenantId).toBeUndefined();
      expect(opts.batchSize).toBe(50);
      expect(opts.startDeadline).toBe(t0 + 22_000);
      // the configured app URL wins over the request's own origin, trailing slash trimmed
      expect(opts.origin).toBe("https://app.example.com");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the request origin when NEXT_PUBLIC_APP_URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    await GET(authed());
    expect(healMock.mock.calls[0][0].origin).toBe("http://localhost:3000");
  });

  it("reports the heal tallies next to the existing fields", async () => {
    healMock.mockResolvedValue({ created: 4, failed: 1, skipped: 2, remaining: 9 });
    const body = await (await GET(authed())).json();
    expect(body).toMatchObject({
      webhookPurged: 2,
      overduePromoted: 1,
      linkHeal: { created: 4, failed: 1, skipped: 2, remaining: 9 },
      linkHealError: null,
    });
  });

  it("an unexpected throw is reported, not a 500 that hides the purge and promotion", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    healMock.mockRejectedValue(new Error("connection reset"));
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      webhookPurged: 2,
      overduePromoted: 1,
      linkHeal: null,
      linkHealError: "connection reset",
    });
    expect(revalidateMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("clears the parent-facing caches only when a link was actually made", async () => {
    await GET(authed());
    expect(revalidateMock).not.toHaveBeenCalled();

    vi.mocked(prisma.$executeRaw).mockResolvedValue(0);
    healMock.mockResolvedValue({ ...tallies, created: 3 });
    await GET(authed());
    expect(revalidateMock).toHaveBeenCalledWith("parent-invoice-list", { expire: 0 });
    expect(revalidateMock).toHaveBeenCalledWith("student-invoices", { expire: 0 });
  });

  it("does not heal when the request is rejected", async () => {
    await GET(makeReq({ authorization: "Bearer wrong-token", userAgent: "vercel-cron/1.0" }) as never);
    expect(healMock).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  delete process.env.CRON_SECRET;
  delete process.env.NEXT_PUBLIC_APP_URL;
});
