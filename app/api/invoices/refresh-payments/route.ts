import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { limit } from "@/lib/finance/concurrency-limit";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { reconcileInvoicePayment } from "@/lib/payments/reconcile";
import { hasPermission } from "@/lib/permissions";

/**
 * POST /api/invoices/refresh-payments
 *
 * Admin button "Cek semua belum lunas": asks the payment gateway about every
 * unpaid invoice that holds a payment link, one batch of 50 per call. It is the
 * nightly `reconcile-payments` sweep on demand, for the admin who has just been
 * told "saya sudah bayar" or who wants the whole list brought up to date.
 *
 * The SERVER picks the batch, not the client, so a list filter can never hide an
 * unpaid invoice from it. Candidates are the tenant's SENT / PARTIALLY_PAID /
 * OVERDUE invoices with a link, least recently checked first, skipping any
 * checked in the last 10 minutes. Every reconcile stamps `paymentCheckedAt`, so
 * pressing the button again continues with the next 50 and `remaining` falls to
 * zero; an invoice that needs an immediate re-check has its own row action.
 *
 * No new write path: each invoice goes through `reconcileInvoicePayment`, the
 * read-only poll + shared processor that the row button, the parent return page
 * and the cron already use, so every guard (dedup, advisory lock, amount checks)
 * applies unchanged and running it twice is a no-op.
 *
 * Auth and permission mirror the single-invoice `refresh-payment` route. Rate
 * limited per admin because one call costs up to 50 outbound gateway requests.
 * The limiter is per serverless instance, so the real bound on gateway spend is
 * the database: each reconcile claims the invoice atomically (`minIntervalMs`),
 * which holds across instances, so two presses that race (a double click, two
 * tabs) cannot poll the same invoice twice within the 10 minutes.
 */
export const maxDuration = 60;

/** Per call. 50 polls at 5 at a time fits well inside `maxDuration`. */
const BATCH_SIZE = 50;
/** Concurrent gateway polls. Matches the cron and the bulk link generator. */
const CONCURRENCY = 5;
/** An invoice checked more recently than this is skipped, which is what lets a second press move on. */
const RECENTLY_CHECKED_MS = 10 * 60_000;
/**
 * Stop starting new polls after this long. A gateway poll can take 10 s, so a
 * degraded gateway would otherwise carry 50 polls past `maxDuration` and the
 * admin would get a timeout with no tally. Invoices not started are left
 * unstamped and counted in `remaining`, so pressing again picks them up.
 */
const START_DEADLINE_MS = 40_000;

export async function POST() {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "payments.record")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { success } = rateLimit(`refresh-payments:${session.id}`, 6, 60_000);
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu sering memeriksa status. Tunggu sebentar lalu coba lagi." },
      { status: 429 },
    );
  }

  const { tenantId } = session;
  const where = (cutoff: Date) => ({
    tenantId,
    status: { in: [...UNPAID_INVOICE_STATUSES] },
    xenditPaymentUrl: { not: null },
    OR: [{ paymentCheckedAt: null }, { paymentCheckedAt: { lt: cutoff } }],
  });
  const cutoff = new Date(Date.now() - RECENTLY_CHECKED_MS);

  const candidates = await prisma.invoice.findMany({
    where: where(cutoff),
    select: { id: true },
    orderBy: [{ paymentCheckedAt: { sort: "asc", nulls: "first" } }, { dueDate: "asc" }],
    take: BATCH_SIZE,
  });

  const deadline = Date.now() + START_DEADLINE_MS;
  const run = limit(CONCURRENCY);
  const codes = await Promise.all(
    candidates.map((invoice) =>
      run(async () => {
        if (Date.now() > deadline) return "SKIPPED" as const;
        try {
          return (await reconcileInvoicePayment(invoice.id, { minIntervalMs: RECENTLY_CHECKED_MS })).code;
        } catch (err) {
          // One invoice must never abort the batch.
          console.error("[REFRESH PAYMENTS] Invoice failed", {
            invoiceId: invoice.id,
            error: err instanceof Error ? err.message : String(err),
          });
          return "GATEWAY_ERROR" as const;
        }
      }),
    ),
  );

  const tally = codes.reduce<Record<string, number>>((acc, code) => {
    acc[code] = (acc[code] ?? 0) + 1;
    return acc;
  }, {});

  // Counted after the run with the same cutoff: the ones just checked now carry
  // a fresh stamp and drop out, so this is exactly what the next press will take.
  const remaining = await prisma.invoice.count({ where: where(cutoff) });

  const skipped = tally.SKIPPED ?? 0;
  return NextResponse.json({
    checked: candidates.length - skipped,
    updated: tally.UPDATED ?? 0,
    failed: tally.GATEWAY_ERROR ?? 0,
    remaining,
    tally,
  });
}
