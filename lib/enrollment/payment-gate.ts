/**
 * What the public "Bayar dulu" screen needs, and nothing more. Server-only
 * (Prisma). The parent has not paid yet, so the page shows the amount and what is
 * waiting behind it (the seven steps, the documents the school makes mandatory)
 * instead of the form. No child or parent data, no payment link, no gateway ids.
 */

import { prisma } from "@/lib/db";
import { DOCUMENT_ITEMS } from "./documents";
import { isFeeClosed } from "./fee-closed";
import { getPublicFeeView, type PublicFeeView } from "./fee-view";
import { getRequiredDocuments } from "./required-documents";
import { ENROLLMENT_FORM_STEPS } from "./steps";

export type PaymentGateView = {
  /** The program the fee was priced for; null when it has been removed since. */
  programName: string | null;
  dcareAddon: boolean;
  fee: PublicFeeView;
  /** The form's step titles, in order. */
  steps: string[];
  /** Documents the school requires as uploads, in form order; empty when none are mandatory. */
  requiredDocuments: { key: string; label: string }[];
  /**
   * Staff closed this registration (rejected, or the lead was cancelled): no new
   * payment link is issued, so the screen must say so instead of offering to pay.
   */
  closed: boolean;
};

/**
 * The gate view of an application, or null when it does not exist in `tenantId`
 * or has no fee (nothing to pay, so no gate). `tenantId` is the caller's own
 * resolved credential; a mismatched pair reads as "no fee", never as data.
 */
export async function getPaymentGateView(applicationId: string, tenantId: string): Promise<PaymentGateView | null> {
  const app = await prisma.enrollmentApplication.findFirst({
    where: { id: applicationId, tenantId },
    select: {
      status: true,
      dcareAddon: true,
      program: { select: { name: true } },
      admission: { select: { status: true } },
    },
  });
  if (!app) return null;

  const [fee, required] = await Promise.all([getPublicFeeView(applicationId), getRequiredDocuments(tenantId)]);
  if (!fee) return null;

  return {
    programName: app.program?.name ?? null,
    dcareAddon: app.dcareAddon,
    fee,
    steps: [...ENROLLMENT_FORM_STEPS],
    requiredDocuments: required.map((key) => ({ key, label: DOCUMENT_ITEMS.find((i) => i.key === key)?.label ?? key })),
    closed: isFeeClosed(app),
  };
}
