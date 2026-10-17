/**
 * Client-side "I opened WhatsApp for this invoice" stamp (cycle
 * 2026-10-17-payment-link-reminders, D6/D7). Shared by the reminder queue and the
 * invoice detail page.
 *
 * The caller fires this from the click handler of a real `<a target="_blank">` and
 * never calls `preventDefault`: the navigation has to stay synchronous or mobile
 * browsers treat the new tab as a blocked popup. `keepalive` lets the POST finish
 * even if the page is backgrounded when WhatsApp takes over.
 */

import { ApiError, readApiError } from "@/lib/api/client-errors";

export type ReminderStamp = { lastRemindedAt: string; remindCount: number };

/** Resolves with the new stamp; rejects with an `ApiError` whose message is safe to toast. */
export async function stampReminder(invoiceId: string): Promise<ReminderStamp> {
  const fallback = "Pengingat belum tercatat. Coba lagi sebentar lagi.";
  let res: Response;
  try {
    res = await fetch(`/api/invoices/${invoiceId}/reminder`, { method: "POST", keepalive: true });
  } catch {
    throw new ApiError("Pengingat belum tercatat. Periksa koneksi Anda.");
  }
  if (!res.ok) throw await readApiError(res, fallback);
  const body = (await res.json()) as ReminderStamp;
  return { lastRemindedAt: body.lastRemindedAt, remindCount: body.remindCount };
}
