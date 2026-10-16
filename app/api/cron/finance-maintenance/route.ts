// @public — Vercel Cron endpoint, gated by CRON_SECRET bearer token (not user session).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Daily finance maintenance — Vercel Cron 01:00 UTC = 08:00 WIB.
 *
 * Two operations:
 * 1. Purge WebhookEvent rows older than 90 days (audit retention).
 * 2. Promote SENT invoices past their dueDate (Asia/Jakarta) to OVERDUE.
 *
 * Vercel Cron calls the path with GET; a POST-only export answered 405 and
 * never ran (cycle 2026-10-16-cron-get-handlers).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}. Vercel Cron auto-injects this
 * header when CRON_SECRET is set in project settings — operator MUST set
 * it before merge (one-time `openssl rand -hex 32`). Defense-in-depth:
 * User-Agent must start with `vercel-cron/`. Both checks fail-closed.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[CRON] CRON_SECRET not set — refusing to run.");
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userAgent = req.headers.get("user-agent") ?? "";
  if (!userAgent.startsWith("vercel-cron/")) {
    console.warn(`[CRON] Suspicious UA: ${userAgent}`);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1. Purge WebhookEvent older than 90 days.
  const purgeResult = await prisma.$executeRaw`
    DELETE FROM "WebhookEvent" WHERE "createdAt" < NOW() - INTERVAL '90 days'
  `;

  // 2. Promote SENT → OVERDUE for invoices past due (Asia/Jakarta).
  const promoteResult = await prisma.$executeRaw`
    UPDATE "Invoice" SET "status" = 'OVERDUE'
    WHERE "status" = 'SENT'
      AND "dueDate" < TO_CHAR(NOW() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
  `;

  return NextResponse.json({
    webhookPurged: purgeResult,
    overduePromoted: promoteResult,
    ranAt: new Date().toISOString(),
  });
}
