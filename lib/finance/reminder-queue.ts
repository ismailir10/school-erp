/**
 * The WhatsApp reminder queue's order and row shape (cycle 2026-10-17-payment-link-reminders).
 * Pure, so the route stays a thin auth + query wrapper and the ordering is unit-tested.
 */

import { guardianChatNumber, invoiceReminderWaUrl } from "@/lib/finance/invoice-reminder";

type Guardian = { name?: string | null; whatsapp?: string | null; phone?: string | null } | null | undefined;

/** The slice of an Invoice (the route's `select`, with its primary guardian) the queue reads. */
export type ReminderInvoice = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  dueDate: string;
  status: string;
  totalDue: unknown;
  totalPaid: unknown;
  xenditPaymentUrl: string | null;
  lastRemindedAt: Date | null;
  lastRemindedBy: string | null;
  remindCount: number;
  student: { name: string; guardians: { parent: Guardian }[] };
};

export type ReminderCandidate = { invoice: ReminderInvoice; remaining: number; guardian: Guardian };

/** Money still owed; Prisma hands Decimals back as strings or Decimal objects. */
export function invoiceRemaining(invoice: Pick<ReminderInvoice, "totalDue" | "totalPaid">): number {
  return Number(invoice.totalDue) - Number(invoice.totalPaid);
}

/** Never reminded first, then the oldest reminder, then the oldest due date, then the number (stable). */
export function compareReminderQueue(a: ReminderInvoice, b: ReminderInvoice): number {
  const ta = a.lastRemindedAt?.getTime() ?? -Infinity;
  const tb = b.lastRemindedAt?.getTime() ?? -Infinity;
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return a.invoiceNumber < b.invoiceNumber ? -1 : a.invoiceNumber > b.invoiceNumber ? 1 : 0;
}

/**
 * Splits unpaid invoices into the queue (money owed AND a guardian number WhatsApp can open,
 * in queue order) and a count of the owed-but-unreachable ones the admin can't chase here.
 */
export function buildReminderQueue(invoices: ReminderInvoice[]): { queue: ReminderCandidate[]; excludedNoNumber: number } {
  const queue: ReminderCandidate[] = [];
  let excludedNoNumber = 0;
  for (const invoice of invoices) {
    const remaining = invoiceRemaining(invoice);
    if (remaining <= 0) continue;
    const guardian = invoice.student.guardians[0]?.parent ?? null;
    if (!guardianChatNumber(guardian)) {
      excludedNoNumber += 1;
      continue;
    }
    queue.push({ invoice, remaining, guardian });
  }
  queue.sort((a, b) => compareReminderQueue(a.invoice, b.invoice));
  return { queue, excludedNoNumber };
}

/** One queue row. `waUrl` only when the invoice has a link: a row without one offers "Buat link dulu". */
export function toReminderRow(c: ReminderCandidate, lastRemindedByName: string | null) {
  const { invoice, remaining, guardian } = c;
  const hasLink = !!invoice.xenditPaymentUrl;
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    periodLabel: invoice.periodLabel,
    dueDate: invoice.dueDate,
    status: invoice.status,
    totalDue: Number(invoice.totalDue),
    totalPaid: Number(invoice.totalPaid),
    remaining,
    studentName: invoice.student.name,
    guardianName: guardian?.name ?? null,
    hasLink,
    waUrl:
      hasLink && invoice.xenditPaymentUrl
        ? invoiceReminderWaUrl({
            guardian,
            studentName: invoice.student.name,
            invoiceNumber: invoice.invoiceNumber,
            periodLabel: invoice.periodLabel,
            remaining,
            payUrl: invoice.xenditPaymentUrl,
          })
        : null,
    lastRemindedAt: invoice.lastRemindedAt ? invoice.lastRemindedAt.toISOString() : null,
    lastRemindedByName,
    remindCount: invoice.remindCount,
  };
}
