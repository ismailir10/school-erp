/**
 * Chasing an unpaid invoice by WhatsApp from the admin invoice page (cycle
 * 2026-10-10-pendaftaran-fee-payment). Pure and client-safe: the page already
 * holds the guardian's contact and the DOKU payment link (neither is a
 * credential of ours), so the `wa.me` URL is built where it is shown.
 */

import { formatRupiah } from "@/lib/format";
import { whatsappHref, whatsappHrefWithText } from "@/lib/contact";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { effectiveReminderTemplate, renderReminderTemplate } from "@/lib/finance/reminder-template";

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

/**
 * The reminder text: the school's own template (`Tenant.invoiceReminderTemplate`) with this invoice's
 * details filled in, or the courteous default when it has none. Parent voice either way.
 */
export function invoiceReminderText(input: {
  guardianName: string | null | undefined;
  studentName: string;
  invoiceNumber: string;
  periodLabel: string;
  remaining: number;
  /** The DOKU link when one exists; otherwise the portal address. */
  payUrl: string;
  /** The school's stored template; null/blank → the default wording. */
  template?: string | null;
}): string {
  const who = input.guardianName?.trim() ? `Bapak/Ibu ${input.guardianName.trim()}` : "Bapak/Ibu";
  return renderReminderTemplate(effectiveReminderTemplate(input.template), {
    wali: who,
    siswa: input.studentName,
    periode: input.periodLabel,
    nomor: input.invoiceNumber,
    sisa: formatRupiah(input.remaining),
    tautan: input.payUrl,
  });
}

/** `wa.me` URL with the reminder prefilled, or null when there is no number WhatsApp can open. */
export function invoiceReminderWaUrl(input: {
  guardian: Guardian;
  studentName: string;
  invoiceNumber: string;
  periodLabel: string;
  remaining: number;
  payUrl: string;
  template?: string | null;
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
      template: input.template,
    }),
  );
}

export type FamilyReminderItem = {
  studentName: string;
  invoiceNumber: string;
  periodLabel: string;
  remaining: number;
};

/**
 * One message for a wali with several unpaid invoices (the wali page, cycle
 * 2026-10-19-wali-detail-clarity). Same courteous voice as `invoiceReminderText`:
 * one line per invoice, the total, the portal address (where every invoice can
 * be paid), and an easy out for a family that has already paid.
 */
export function familyReminderText(input: {
  guardianName: string | null | undefined;
  items: FamilyReminderItem[];
  /** The whole debt, not just the listed items: the list is capped. */
  total: number;
  /** Unpaid invoices beyond `items`, named as one trailing line. */
  moreCount?: number;
  /** The parent portal's invoice list. */
  payUrl: string;
}): string {
  const who = input.guardianName?.trim() ? `Bapak/Ibu ${input.guardianName.trim()}` : "Bapak/Ibu";
  const lines = input.items.map(
    (i) => `- ${i.periodLabel} untuk ananda ${i.studentName} (${i.invoiceNumber}): ${formatRupiah(i.remaining)}`,
  );
  if (input.moreCount && input.moreCount > 0) lines.push(`- dan ${input.moreCount} tagihan lainnya`);
  return [
    `Assalamu'alaikum ${who}.`,
    ["Tagihan berikut masih tersisa:", ...lines, `Total: ${formatRupiah(input.total)}`].join("\n"),
    `Bapak/Ibu bisa melihat dan membayarnya lewat tautan berikut: ${input.payUrl}`,
    "Jika sudah membayar, mohon abaikan pesan ini. Jazakumullah khairan.",
  ].join("\n\n");
}

/** `wa.me` URL with the family reminder prefilled, or null when there is nothing to chase or no number WhatsApp can open. */
export function familyReminderWaUrl(input: {
  guardian: Guardian;
  items: FamilyReminderItem[];
  total: number;
  moreCount?: number;
  payUrl: string;
}): string | null {
  if (input.items.length === 0) return null;
  const phone = guardianChatNumber(input.guardian);
  if (!phone) return null;
  return whatsappHrefWithText(
    phone,
    familyReminderText({
      guardianName: input.guardian?.name,
      items: input.items,
      total: input.total,
      moreCount: input.moreCount,
      payUrl: input.payUrl,
    }),
  );
}
