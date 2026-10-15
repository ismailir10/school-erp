/**
 * Browser-side calls and copy for settling a pendaftaran fee, used by the fee card on the
 * formulir detail page (the route is `PATCH /api/enrollments/[id]/fee`).
 *
 * Failures are `ApiError`s from `sendJson`: the server's own Indonesian text is the
 * message (a 409 means someone settled the fee first). Types only come from the
 * pure `fee-admin-view` module, so this stays safe in client bundles.
 */
import { ApiError } from "@/lib/api/client-errors";
import { sendJson } from "@/lib/api/send-json";
import type { AdminFeeView } from "./fee-admin-view";

export type SettleBody =
  | { action: "MARK_PAID"; method: "CASH" | "BANK_TRANSFER"; note?: string }
  | { action: "WAIVE"; note?: string };

/** What each settle action says when it fails without a server message. */
export const FEE_SETTLE_FALLBACK = {
  MARK_PAID: "Gagal mencatat pembayaran. Coba lagi.",
  WAIVE: "Gagal membebaskan biaya. Coba lagi.",
} as const;

/** Success toasts. */
export const FEE_SETTLE_TOAST = {
  MARK_PAID: "Pembayaran dicatat",
  WAIVE: "Biaya pendaftaran dibebaskan",
} as const;

/** Settle an UNPAID fee. Resolves with the updated staff view (null when the response carries none). */
export async function settleEnrollmentFee(applicationId: string, body: SettleBody): Promise<AdminFeeView | null> {
  const res = await sendJson<{ fee?: AdminFeeView } | null>(
    `/api/enrollments/${applicationId}/fee`,
    { method: "PATCH", body },
    FEE_SETTLE_FALLBACK[body.action],
  );
  return res?.fee ?? null;
}

/** The message to toast for a failed settle. */
export function settleErrorText(err: unknown, action: SettleBody["action"]): string {
  return err instanceof ApiError ? err.message : FEE_SETTLE_FALLBACK[action];
}

/** True when someone else settled the fee first (the route answers 409). */
export function isSettledElsewhere(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}
