import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";

/**
 * The one definition of "this invoice still owes money", as Prisma `where` fragments
 * (cycle 2026-10-20-payment-link-expiry-display, D12). Four places used to say it four
 * ways: the status filter, the header summary, the "Buat link baru" button's number and
 * the pick behind that button. They disagreed, so the number on a button could differ
 * from the rows the matching filter listed. They now all build from here.
 *
 * Functions, not constants, because the "paid less than due" comparison is a Prisma field
 * reference (a column-to-column comparison done by the database), which needs the client.
 */

/** Paid less than due. */
export function stillOwesWhere(): Prisma.InvoiceWhereInput {
  return { totalPaid: { lt: prisma.invoice.fields.totalDue } };
}

/** "Belum lunas": a billed invoice (Link Dibuat, Dibayar Sebagian, Lewat Tempo) that still owes. */
export function owingInvoiceWhere(): Prisma.InvoiceWhereInput {
  return { status: { in: [...UNPAID_INVOICE_STATUSES] }, ...stillOwesWhere() };
}

/**
 * "Dibayar Sebagian": owing, with money already received. Money decides, not the stored status:
 * a partial payment past the due date is stored as OVERDUE (cycle 2026-10-17-payment-link-reminders,
 * D3), and it is still a partly paid invoice. The summary card counts this, never `status =
 * PARTIALLY_PAID` alone.
 */
export function partiallyPaidWhere(): Prisma.InvoiceWhereInput {
  return { AND: [owingInvoiceWhere(), { totalPaid: { gt: 0 } }] };
}

/** Owing with no payment link: the "Buat link baru (N)" button's invoices. */
export function owingWithoutLinkWhere(): Prisma.InvoiceWhereInput {
  return { ...owingInvoiceWhere(), xenditPaymentUrl: null };
}

/**
 * "Perlu link": everything the two header buttons act on. "Buat link baru" takes the
 * owing invoices without a link; "Coba lagi" takes Link Gagal (`PENDING_PAYMENT_LINK`).
 * The two sets never overlap (different statuses), so this count is exactly the sum of
 * the two button numbers.
 */
export function needsLinkWhere(): Prisma.InvoiceWhereInput {
  return { OR: [{ status: "PENDING_PAYMENT_LINK" }, owingWithoutLinkWhere()] };
}
