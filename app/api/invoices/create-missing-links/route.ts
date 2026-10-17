import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { createMissingPaymentLinks, LINK_START_DEADLINE_MS } from "@/lib/payments/missing-links";
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
 * Selection, ordering and the one-link-only creation live in
 * `createMissingPaymentLinks` (`lib/payments/missing-links.ts`), which the nightly
 * `finance-maintenance` heal shares; this route scopes it to the admin's tenant.
 *
 * It creates links only: no status changes, no message to the parent. Same
 * permission as creating invoices (`invoices.create`), tenant-scoped, rate
 * limited per admin; no new subject for the gateway beyond what the existing
 * "Buat Link Pembayaran" action already does.
 */
export const maxDuration = 60;

/** Per call. A session create is about a second; 25 at 5 at a time stays well inside `maxDuration`. */
const BATCH_SIZE = 25;

export async function POST(req: Request) {
  // Authentication and candidate selection consume the same function duration as gateway work.
  const deadline = Date.now() + LINK_START_DEADLINE_MS;
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
  const result = await createMissingPaymentLinks({
    tenantId,
    batchSize: BATCH_SIZE,
    startDeadline: deadline,
    origin,
  });

  // Parents see the new link on their next fetch.
  if (result.created > 0) {
    revalidateTag("parent-invoice-list", { expire: 0 });
    revalidateTag("student-invoices", { expire: 0 });
  }

  return NextResponse.json(result);
}
