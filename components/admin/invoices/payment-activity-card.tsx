"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/ui/section-heading";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { paymentChannelLabel } from "@/lib/constants/payment-channels";

/**
 * Aktivitas Pembayaran — admin-side audit panel rendered on the invoice
 * detail page (cycle: finance-robustness-a-b-c, T7; renamed from
 * `XenditActivityCard`/"Aktivitas Xendit" in 2026-07-27-doku-payment-gateway
 * T6 — the panel now feeds off whichever gateway is active, so the copy no
 * longer names a specific vendor). Replaces the planned `/admin/webhooks`
 * inspector with a contextual per-invoice feed.
 *
 * Empty-state policy (per spec C6): when the invoice has zero stored
 * `WebhookEvent` rows, the card does NOT render at all. ~95% of invoices
 * never receive a webhook (DRAFT / cash-paid / void) — silent absence is
 * the cleaner signal.
 *
 * Row layout (two lines, per spec C6):
 *   Line 1 (dominant): paidAt humanized · amount font-currency right
 *   Line 2 (xs muted): event-type badge · status pill · method-or-error
 *
 * Status pill colors mirror design-system §Status badges — green PROCESSED,
 * red ERROR, muted IGNORED.
 *
 * The "Lihat payload" disclosure renders the server-redacted JSON inside a
 * scrollable `<pre>` (max-h-96, x/y overflow). PII (`customer.*`,
 * `billing_information.*`, `virtual_account_info.*`) is already stripped
 * server-side by `redactPayload` before the response leaves the API.
 */

type DisplayFields = {
  paidAt: string | null;
  paymentMethod: string | null;
  amount: number | null;
  currency: string | null;
  sessionId: string | null;
  paymentId: string | null;
};

type WebhookEventRow = {
  id: string;
  eventType: string;
  status: string;
  errorMessage: string | null;
  errorLabel: string | null;
  createdAt: string;
  displayFields: DisplayFields;
  payload: Record<string, unknown> | null;
};

// Shown when the underlying event never reports a payment rail (Xendit
// Payment Link events don't carry it — the DOKU adapter always does via
// `channel.id`). Deliberately vendor-neutral: describes what the row means,
// not which provider's event vocabulary produced it.
const METHOD_TOOLTIP = "Metode pembayaran tidak tercatat untuk event ini.";

function formatPaidAt(iso: string | null): string {
  // "26 Apr 2026 · 16:23", pinned to Asia/Jakarta so SSR and the browser agree.
  return formatDateTime(iso);
}

/**
 * Webhook `status` and `eventType` are internal/vendor strings. They were
 * rendered verbatim, so an admin read raw English enums ("PROCESSED",
 * "ERROR") and gateway event names ("payment_session.completed") as badge
 * text. Translate what we know; fall back to something Indonesian rather
 * than to the raw code. The untranslated original stays available in the
 * payload disclosure below for support.
 */
const WEBHOOK_STATUS_LABELS: Record<string, string> = {
  PROCESSED: "Diproses",
  ERROR: "Gagal",
  IGNORED: "Diabaikan",
};

const WEBHOOK_EVENT_LABELS: Record<string, string> = {
  "payment_session.completed": "Pembayaran selesai",
  "payment_session.expired": "Sesi kedaluwarsa",
  "manual.refresh.completed": "Perbarui manual · selesai",
  "manual.refresh.pending": "Perbarui manual · menunggu",
  "manual.refresh.expired": "Perbarui manual · kedaluwarsa",
  "manual.refresh.failed": "Perbarui manual · gagal",
  "doku.success": "DOKU · berhasil",
  "doku.pending": "DOKU · menunggu",
  "doku.failed": "DOKU · gagal",
  unknown: "Tidak dikenal",
};

function webhookEventLabel(eventType: string): string {
  if (WEBHOOK_EVENT_LABELS[eventType]) return WEBHOOK_EVENT_LABELS[eventType];
  if (eventType.startsWith("manual.refresh.")) return "Perbarui manual";
  if (eventType.startsWith("doku.")) return "DOKU";
  if (eventType.startsWith("payment_session.")) return "Sesi pembayaran";
  return "Aktivitas gateway";
}

