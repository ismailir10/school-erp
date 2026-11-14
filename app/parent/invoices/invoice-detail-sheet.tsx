"use client";

import { MESSAGES } from "@/lib/feedback";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  Banknote,
  Building2,
  Download,
  ExternalLink,
  FileText,
  Info,
  Landmark,
  MessageCircle,
  Phone,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { formatRupiah, formatDate, formatInvoicePeriod } from "@/lib/format";
import { Amount, AmountStatus } from "@/components/portal/amount";
import { SectionHeading } from "@/components/ui/section-heading";
import { SectionCard } from "@/components/ui/section-card";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { InvoiceDetailSkeleton } from "./invoice-detail-skeleton";
import { getTodayInTimezone, getYmdInTimezone } from "@/lib/attendance/timezone";
import { parentPaymentMethodLabel } from "@/lib/parent-payment-method";
import { hasReceipt } from "@/lib/finance/invoice-receipt";
import { telHref, whatsappHrefWithText } from "@/lib/contact";

/** Only ever send a parent to an https checkout; anything else is treated as "no usable link". */
function httpsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

type InvoiceLine = {
  id: string;
  labelSnapshot: string;
  amount: number;
  finalAmount: number;
  adjustmentAmount: number;
  adjustmentNote: string | null;
};

type Payment = {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
};

type InvoiceDetail = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  dueDate: string;
  totalDue: number;
  totalPaid: number;
  status: string;
  xenditPaymentUrl: string | null;
  /** School contact for invoices without a link; null when not configured. */
  schoolContactPhone?: string | null;
  sentAt: string | null;
  paidAt: string | null;
  lines: InvoiceLine[];
  payments: Payment[];
  student: {
    name: string;
    nickname: string | null;
    classSection: {
      name: string;
      program: { name: string };
    } | null;
  };
};

const METHOD_ICONS: Record<string, LucideIcon> = {
  CASH: Banknote,
  BANK_TRANSFER: Landmark,
  XENDIT: Building2,
  DOKU: Building2,
  OTHER: Building2,
};

