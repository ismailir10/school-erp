// @public — Vercel Cron endpoint, gated by CRON_SECRET bearer token (not user session).
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { createMissingPaymentLinks, LINK_START_DEADLINE_MS } from "@/lib/payments/missing-links";
import { resolveAppOrigin } from "@/lib/payments/session";

/**
 * Daily finance maintenance — Vercel Cron 01:00 UTC = 08:00 WIB.
 *
 * Three operations:
 * 1. Purge WebhookEvent rows older than 90 days (audit retention).
 * 2. Promote SENT and PARTIALLY_PAID invoices past their dueDate (Asia/Jakarta) to OVERDUE.
 * 3. Heal payment links: give every unpaid invoice that has none a fresh one, every school,
 *    at most HEAL_BATCH_SIZE a night, within the time budget (cycle
 *    2026-10-17-payment-link-reminders, D2). The reconcile sweep (00:30 UTC) only clears
 *    dead links, so this runs after it. It rides this cron rather than a new one because
 *    the Hobby plan's cron allowance is tight.
 *
 * Vercel Cron calls the path with GET; a POST-only export answered 405 and
 * never ran (cycle 2026-10-16-cron-get-handlers).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}. Vercel Cron auto-injects this
 * header when CRON_SECRET is set in project settings — operator MUST set
 * it before merge (one-time `openssl rand -hex 32`). Defense-in-depth:
 * User-Agent must start with `vercel-cron/`. Both checks fail-closed.
 */
export const maxDuration = 60;

/** Links to try per night. The admin's "Buat link baru (N)" stays for catch-up beyond it. */
const HEAL_BATCH_SIZE = 50;

export async function GET(req: NextRequest) {
  // The heal's start deadline counts from here: auth, purge and promotion spend the same
  // function duration as the gateway work.
  const startedAt = Date.now();
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

  // 2. Promote SENT / PARTIALLY_PAID → OVERDUE for invoices past due (Asia/Jakarta).
  // Once the due date has passed, money still owed means Lewat Tempo even when part of
  // it was paid (D3); the paid and remaining amounts still show everywhere. A
  // PARTIALLY_PAID row that owes nothing (totalDue 0, or paid >= due) is left alone.
  const promoteResult = await prisma.$executeRaw`
    UPDATE "Invoice" SET "status" = 'OVERDUE'
    WHERE ("status" = 'SENT' OR ("status" = 'PARTIALLY_PAID' AND "totalPaid" < "totalDue"))
      AND "dueDate" < TO_CHAR(NOW() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
  `;

  // 3. Heal missing payment links. A gateway failure on one invoice is already isolated
  // by the helper; this catch is for anything unexpected (a dropped DB connection), so it
  // is reported in the JSON instead of a 500 that hides the purge and promotion results.
  let linkHeal: { created: number; failed: number; skipped: number; remaining: number } | null = null;
  let linkHealError: string | null = null;
  try {
    // A cron has no browser origin: prefer the configured app URL, and fall back to the
    // request's own origin only when it is unset.
    const origin = process.env.NEXT_PUBLIC_APP_URL
      ? resolveAppOrigin()
      : resolveAppOrigin(new URL(req.url).origin);
    linkHeal = await createMissingPaymentLinks({
      batchSize: HEAL_BATCH_SIZE,
      startDeadline: startedAt + LINK_START_DEADLINE_MS,
      origin,
    });
    // Parents see the new link on their next fetch.
    if (linkHeal.created > 0) {
      revalidateTag("parent-invoice-list", { expire: 0 });
      revalidateTag("student-invoices", { expire: 0 });
    }
  } catch (e) {
    linkHealError = e instanceof Error ? e.message : String(e);
    console.error("[CRON] finance-maintenance link heal failed:", e);
  }

  return NextResponse.json({
    webhookPurged: purgeResult,
    overduePromoted: promoteResult,
    linkHeal,
    linkHealError,
    ranAt: new Date().toISOString(),
  });
}
