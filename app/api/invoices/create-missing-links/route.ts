import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { limit } from "@/lib/finance/concurrency-limit";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { ensurePaymentLink } from "@/lib/payments/ensure-link";
import { hasPermission } from "@/lib/permissions";

/**
 * POST /api/invoices/create-missing-links
 *
 * Admin button "Buat link baru (N)": gives every unpaid invoice that has no
 * payment link a fresh one, 25 per call (cycle 2026-10-17-payment-link-on-demand).
 * A link dies at the end of the due date and the reconcile sweep then clears it,
 * so an expired invoice has none until someone makes one; a parent can make their
 * own from their page, and this is for the admin who would rather send links out.
 *
 * The SERVER picks the batch, so a list filter can never hide an unpaid invoice.
 * Candidates are the tenant's SENT / PARTIALLY_PAID / OVERDUE invoices with no
 * link, never-touched first and then by due date, skipping any claimed in the
 * last 30 s. Each one goes through `ensurePaymentLink`, the same one-link-only
 * path the parent button uses, so an admin and a parent acting on the same
 * invoice, or a double press, still make exactly one link. An invoice that fails
 * keeps its claim stamp, which sorts it behind the untouched ones, so a few
 * stubborn failures cannot starve the rest.
 *
 * It creates links only: no status changes, no message to the parent. Same
 * permission as creating invoices (`invoices.create`), tenant-scoped, rate
 * limited per admin; no new subject for the gateway beyond what the existing
 * "Buat Link Pembayaran" action already does.
 */
export const maxDuration = 60;

/** Per call. A session create is about a second; 25 at 5 at a time stays well inside `maxDuration`. */
const BATCH_SIZE = 25;
const CONCURRENCY = 5;
/** Matches the claim window in `ensurePaymentLink`. */
const CLAIM_WINDOW_MS = 30_000;
/** Stop starting new links after this long; the rest stay for the next press. */
const START_DEADLINE_MS = 40_000;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { success } = rateLimit(`create-missing-links:${session.id}`, 6, 60_000);
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu sering membuat link. Tunggu sebentar lalu coba lagi." },
      { status: 429 },
    );
  }

  const { tenantId } = session;
  const origin = new URL(req.url).origin;
  const where = (claimCutoff: Date) => ({
    tenantId,
    status: { in: [...UNPAID_INVOICE_STATUSES] },
    xenditPaymentUrl: null,
    OR: [{ paymentCheckedAt: null }, { paymentCheckedAt: { lt: claimCutoff } }],
  });
  const cutoff = new Date(Date.now() - CLAIM_WINDOW_MS);

  const candidates = await prisma.invoice.findMany({
    where: where(cutoff),
    select: { id: true },
    orderBy: [{ paymentCheckedAt: { sort: "asc", nulls: "first" } }, { dueDate: "asc" }],
    take: BATCH_SIZE,
  });

  const deadline = Date.now() + START_DEADLINE_MS;
  const run = limit(CONCURRENCY);
  const outcomes = await Promise.all(
    candidates.map((invoice) =>
      run(async () => {
        if (Date.now() > deadline) return "SKIPPED" as const;
        // No waiting on a racing winner here: a batch moves on, the next press revisits it.
        const r = await ensurePaymentLink(invoice.id, tenantId, origin, {
          waitForWinnerMs: 0,
          releaseOnFailure: false,
        });
        if (r.kind === "READY") return r.created ? ("CREATED" as const) : ("ALREADY" as const);
        return r.kind === "NOT_PAYABLE" ? ("SKIPPED" as const) : ("FAILED" as const);
      }),
    ),
  );

  const count = (o: string) => outcomes.filter((x) => x === o).length;
  const created = count("CREATED");

  // Parents see the new link on their next fetch.
  if (created > 0) {
    revalidateTag("parent-invoice-list", { expire: 0 });
    revalidateTag("student-invoices", { expire: 0 });
  }

  const remaining = await prisma.invoice.count({ where: where(cutoff) });

  return NextResponse.json({
    created,
    failed: count("FAILED"),
    skipped: count("SKIPPED"),
    remaining,
  });
}