function StatusPill({ status }: { status: string }) {
  // Use canonical status-*-subtle/-text token pairs per design-system §Status Badges
  // (matches components/ui/status-badge.tsx convention used everywhere else).
  if (status === "PROCESSED") {
    return (
      <Badge
        variant="outline"
        className="text-caption bg-status-present-subtle text-status-present-text border-transparent"
      >
        {WEBHOOK_STATUS_LABELS.PROCESSED}
      </Badge>
    );
  }
  if (status === "ERROR") {
    return (
      <Badge
        variant="outline"
        className="text-caption bg-status-absent-subtle text-status-absent-text border-transparent"
      >
        {WEBHOOK_STATUS_LABELS.ERROR}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-caption text-muted-foreground">
      {WEBHOOK_STATUS_LABELS[status] ?? "Tidak diproses"}
    </Badge>
  );
}

/**
 * `refreshKey` — bump to force a re-fetch. Used by the invoice detail page's
 * "Perbarui pembayaran" action, which can append a new `WebhookEvent` row that
 * this panel would otherwise not see until a full page reload.
 */
export function PaymentActivityCard({
  invoiceId,
  refreshKey = 0,
}: {
  invoiceId: string;
  refreshKey?: number;
}) {
  const [events, setEvents] = useState<WebhookEventRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invoices/${invoiceId}/webhook-events`);
        if (!res.ok) {
          if (!cancelled) setEvents([]);
          return;
        }
        const json = (await res.json()) as WebhookEventRow[];
        if (!cancelled) setEvents(json);
      } catch {
        if (!cancelled) setEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, refreshKey]);

  // Empty-state policy: hide entirely when zero events. Also hide while
  // loading (events === null) — the card has no skeleton state because
  // the 95%+ no-event case would flash a useless skeleton on every detail
  // view.
  if (!events || events.length === 0) return null;

  return (
    <Card className="p-card">
      <SectionHeading label={`Aktivitas Pembayaran (${events.length})`} />
      <TooltipProvider>
        <div className="space-y-3 mt-2">
          {events.map((evt) => {
            const showError = evt.status === "ERROR" || evt.status === "IGNORED";
            return (
              <div
                key={evt.id}
                className="border-b border-border/50 last:border-0 pb-3 last:pb-0"
              >
                {/* Line 1: paidAt + amount */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {formatPaidAt(evt.displayFields.paidAt)}
                  </span>
                  <span className="font-currency text-sm font-bold">
                    {evt.displayFields.amount != null
                      ? formatRupiah(evt.displayFields.amount)
                      : "—"}
                  </span>
                </div>

                {/* Line 2: event-type · status · method-or-error */}
                <div className="flex items-center flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-xs" title={evt.eventType}>
                    {webhookEventLabel(evt.eventType)}
                  </Badge>
                  <StatusPill status={evt.status} />
                  {showError && evt.errorLabel ? (
                    <span>{evt.errorLabel}</span>
                  ) : showError ? (
                    <span>Lihat detail di payload</span>
                  ) : evt.displayFields.paymentMethod === null ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="cursor-help underline decoration-dotted">
                            Metode: —
                          </span>
                        }
                      />
                      <TooltipContent>{METHOD_TOOLTIP}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <span>Metode: {paymentChannelLabel(evt.displayFields.paymentMethod)}</span>
                  )}
                </div>

                {/* Collapsible payload */}
                <details className="mt-2">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                    Lihat payload
                  </summary>
                  <pre className="mt-2 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-96 overflow-y-auto rounded-md bg-muted/50 p-2">
                    {JSON.stringify(evt.payload, null, 2)}
                  </pre>
                </details>
              </div>
            );
          })}
        </div>
      </TooltipProvider>
    </Card>
  );
}
