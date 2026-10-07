/**
 * Rp 0 billing-run rows (FINX-4, docs/cycles/2026-10-07-finance-money-guards.md).
 *
 * A row whose total is zero (keringanan >= SPP, or a line edited down to 0)
 * has nothing to bill. Committed as an invoice it would sit at
 * PENDING_PAYMENT_LINK forever — a payment link cannot be created for Rp 0
 * and "Catat Pembayaran" needs an amount > 0 — so the commit route leaves it
 * out and parks it as EXCLUDED with this reason. Rows are NOT classified at
 * build time because step 2 lets the admin edit lines, so the total can move
 * either way after the draft is built.
 *
 * Prisma-free so the wizard (client) shares the exact predicate and wording.
 */

export const ZERO_TOTAL_REASON = "Rp 0 — tidak ditagih";

/** True when a row's total is nothing to bill. Accepts Decimal-ish values. */
export function isZeroTotal(totalDue: { toString(): string } | number | string | null | undefined): boolean {
  if (totalDue === null || totalDue === undefined) return false;
  const n = Number(totalDue.toString());
  return Number.isFinite(n) && n <= 0;
}