export function InvoiceDetailSheet({
  open,
  onOpenChange,
  invoiceId,
  paymentPending = false,
  listStateKey,
  onRefreshStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
  /**
   * The gateway just sent the parent back with "sedang diperiksa" for this
   * invoice and nothing has changed since. The pay button is replaced by a note
   * so a second payment is not invited.
   */
  paymentPending?: boolean;
  /**
   * Opaque fingerprint of the list's view of this invoice (status + paid so
   * far). When it changes while the sheet is open the detail is re-fetched, so
   * a webhook that lands is reflected here without closing the sheet.
   */
  listStateKey?: string;
  /** Re-reads the invoice list from the server (the pending note's "Muat ulang status"). */
  onRefreshStatus?: () => void;
}) {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [prevInvoiceId, setPrevInvoiceId] = useState<string | null>(null);
  // The invoice a link request is in flight for (not a bare flag): the sheet is reused for
  // whichever invoice the parent opens next, and a response must only ever touch the invoice
  // that asked for it.
  const [requestingLinkFor, setRequestingLinkFor] = useState<string | null>(null);
  // Why the last try for a link failed, kept with the invoice it belongs to so it is never
  // shown on another one. Rendered inline in the pinned footer (a toast alone is gone in seconds).
  const [linkErrorState, setLinkErrorState] = useState<{ id: string; message: string } | null>(null);
  const shownInvoiceIdRef = useRef<string | null>(null);
  // Back from checkout via the bfcache restores this page mid-"navigating": free the button.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setRequestingLinkFor(null);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  useEffect(() => {
    shownInvoiceIdRef.current = invoice?.id ?? null;
  }, [invoice]);

  if (open && invoiceId && invoiceId !== prevInvoiceId) {
    setPrevInvoiceId(invoiceId);
    setLoading(true);
    setInvoice(null);

    fetch(`/api/guardian/invoices/${invoiceId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load invoice");
        return res.json();
      })
      .then((data) => {
        setInvoice(data);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Tagihan belum bisa dimuat. Coba lagi sebentar ya.");
        setLoading(false);
      });
  }

  if (!open && prevInvoiceId !== null) {
    setPrevInvoiceId(null);
    setInvoice(null);
    setLoading(false);
  }

  // Silent re-fetch when the list learns something new about the open invoice.
  const seenStateRef = useRef<{ id: string | null; key: string | undefined }>({ id: null, key: undefined });
  useEffect(() => {
    if (!open || !invoiceId) {
      seenStateRef.current = { id: null, key: undefined };
      return;
    }
    const seen = seenStateRef.current;
    if (seen.id !== invoiceId) {
      seenStateRef.current = { id: invoiceId, key: listStateKey };
      return;
    }
    if (seen.key === listStateKey) return;
    seenStateRef.current = { id: invoiceId, key: listStateKey };
    let cancelled = false;
    fetch(`/api/guardian/invoices/${invoiceId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setInvoice(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, invoiceId, listStateKey]);

  if (!invoiceId) return null;

  if (loading || !invoice) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/*
          `data-[side=right]:w-full` is load-bearing. SheetContent's base class
          sets `data-[side=right]:w-3/4`, and a data-attribute variant outranks
          a plain `w-full` from the call site — so this sheet rendered at 75%
          of the viewport on a phone, leaving a ~95px dead gutter and wrapping
          "Transfer bank (Virtual Account)" onto two lines. Same reason the
          desktop cap has to be written as `data-[side=right]:sm:max-w-md`.
        */}
        <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          <div className="p-card">
            <InvoiceDetailSkeleton />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // "Buat link pembayaran" / "Minta link baru": ask the server for a working
  // link on this invoice. It checks the gateway first when a link is held (an
  // expired one is cleared), returns a live link unchanged and makes a new one
  // only when there is none, so pressing it is always safe. Every message is
  // ours; nothing the server or gateway says is shown (voice.md).
  async function requestPaymentLink() {
    if (!invoice) return;
    const requestedId = invoice.id;
    const previousUrl = invoice.xenditPaymentUrl;
    // No link yet: this tap is the parent's "Bayar", so on success go straight to checkout.
    // Same tab on purpose: window.open after an await is popup-blocked on phones, and the
    // gateway's success/cancel return URL brings the parent back to /parent/invoices.
    const goToCheckout = !httpsUrl(previousUrl);
    // Once we hand the browser to checkout the button stays busy: clearing it would let a
    // second tap POST again while the page is still navigating away.
    let navigating = false;
    const fail = (message: string) => {
      setLinkErrorState({ id: requestedId, message });
      toast.error(message);
    };
    // The parent can close this sheet and open another invoice while the request is out. A
    // late answer for the first must not put ITS checkout link on the second (they would pay
    // a different invoice from the one on screen), nor toast about it.
    const stillShown = () => shownInvoiceIdRef.current === requestedId;
    setRequestingLinkFor(requestedId);
    setLinkErrorState((cur) => (cur?.id === requestedId ? null : cur));
    try {
      const res = await fetch(`/api/guardian/invoices/${requestedId}/payment-link`, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { paymentUrl?: string; created?: boolean };
      const url = httpsUrl(d.paymentUrl);
      if (res.ok && d.paymentUrl && !url) {
        if (stillShown()) fail("Link belum bisa dibuat. Coba lagi sebentar lagi, atau hubungi tata usaha.");
      } else if (res.ok && url) {
        if (stillShown() && goToCheckout) {
          navigating = true;
          window.location.assign(url);
        } else {
          setInvoice((prev) => (prev && prev.id === requestedId ? { ...prev, xenditPaymentUrl: url } : prev));
        }
        if (!navigating && stillShown()) {
          toast.success(
            previousUrl && !d.created
              ? "Link pembayaran masih berlaku. Silakan ketuk tombol Bayar."
              : "Link pembayaran sudah siap. Silakan ketuk tombol Bayar.",
          );
        }
      } else if (!stillShown()) {
        // Nothing to say about an invoice that is no longer on screen.
      } else if (res.status === 409) {
        toast.info("Tagihan ini sudah tidak bisa dibayar lewat link. Kami muat ulang statusnya.");
        onRefreshStatus?.();
      } else if (res.status === 429) {
        fail("Terlalu sering mencoba. Tunggu sebentar ya.");
      } else {
        fail("Link belum bisa dibuat. Coba lagi sebentar lagi, atau hubungi tata usaha.");
      }
    } catch {
      if (stillShown()) fail(MESSAGES.network);
    } finally {
      if (!navigating) setRequestingLinkFor((current) => (current === requestedId ? null : current));
    }
  }

  const requestingLink = requestingLinkFor === invoice.id;
  const remaining = invoice.totalDue - invoice.totalPaid;
  const isPaid = invoice.status === "PAID";
  const isCancelled = invoice.status === "CANCELLED";
  const isPayable = remaining > 0 && !isCancelled && !isPaid;
  // A parent who already transferred part of the SPP was shown the identical
  // "Belum Dibayar" treatment as someone who had paid nothing — only the
  // amount differed. Give the state its own label so the payment they already
  // made is visibly acknowledged.
  const isPartiallyPaid = !isPaid && !isCancelled && invoice.totalPaid > 0;
  // Same rule as the list rows: outstanding and due before today (Jakarta).
  const isOverdue = isPayable && invoice.dueDate.slice(0, 10) < getTodayInTimezone("Asia/Jakarta");
  const safePaymentUrl = httpsUrl(invoice.xenditPaymentUrl);
  const hasPaymentLink = !!safePaymentUrl;
  // No link to hand over: one tap creates it (idempotent server-side) and goes to checkout.
  const linkState = hasPaymentLink ? "ready" : "stale";
  const linkError = linkErrorState?.id === invoice.id ? linkErrorState.message : null;
  const payLabel = `Bayar ${formatRupiah(remaining)}`;
  const contactBox = (
    <div className="space-y-3 rounded-lg border border-status-late bg-status-late-subtle p-3 text-xs text-status-late-text" data-testid="contact-school">
      <div className="flex items-start gap-2">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Bila pembayaran belum bisa dibuka, silakan <strong>hubungi bagian tata usaha sekolah</strong> untuk info
          pembayaran dan sebutkan nomor tagihan <strong>{invoice.invoiceNumber}</strong>.
        </span>
      </div>
      {(() => {
        const message = `Assalamu'alaikum, saya ingin menanyakan pembayaran tagihan ${invoice.invoiceNumber} (${invoice.student.name}) sisa ${formatRupiah(remaining)}.`;
        const wa = whatsappHrefWithText(invoice.schoolContactPhone, message);
        const tel = telHref(invoice.schoolContactPhone);
        if (!wa && !tel) return null;
        return (
          <div className="flex flex-wrap gap-2">
            {wa ? (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground">
                <MessageCircle size={16} aria-hidden="true" /> Hubungi via WhatsApp
              </a>
            ) : null}
            {tel ? (
              <a href={tel} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground">
                <Phone size={16} aria-hidden="true" /> Telepon sekolah
              </a>
            ) : null}
          </div>
        );
      })()}
    </div>
  );
  const focalAmount = isPaid ? invoice.totalDue : remaining;
  const childName = invoice.student.nickname ?? invoice.student.name.split(" ")[0];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Header / scrolling body / pinned footer: the sheet itself never scrolls, so the pay
          button stays on screen. */}
      <SheetContent className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        {/* The Frame 6/7 drag-handle bar is gone: this is a side sheet, not a
            bottom sheet, so the handle advertised a drag gesture that does not
            exist. The Lainnya overflow surface is a real bottom Drawer and
            keeps its handle. */}
        <SheetHeader className="border-b border-border pb-3">
          <SheetTitle className="text-sm font-medium text-foreground">
            Tagihan {formatInvoicePeriod(invoice.periodLabel)}
            <span className="ml-1 text-muted-foreground">· {childName}</span>
          </SheetTitle>
          <p className="text-xs text-muted-foreground">{invoice.invoiceNumber}</p>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-card pb-card pt-4">
          {/* Focal amount card */}
          <SectionCard as="div">
            {/* PAR-8: name what the big number is. */}
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {isPaid || isCancelled ? "Total tagihan" : "Sisa tagihan"}
            </p>
            <Amount
              value={focalAmount}
              size="display"
              tone={isPaid ? "paid" : "neutral"}
            />
            {/* Status is a chip beside the figure, not a second uppercase shout
                on top of a coloured number. Sentence case per voice.md. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
              {isPaid ? (
                <>
                  <AmountStatus tone="paid">Lunas</AmountStatus>
                  {invoice.paidAt ? (
                    <span>
                      Dibayar{" "}
                      {formatDate(getYmdInTimezone(new Date(invoice.paidAt), "Asia/Jakarta"), { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                  ) : null}
                </>
              ) : isCancelled ? (
                <AmountStatus tone="cancelled">Dibatalkan</AmountStatus>
              ) : isPartiallyPaid ? (
                <>
                  <AmountStatus tone="partial">Dibayar sebagian</AmountStatus>
                  {isOverdue ? <AmountStatus tone="overdue">Lewat tempo</AmountStatus> : null}
                  <span>
                    Jatuh tempo{" "}
                    <b className="text-foreground">
                      {formatDate(invoice.dueDate, { day: "numeric", month: "long", year: "numeric" })}
                    </b>
                  </span>
                </>
              ) : (
                <>
                  {isOverdue ? (
                    <AmountStatus tone="overdue">Lewat tempo</AmountStatus>
                  ) : (
                    <AmountStatus tone="due">Belum dibayar</AmountStatus>
                  )}
                  <span>
                    Jatuh tempo{" "}
                    <b className="text-foreground">
                      {formatDate(invoice.dueDate, { day: "numeric", month: "long", year: "numeric" })}
                    </b>
                  </span>
                </>
              )}
            </div>
          </SectionCard>

          {/* Rincian */}
          <section>
            <SectionHeading>Rincian</SectionHeading>
            <ul>
              {invoice.lines.map((line) => (
                <li
                  key={line.id}
                  className="flex items-center justify-between gap-3 border-b border-border/50 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{line.labelSnapshot}</p>
                    {line.adjustmentAmount !== 0 ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Penyesuaian: {formatRupiah(line.adjustmentAmount)}
                        {line.adjustmentNote ? ` (${line.adjustmentNote})` : ""}
                      </p>
                    ) : null}
                  </div>
                  <Amount value={line.finalAmount} size="line" className="shrink-0" />
                </li>
              ))}
            </ul>
            {/* PAR-8: Total / Sudah dibayar / Sisa, always in that order. */}
            <dl className="mt-1 space-y-1.5 border-t border-border pt-3 text-sm" data-testid="invoice-totals">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Total tagihan</dt>
                <dd><Amount value={invoice.totalDue} size="line" /></dd>
              </div>
              {invoice.totalPaid > 0 ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Sudah dibayar</dt>
                  <dd><Amount value={invoice.totalPaid} size="line" tone="paid" /></dd>
                </div>
              ) : null}
              {remaining > 0 && !isCancelled ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="font-medium text-foreground">Sisa tagihan</dt>
                  <dd><Amount value={remaining} size="line" /></dd>
                </div>
              ) : null}
            </dl>
          </section>

          {/* Cara bayar — only with a live payment link. Without one the card named
              Virtual Account banks but there was no VA number to pay to; the
              "hubungi admin" note below is the guidance then (PARX-1). */}
          {isPayable && hasPaymentLink && !paymentPending ? (
            <section>
              <SectionHeading>Cara bayar</SectionHeading>
              <SectionCard as="div">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-lg bg-secondary text-primary-text">
                    <Building2 size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">Transfer bank (Virtual Account)</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      BCA · Mandiri · BRI · BNI · Permata · CIMB
                    </p>
                  </div>
                </div>
              </SectionCard>
            </section>
          ) : null}

          {/* Bukti pembayaran — once money has been received (fully or in part) */}
          {hasReceipt(invoice) ? (
            <section>
              <SectionHeading>Bukti pembayaran</SectionHeading>
              <a
                href={`/api/guardian/invoices/${invoice.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30"
              >
                <div className="grid size-10 place-items-center rounded-lg bg-secondary text-primary-text">
                  <FileText size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">Kuitansi.pdf</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {isPartiallyPaid
                      ? "Bukti pembayaran sebagian"
                      : invoice.paidAt
                        ? `Diterbitkan ${formatDate(invoice.paidAt, { day: "numeric", month: "long", year: "numeric" })}`
                        : "Diterbitkan"}
                  </p>
                </div>
                <Download size={16} className="shrink-0 text-muted-foreground" />
              </a>
            </section>
          ) : null}

          {/* Payment history (paid invoices with multiple payment events) */}
          {invoice.payments.length > 0 ? (
            <section>
              <SectionHeading>Riwayat pembayaran</SectionHeading>
              <ul className="space-y-2">
                {invoice.payments.map((p) => {
                  const Icon = METHOD_ICONS[p.method] ?? Building2;
                  return (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
                    >
                      <div className="grid size-10 place-items-center rounded-lg bg-status-present-subtle text-status-present-text">
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">
                          {parentPaymentMethodLabel(p.method)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {/* The admin's reference ("Cicilan-1", transfer no.) is
                              internal bookkeeping, not something a wali needs. */}
                          {formatDate(p.paidAt, { day: "numeric", month: "long", year: "numeric" })}
                        </p>
                      </div>
                      <Amount value={p.amount} size="row" tone="paid" className="shrink-0" />
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {/* No link and the school may have to help: the contact box lives in the
              scrolling body until a try fails, then it moves into the pinned footer
              beside the error (one copy at a time, same testid). */}
          {isPayable && !paymentPending && !hasPaymentLink && !linkError ? contactBox : null}
        </div>

        {/* One pinned pay action. Outside the scrolling body so "Bayar Rp …" is
            on screen at 390x844 however long the Rincian gets. */}
        {isPayable ? (
          <SheetFooter
            data-testid="invoice-sheet-footer"
            className="max-h-[60dvh] overflow-y-auto border-t border-border bg-popover px-card pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            {paymentPending ? (
              <div
                role="status"
                className="space-y-3 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"
                data-testid="payment-pending"
              >
                <div className="flex items-start gap-2">
                  <Info size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Pembayaran sedang diperiksa. Status akan diperbarui otomatis — tidak perlu bayar lagi.
                  </span>
                </div>
                {onRefreshStatus ? (
                  <Button type="button" variant="outline" className="w-full" onClick={onRefreshStatus}>
                    <RefreshCw size={16} className="mr-2" />
                    Muat ulang status
                  </Button>
                ) : null}
              </div>
            ) : linkState === "ready" ? (
              <>
                {/* A real link, tapped by the parent: target=_blank is not popup-blocked. */}
                <a
                  href={safePaymentUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ size: "lg" }), "w-full")}
                >
                  <ExternalLink size={16} className="mr-2" aria-hidden="true" />
                  {payLabel}
                </a>
                {linkError ? (
                  <p role="alert" className="text-xs text-status-late-text">{linkError}</p>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  onClick={requestPaymentLink}
                  disabled={requestingLink}
                  aria-busy={requestingLink}
                >
                  {requestingLink ? "Memeriksa link…" : "Link tidak bisa dibuka? Minta link baru"}
                </Button>
              </>
            ) : (
              <>
                {linkError ? (
                  <p role="alert" className="text-sm text-status-late-text" data-testid="pay-error">{linkError}</p>
                ) : null}
                <Button
                  type="button"
                  className="w-full"
                  size="lg"
                  onClick={requestPaymentLink}
                  disabled={requestingLink}
                  aria-busy={requestingLink}
                >
                  {requestingLink ? (
                    <>
                      <Spinner aria-hidden className="mr-2" />
                      Menyiapkan pembayaran…
                    </>
                  ) : linkError ? (
                    "Coba lagi"
                  ) : (
                    <>
                      <ExternalLink size={16} className="mr-2" aria-hidden="true" />
                      {payLabel}
                    </>
                  )}
                </Button>
                {linkError ? contactBox : null}
              </>
            )}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
