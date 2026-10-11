/**
 * Writing and re-pricing the pendaftaran fee row. Server-only (Prisma).
 *
 * `createFeeSnapshot` is the ONE place a fee row is created from the stored
 * program fees: the parent's submit and staff's "Tandai formulir masuk" both call
 * it, so the two can never price differently. The client never sends an amount.
 *
 * `repriceUnpaidFee` is the one place an existing fee is re-priced after the
 * program or Day Care add-on changed (staff edit, and a resend of the formulir).
 *
 * `createFeeSnapshot` does NOT check for an existing row (the `applicationId`
 * unique would reject a second one): every caller reads the fee first, under the
 * application's row lock.
 */
import type { Prisma } from "@/lib/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { computeEnrollmentFee, type FeeProgram } from "./fee";
import { getProgramFees } from "./fee-config";
import { ADMIN_FEE_SELECT, toAdminFeeView, type AdminFeeView } from "./fee-admin-view";

/**
 * Stop handing out the stored payment link. The gateway session id is KEPT: a
 * parent who already opened the old order can still pay it until it expires, and
 * reconcile / the daily sweep poll on that id (same rule as the staff fee route).
 */
export const DROP_LINK = { paymentUrl: null, sessionExpiresAt: null, linkError: null } as const;

/**
 * Note stamped on a fee that was closed automatically because the new program has
 * no pendaftaran fee. It marks that waive as machine-made, so a later move to a
 * paid program may reopen it; a staff waive never carries it and is never reopened.
 */
export const AUTO_WAIVE_NOTE = "Program tanpa biaya pendaftaran";

/** Staff 403 when program / Day Care would move an UNPAID fee without the finance key. */
export const REPRICE_FORBIDDEN = "Mengubah program mengubah biaya pendaftaran; butuh izin keuangan.";

export type FeeSnapshot = { baseAmount: number; amount: number; status: "UNPAID" };

/**
 * Create the UNPAID fee row for an application, priced from `programs` (the
 * tenant's ACTIVE program fees). Returns null — and writes nothing — when the
 * price is 0 (free program, no program). The caller has already checked that no
 * fee row exists; no gateway call happens here (the link is minted lazily by /pay).
 */
export async function createFeeSnapshot(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; applicationId: string; programs: readonly FeeProgram[]; programId: string | null | undefined; dcareAddon: boolean },
): Promise<FeeSnapshot | null> {
  const breakdown = computeEnrollmentFee({ programs: input.programs, programId: input.programId, dcareAddon: input.dcareAddon });
  if (breakdown.amount <= 0) return null;
  await tx.enrollmentFee.create({
    data: {
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      baseAmount: breakdown.baseAmount,
      discountPercent: 0,
      amount: breakdown.amount,
      status: "UNPAID",
    },
  });
  return { baseAmount: breakdown.baseAmount, amount: breakdown.amount, status: "UNPAID" };
}

/**
 * What happened to the fee when the program / Day Care changed:
 *  - repriced        an UNPAID fee was recomputed (or closed, see below)
 *  - unchanged_paid  PAID: left alone
 *  - unchanged_waived WAIVED: left alone
 *  - none            the application has no fee row
 *  - unchanged_inactive_program  the chosen program is retired, so there is no
 *                    price to compute; the fee is left alone (never silently waived)
 */
export type FeeNote = "repriced" | "unchanged_paid" | "unchanged_waived" | "none" | "unchanged_inactive_program";

export type RepriceOutcome = { note: FeeNote; fee: AdminFeeView | null };

/**
 * Re-price an application's fee for the (already updated) `programId` /
 * `dcareAddon`. Only an UNPAID fee moves: PAID and WAIVED are history.
 *
 *  - The staff discount percent (and reason) is KEPT; base and amount are
 *    recomputed over the ACTIVE program fees.
 *  - The stored payment link is dropped when the amount changed, so a stale link
 *    is never handed out at the old price (the gateway session id stays).
 *  - A program set but no longer ACTIVE leaves the fee untouched
 *    (`unchanged_inactive_program`): a retired program must never waive a fee.
 *  - A new amount of 0 — free program, no program, or a 100% discount — closes
 *    the fee as WAIVED, exactly like the fee route does when a 100% discount
 *    zeroes it: there is nothing to collect, so the parent must not be sent to pay.
 *
 * A fee auto-waived earlier (WAIVED carrying AUTO_WAIVE_NOTE) is REOPENED as UNPAID
 * when the new amount is above 0; a staff waive and a PAID fee never are.
 *
 * Runs under the same per-fee advisory lock the payment processor and the staff
 * fee route take, so a webhook crediting the fee cannot interleave. Audited in
 * `tx`. No PII in the audit row.
 */
export async function repriceUnpaidFee(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; applicationId: string; programId: string | null | undefined; dcareAddon: boolean; actorId: string; now?: Date },
): Promise<RepriceOutcome> {
  const now = input.now ?? new Date();
  const found = await tx.enrollmentFee.findFirst({
    where: { applicationId: input.applicationId, tenantId: input.tenantId },
    select: { id: true },
  });
  if (!found) return { note: "none", fee: null };

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${found.id}))`;
  const before = await tx.enrollmentFee.findUnique({ where: { id: found.id }, select: ADMIN_FEE_SELECT });
  if (!before) return { note: "none", fee: null };
  const beforeView = toAdminFeeView(before, now);
  if (before.status === "PAID") return { note: "unchanged_paid", fee: beforeView };
  const autoWaived = before.status === "WAIVED" && before.note === AUTO_WAIVE_NOTE;
  if (before.status === "WAIVED" && !autoWaived) return { note: "unchanged_waived", fee: beforeView };

  const programs = await getProgramFees(input.tenantId, tx);
  if (input.programId && !programs.some((p) => p.id === input.programId)) {
    return { note: "unchanged_inactive_program", fee: beforeView };
  }
  const next = computeEnrollmentFee({
    programs,
    programId: input.programId,
    dcareAddon: input.dcareAddon,
    discountPercent: before.discountPercent,
  });
  if (autoWaived && next.amount === 0) return { note: "unchanged_waived", fee: beforeView };
  const reopened = autoWaived; // only reachable with a payable amount
  const closes = next.amount === 0;
  const amountChanged = next.amount !== beforeView.amount;

  const after = await tx.enrollmentFee.update({
    where: { id: found.id, tenantId: input.tenantId },
    data: {
      baseAmount: next.baseAmount,
      amount: next.amount,
      ...(amountChanged || closes || reopened ? DROP_LINK : {}),
      ...(reopened ? { status: "UNPAID", method: null, markedBy: null, paidAt: null, note: null } : {}),
      ...(closes
        ? {
            status: "WAIVED",
            method: "WAIVED",
            markedBy: input.actorId,
            ...(next.baseAmount === 0 ? { note: AUTO_WAIVE_NOTE } : {}),
          }
        : {}),
    },
    select: ADMIN_FEE_SELECT,
  });
  const afterView = toAdminFeeView(after, now);
  await recordAudit(
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      entity: "EnrollmentFee",
      entityId: found.id,
      action: "fee.reprice",
      before: { status: beforeView.status, baseAmount: beforeView.baseAmount, amount: beforeView.amount, discountPercent: beforeView.discountPercent },
      after: { status: afterView.status, baseAmount: afterView.baseAmount, amount: afterView.amount, discountPercent: afterView.discountPercent, reopened },
    },
    tx,
  );
  return { note: "repriced", fee: afterView };
}
