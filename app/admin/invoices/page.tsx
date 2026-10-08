import { assertPermission } from "@/lib/auth-guards";
import { invoiceCapabilities } from "@/lib/finance/invoice-capabilities";
import { getGateway } from "@/lib/payments/registry";
import { InvoicesClient } from "./invoices-client";

/**
 * Server wrapper — the invoices list is entirely client-rendered
 * (`invoices-client.tsx`), but the active gateway id must be resolved
 * server-side and handed down as a prop rather than read from
 * `process.env` inside a "use client" file (cycle 2026-07-27-doku-payment-gateway
 * T6). `PendingLinkBreakdownPopover` uses it to name the correct credential
 * env var in its auth-heavy hint.
 */
const STATUS_FILTERS = ["DRAFT", "SENT", "PAID", "PARTIALLY_PAID", "OVERDUE", "CANCELLED", "PENDING_PAYMENT_LINK"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const session = await assertPermission("invoices.view");
  const { status } = await searchParams;
  // ?status= deep link (dashboard "Lewat tempo" card); unknown values fall back to "all".
  const initialStatus = typeof status === "string" && STATUS_FILTERS.includes(status) ? status : "all";
  return <InvoicesClient gatewayId={getGateway().id} capabilities={invoiceCapabilities(session)} initialStatus={initialStatus} />;
}
