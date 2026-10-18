/**
 * A kuitansi follows money received, not the status label: a partly paid
 * invoice keeps its receipt after it turns Lewat Tempo (cycle
 * 2026-10-17-payment-link-reminders D3). A cancelled invoice never has one.
 */
export function hasReceipt(invoice: { status: string; totalPaid: { toString(): string } }): boolean {
  return invoice.status !== "CANCELLED" && Number(invoice.totalPaid.toString()) > 0;
}
