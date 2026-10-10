/**
 * What the PUBLIC pendaftaran pages may know about an application's fee: the
 * money and its state, never the gateway ids, links or staff notes. Server-only
 * (Prisma); the shape is plain JSON so it can cross into a client component.
 */

import { prisma } from "@/lib/db";

export type PublicFeeStatus = "UNPAID" | "PAID" | "WAIVED";

export type PublicFeeView = {
  /** What the parent pays now (after any discount). */
  amount: number;
  /** The normal fee, before any discount. */
  baseAmount: number;
  discountPercent: number;
  status: PublicFeeStatus;
  /** ISO instant, set once PAID. */
  paidAt: string | null;
  /** True once a payment link was issued, i.e. the parent has started to pay. */
  started: boolean;
};

function toStatus(raw: string): PublicFeeStatus {
  return raw === "PAID" || raw === "WAIVED" ? raw : "UNPAID";
}

/** The fee of an application, or null when it has none (free program / not submitted). */
export async function getPublicFeeView(
  applicationId: string,
  db: Pick<typeof prisma, "enrollmentFee"> = prisma,
): Promise<PublicFeeView | null> {
  const fee = await db.enrollmentFee.findUnique({
    where: { applicationId },
    select: { amount: true, baseAmount: true, discountPercent: true, status: true, paidAt: true, paymentUrl: true },
  });
  if (!fee) return null;
  return {
    // Prisma Decimal arrives string-like.
    amount: Math.round(Number(fee.amount)),
    baseAmount: Math.round(Number(fee.baseAmount)),
    discountPercent: fee.discountPercent,
    status: toStatus(fee.status),
    paidAt: fee.paidAt ? fee.paidAt.toISOString() : null,
    started: Boolean(fee.paymentUrl),
  };
}
