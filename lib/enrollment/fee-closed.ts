/**
 * "Is this application's pendaftaran fee no longer collected online?" One rule for
 * every place that asks: the payment link, the reminder, the follow-up flags and
 * the public payment screen. Staff rejected the application, or the lead behind it
 * was cancelled; either way no new payment link is handed out. Pure, no Prisma.
 */
export function isFeeClosed(app: { status: string; admission?: { status: string } | null }): boolean {
  return app.status === "REJECTED" || app.admission?.status === "CANCELLED";
}
