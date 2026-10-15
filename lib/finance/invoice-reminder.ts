/**
 * Chasing an unpaid invoice by WhatsApp from the admin invoice page (cycle
 * 2026-10-10-pendaftaran-fee-payment). Pure and client-safe: the page already
 * holds the guardian's contact and the DOKU payment link (neither is a
 * credential of ours), so the `wa.me` URL is built where it is shown.
 */

import { formatRupiah } from "@/lib/format";
import { whatsappHref, whatsappHrefWithText } from "@/lib/contact";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";

type Guardian = { name?: string | null; whatsapp?: string | null; phone?: string | null } | null | undefined;

/** The guardian's WhatsApp number, else their phone; only a number WhatsApp can open counts. */
export function guardianChatNumber(guardian: Guardian): string | null {
  for (const n of [guardian?.whatsapp, guardian?.phone]) {
    if (n && whatsappHref(n)) return n;
  }
  return null;
}

/** Money is still owed and the family has been billed (not a draft, not settled, not voided). */
export function canRemindInvoice(invoice: { status: string; remaining: number }): boolean {
  return (UNPAID_INVOICE_STATUSES as readonly string[]).includes(invoice.status) && invoice.remaining > 0;
}

/** Parent voice: courteous, names the invoice and what is left, easy to ignore if already paid. */
export function invoiceReminderText(input: {
  guardianName: string | null | undefined;
  studentName: string;
  invoiceNumber: string;
  periodLabel: string;
  remaining: number;
  /** The DOKU link when one exists; otherwise the portal address. */
  payUrl: string;
}): string {
  const who = input.guardianName?.trim() ? `Bapak/Ibu ${input.guardianName.trim()}` : "Bapak/Ibu";
  return [
    `Assalamu'alaikum ${who}.`,
    `Tagihan ${input.periodLabel} untuk ananda ${input.studentName} (${input.invoiceNumber}) masih tersisa ${formatRupiah(input.remaining)}.`,
    `Bapak/Ibu bisa membayarnya lewat tautan berikut: ${input.payUrl}`,
    "Jika sudah membayar, mohon abaikan pesan ini. Jazakumullah khairan.",
  ].join("\n\n");
}

/** `wa.me` URL with the reminder prefilled, or null when there is no number WhatsApp can open. */
export function invoiceReminderWaUrl(input: {
  guardian: Guardian;
  studentName: string;
  invoiceNumber: string;
  periodLabel: string;
  remaining: number;
  payUrl: string;
}): string | null {
  const phone = guardianChatNumber(input.guardian);
  if (!phone) return null;
  return whatsappHrefWithText(
    phone,
    invoiceReminderText({
      guardianName: input.guardian?.name,
      studentName: input.studentName,
      invoiceNumber: input.invoiceNumber,
      periodLabel: input.periodLabel,
      remaining: input.remaining,
      payUrl: input.payUrl,
    }),
  );
}
