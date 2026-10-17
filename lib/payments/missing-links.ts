import { prisma } from "@/lib/db";
import { limit } from "@/lib/finance/concurrency-limit";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { ensurePaymentLink } from "@/lib/payments/ensure-link";

/**
 * Gives unpaid invoices that have no payment link a fresh one, one batch at a time.
 *
 * Shared by the admin button "Buat link baru (N)" (`POST /api/invoices/create-missing-links`,
 * one tenant, 25 a press) and the nightly `finance-maintenance` heal (every tenant, 50 a
 * night) (cycle 2026-10-17-payment-link-reminders, D2). A link dies at the end of its due
 * date and the reconcile sweep then clears it without making a new one, so this is what
 * puts it back.
 *
 * Candidates are SENT / PARTIALLY_PAID / OVERDUE invoices that still owe money and have no
 * link, never-touched first and then by due date, skipping any that someone is creating a
 * link for right now. Each goes through `ensurePaymentLink`, the one-link-only path the
 * parent button uses, so two callers on the same invoice, or a double press, still make
 * exactly one link. An invoice whose gateway call fails keeps its claim (a stamp in the
 * future), which both rests it for the claim window and sorts it behind the untouched
 * ones, so a few stubborn failures cannot starve the rest. One that is no longer payable
 * is never claimed, which is why the pick excludes anything with nothing left to pay: it
 * would otherwise sit at the head of the order forever.
 *
 * It creates links only: no status changes, no message to the parent, and no cache
 * busting. The caller tags `parent-invoice-list` and `student-invoices` when `created > 0`.
 */

/** Upper bound on gateway sessions in flight at once. */
const CONCURRENCY = 5;

/**
 * Function-duration arithmetic shared by both callers (both export `maxDuration = 60`).
 *
 * The start deadline has to leave room for a creation's WHOLE retry budget, not one
 * attempt: a gateway create times out at 10 s and `withRetry` makes up to 3 attempts with
 * 0.25 s and 1 s backoffs, so one link can take 31.25 s. A create that starts just before
 * the cutoff must still finish, with the remaining count and the response, inside
 * `maxDuration`: 60 s - 32 s (worst-case create, rounded up) - 6 s (count query, response,
 * scheduling) = 22 s.
 */
const MAX_DURATION_MS = 60_000;
const WORST_CASE_CREATE_MS = 32_000;
const RESPONSE_OVERHEAD_MS = 6_000;
export const LINK_START_DEADLINE_MS = MAX_DURATION_MS - WORST_CASE_CREATE_MS - RESPONSE_OVERHEAD_MS;

export interface MissingLinksOptions {
  /** One school, or `undefined` for every school (the nightly job). */
  tenantId?: string;
  /** Most invoices to try in this call. */
  batchSize: number;
  /**
   * Epoch ms after which no NEW creation starts; the rest stay for the next run. Absolute,
   * and measured by the caller from handler entry so authentication and the queries before
   * this call spend the same function duration as the gateway work.
   */
  startDeadline: number;
  /** Return-URL origin for the gateway session, from `resolveAppOrigin`. */
  origin: string;
}

export interface MissingLinksResult {
  /** Links this call made. An invoice that got its link from someone else is not counted. */
  created: number;
  failed: number;
  /** Not started before the deadline, or no longer payable by the time its turn came. */
  skipped: number;
  /** Candidates still waiting after this call (same filter as the pick). */
  remaining: number;
}

export async function createMissingPaymentLinks(opts: MissingLinksOptions): Promise<MissingLinksResult> {
  const { tenantId, batchSize, startDeadline, origin } = opts;
  // "Not being created right now": a claim is a stamp in the future (see `ensurePaymentLink`).
  const where = (now: Date) => ({
    ...(tenantId ? { tenantId } : {}),
    status: { in: [...UNPAID_INVOICE_STATUSES] },
    // Still owes money: Prisma field reference, a column-to-column comparison in the DB.
    totalPaid: { lt: prisma.invoice.fields.totalDue },
    xenditPaymentUrl: null,
    OR: [{ paymentCheckedAt: null }, { paymentCheckedAt: { lt: now } }],
  });
  const startedAt = new Date();

  const candidates = await prisma.invoice.findMany({
    where: where(startedAt),
    // An all-school run has no single tenant to pass, so the row supplies it below.
    select: { id: true, tenantId: true },
    orderBy: [{ paymentCheckedAt: { sort: "asc", nulls: "first" } }, { dueDate: "asc" }],
    take: batchSize,
  });

  const run = limit(CONCURRENCY);
  const outcomes = await Promise.all(
    candidates.map((invoice) =>
      run(async () => {
        if (Date.now() > startDeadline) return "SKIPPED" as const;
        // No waiting on a racing winner here: a batch moves on, the next run revisits it.
        const r = await ensurePaymentLink(invoice.id, tenantId ?? invoice.tenantId, origin, { waitForWinnerMs: 0 });
        if (r.kind === "READY") return r.created ? ("CREATED" as const) : ("ALREADY" as const);
        return r.kind === "NOT_PAYABLE" ? ("SKIPPED" as const) : ("FAILED" as const);
      }),
    ),
  );

  const count = (o: string) => outcomes.filter((x) => x === o).length;
  const remaining = await prisma.invoice.count({ where: where(new Date()) });

  return { created: count("CREATED"), failed: count("FAILED"), skipped: count("SKIPPED"), remaining };
}
