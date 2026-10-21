"use client";

import { useEffect, useId, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { DetailPageHeader, type DetailPageHeaderAction } from "@/components/admin/detail-page-header";
import { DetailPageSkeleton } from "@/components/admin/detail-page-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { RupiahInput } from "@/components/ui/rupiah-input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { PaymentActivityCard } from "@/components/admin/invoices/payment-activity-card";
import { PaymentProblemsAlert, type PaymentProblemView } from "@/components/admin/invoices/payment-problems-alert";
import { parsePaymentLinkError } from "@/lib/payments/error-prefix";
import { Textarea } from "@/components/ui/textarea";
import { Ban, CreditCard, FileText, Link2, Phone, Mail, AlertTriangle, RefreshCw, Undo2, MessageCircle } from "lucide-react";
import { canRemindInvoice, invoiceReminderWaUrl } from "@/lib/finance/invoice-reminder";
import { stampReminder } from "@/lib/finance/stamp-reminder";
import { userMessage } from "@/lib/api/client-errors";
import { toast } from "sonner";
import { formatRupiah, formatDateShort, formatDateTime, formatRelativeTime } from "@/lib/format";
import { paymentLinkExpiryState } from "@/lib/finance/payment-link-expiry";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { MANUAL_PAYMENT_METHODS, isGatewayPayment, paymentMethodLabel } from "@/lib/constants/payment-methods";
import { cn } from "@/lib/utils";
import { invoicePaymentFormSchema } from "@/lib/validations/invoice";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { hasReceipt } from "@/lib/finance/invoice-receipt";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";

// Same `Control` extraction `useZodForm` produces (input values in, the
// schema's parsed output out) — `payForm.control`'s exact type, so
// `PaymentFormBody` and `FormField` agree on it without re-deriving it by hand.
type PaymentFormControl = ReturnType<typeof useZodForm<typeof invoicePaymentFormSchema>>["control"];

type InvoiceLine = { id: string; labelSnapshot: string; amount: number; adjustmentAmount: number; adjustmentNote: string | null; finalAmount: number; feeComponent: { code: string; category: string } };
type Payment = {
  id: string; amount: number; method: string; channelCode?: string | null; reference: string | null; notes: string | null; paidAt: string;
  idempotencyKey?: string | null;
  status: string; xenditPaymentId?: string | null; createdBy: string | null; createdByName: string | null;
};
type InvoiceDetail = {
  capabilities: import("@/lib/finance/invoice-capabilities").InvoiceCapabilities;
  id: string; invoiceNumber: string; periodLabel: string; dueDate: string;
  totalDue: number; totalPaid: number; status: string; xenditPaymentUrl: string | null; paymentLinkExpiresAt?: string | null;
  paymentLinkError: string | null;
  lastRemindedAt?: string | null; remindCount?: number; lastRemindedByName?: string | null;
  student: { name: string; nickname: string | null; guardians: { parent: { name: string; phone: string | null; email: string | null; whatsapp: string | null } }[] };
  lines: InvoiceLine[]; payments: Payment[];
  /** Gateway payments the app did not credit (or credited past the balance): money to reconcile by hand. */
  paymentProblems?: PaymentProblemView[];
};

// ------------------------------------------------------------------
// Payment Form Body (shared between Dialog + Sheet)
// ------------------------------------------------------------------

function PaymentFormBody({
  control,
  remaining,
  today,
}: {
  control: PaymentFormControl;
  remaining: number;
  /** YYYY-MM-DD in Asia/Jakarta — the latest selectable payment date. */
  today: string;
}) {
  return (
    <>
      <FormField
        control={control}
        name="amount"
        label="Jumlah"
        required
        id="invoice-payment-amount"
        description={`Sisa tagihan: ${formatRupiah(remaining)}`}
        render={({ field, controlProps }) => (
          <RupiahInput {...controlProps} value={field.value ?? null} onChange={field.onChange} onBlur={field.onBlur} />
        )}
      />
      <FormField
        control={control}
        name="paidAt"
        label="Tanggal bayar"
        required
        id="invoice-payment-date"
        description="Isi tanggal terima uangnya jika pembayaran sudah masuk sebelum hari ini."
        render={({ field, controlProps }) => (
          <DatePicker {...controlProps} value={field.value ?? ""} onChange={field.onChange} max={today} />
        )}
      />
      <FormField
        control={control}
        name="method"
        label="Metode Pembayaran"
        id="invoice-payment-method"
        render={({ field, controlProps }) => (
          <Select value={field.value} onValueChange={(v) => v && field.onChange(v)}>
            <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue /></SelectTrigger>
            <SelectContent>
              {MANUAL_PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {paymentMethodLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FormField
        control={control}
        name="reference"
        label="Referensi"
        id="invoice-payment-reference"
        description="Nomor transfer, ID transaksi, dll."
        render={({ field, controlProps }) => (
          <Input {...field} {...controlProps} value={field.value ?? ""} placeholder="Opsional" />
        )}
      />
      <FormField
        control={control}
        name="notes"
        label="Catatan"
        id="invoice-payment-notes"
        render={({ field, controlProps }) => (
          <Input {...field} {...controlProps} value={field.value ?? ""} placeholder="Opsional" />
        )}
      />
    </>
  );
}

// ------------------------------------------------------------------
// Review step — the mandatory confirmation before a payment is recorded.
// ------------------------------------------------------------------

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-right font-medium min-w-0 break-words">{children}</dd>
    </div>
  );
}

function PaymentReview({
  invoice,
  amount,
  method,
  paidAt,
  reference,
  notes,
  remaining,
}: {
  invoice: Pick<InvoiceDetail, "invoiceNumber" | "student" | "dueDate">;
  amount: number;
  method: string;
  paidAt: string;
  reference: string;
  notes: string;
  remaining: number;
}) {
  const settles = amount >= remaining;
  // Same rule the server applies: still owing after the due date is Lewat Tempo.
  const owingStatus = invoice.dueDate < getTodayInTimezone("Asia/Jakarta") ? "OVERDUE" : "PARTIALLY_PAID";
  return (
    <div className="space-y-field" data-testid="payment-review">
      <p className="text-sm text-muted-foreground">
        Periksa kembali sebelum dicatat. Pembayaran yang salah catat masih bisa dibatalkan dengan alasan, tetapi tercatat di riwayat.
      </p>
      <dl className="divide-y divide-border rounded-lg border border-border">
        <ReviewRow label="Tagihan"><span className="font-currency">{invoice.invoiceNumber}</span></ReviewRow>
        <ReviewRow label="Siswa">{invoice.student.name}</ReviewRow>
        <ReviewRow label="Jumlah">
          <span className="font-currency text-base font-bold" data-testid="payment-review-amount">{formatRupiah(amount)}</span>
        </ReviewRow>
        <ReviewRow label="Metode">{paymentMethodLabel(method)}</ReviewRow>
        <ReviewRow label="Tanggal bayar">{formatDateShort(paidAt)}</ReviewRow>
        {reference.trim() && <ReviewRow label="Referensi">{reference.trim()}</ReviewRow>}
        {notes.trim() && <ReviewRow label="Catatan">{notes.trim()}</ReviewRow>}
        <ReviewRow label="Status setelah dicatat">
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            <StatusBadge status={settles ? "PAID" : owingStatus} />
            {!settles && (
              <span className="text-xs text-muted-foreground">Sisa <span className="font-currency">{formatRupiah(remaining - amount)}</span></span>
            )}
          </span>
        </ReviewRow>
      </dl>
    </div>
  );
}

/**
 * Second line of the payment-link block (cycle 2026-10-20-payment-link-expiry-display).
 * The state decision lives in `paymentLinkExpiryState` so the list column agrees; this
 * only renders it. The whole block is hidden for PAID / CANCELLED invoices, so those
 * never reach here.
 */
function PaymentLinkExpiryLine({ invoice }: { invoice: Pick<InvoiceDetail, "status" | "xenditPaymentUrl" | "paymentLinkExpiresAt"> }) {
  const state = paymentLinkExpiryState({
    status: invoice.status,
    xenditPaymentUrl: invoice.xenditPaymentUrl,
    paymentLinkExpiresAt: invoice.paymentLinkExpiresAt ?? null,
  });
  if (!state) return null;
  const when = invoice.paymentLinkExpiresAt ? `${formatDateTime(invoice.paymentLinkExpiresAt)} WIB` : null;
  if (state === "unrecorded") {
    return <p className="mt-1 text-xs text-muted-foreground">Tanggal berlaku belum tercatat</p>;
  }
  if (state === "expired") {
    return (
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        <span className="font-medium text-status-absent-text">Kedaluwarsa</span>
        {when ? ` · ${when}` : null}
      </p>
    );
  }
  return <p className="mt-1 text-xs tabular-nums text-muted-foreground">Berlaku sampai {when}</p>;
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState(false);
  // "form" -> "review": recording a payment is a two-step action; nothing is
  // POSTed until the admin has read the review and pressed the confirm button.
  const [payStep, setPayStep] = useState<"form" | "review">("form");
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const paymentSubmittingRef = useRef(false);
  const paymentAttemptRef = useRef<string | null>(null);
  const [reverseTarget, setReverseTarget] = useState<Payment | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [voidBlockedOpen, setVoidBlockedOpen] = useState(false);
  const paymentFormId = useId();
  const payForm = useZodForm(invoicePaymentFormSchema, {
    defaultValues: { amount: null, method: "CASH", reference: "", notes: "", paidAt: getTodayInTimezone("Asia/Jakarta") },
  });
  const [creatingXendit, setCreatingXendit] = useState(false);
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [refreshingPayment, setRefreshingPayment] = useState(false);
  const [replaceLinkOpen, setReplaceLinkOpen] = useState(false);
  const [replacingLink, setReplacingLink] = useState(false);
  // Bumped after a manual refresh so the activity panel re-fetches — a
  // reconciliation can append a WebhookEvent row the panel would otherwise
  // miss until a full page reload.
  const [activityKey, setActivityKey] = useState(0);

  const fetchInvoice = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/invoices/${id}`);
      if (res.status === 404 || res.status === 403) { setInvoice(null); return; }
      if (!res.ok) throw new Error("invoice unavailable");
      const loaded: InvoiceDetail = await res.json();
      setInvoice(loaded);
      // A reload can resolve an earlier unknown response from recorded history.
      // Only release its key when the server confirms that exact attempt exists.
      try {
        const storageKey = `manual-payment-attempt:${id}`;
        const key = sessionStorage.getItem(storageKey);
        if (key && loaded.payments.some((p) => p.idempotencyKey === key)) {
          sessionStorage.removeItem(storageKey);
          paymentAttemptRef.current = null;
        }
      } catch { /* storage can be unavailable */ }
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchInvoice(); }, [fetchInvoice]);

  // The "Chat WhatsApp" anchor stamps the reminder from its click handler, which
  // never calls preventDefault: the new tab has to open synchronously or mobile
  // browsers block it. A failed stamp toasts; WhatsApp has opened anyway.
  // A second tap while the stamp is in flight still opens the link but does not POST again.
  const stampingRef = useRef(false);
  const handleStampReminder = useCallback(() => {
    if (stampingRef.current) return;
    stampingRef.current = true;
    stampReminder(id)
      .then((stamp) =>
        setInvoice((prev) =>
          prev ? { ...prev, lastRemindedAt: stamp.lastRemindedAt, remindCount: stamp.remindCount, lastRemindedByName: "Anda" } : prev,
        ),
      )
      .catch((err) => toast.error(userMessage(err, "Pengingat belum tercatat.")))
      .finally(() => { stampingRef.current = false; });
  }, [id]);

  // R2-ADMIN-12: the invoices list row menu links here with ?bayar=1 so
  // "Catat Pembayaran" lands straight in the existing dialog. Honoured once,
  // after the invoice has loaded, then stripped so a refresh does not reopen it.
  const autoOpenedPayment = useRef(false);
  useEffect(() => {
    if (!invoice || autoOpenedPayment.current) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("bayar") !== "1") return;
    autoOpenedPayment.current = true;
    url.searchParams.delete("bayar");
    window.history.replaceState(window.history.state, "", url.toString());
    if (invoice.status === "PAID" || invoice.status === "CANCELLED" || !invoice.capabilities?.recordPayment) return;
    payForm.reset({
      amount: Number(invoice.totalDue) - Number(invoice.totalPaid),
      method: "CASH",
      reference: "",
      notes: "",
      paidAt: getTodayInTimezone("Asia/Jakarta"),
    });
    setPayStep("form");
    setPaymentDialog(true);
    // payForm is stable (react-hook-form); only the loaded invoice matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice]);

  // Step 1 -> 2: validate the form, then show the review. No request yet.
  const handleReviewPayment = payForm.handleSubmit((values) => {
    const due = invoice ? Number(invoice.totalDue) - Number(invoice.totalPaid) : 0;
    if (values.amount !== null && values.amount > due) {
      payForm.setError(
        "amount",
        { type: "validate", message: `Jumlah pembayaran (${formatRupiah(values.amount)}) melebihi sisa tagihan (${formatRupiah(due)})` },
        { shouldFocus: true },
      );
      return;
    }
    setPayStep("review");
  });

  // Step 2: the only place the POST happens.
  async function handleConfirmPayment() {
    if (paymentSubmittingRef.current) return;
    paymentSubmittingRef.current = true;
    setSubmittingPayment(true);
    try {
      // Keep the same attempt through a lost response, closing the dialog,
      // and a reload in this tab. Store only an opaque key, never pupil data.
      const storageKey = `manual-payment-attempt:${id}`;
      if (!paymentAttemptRef.current) {
        try { paymentAttemptRef.current = sessionStorage.getItem(storageKey); } catch { /* storage can be unavailable */ }
        paymentAttemptRef.current ??= crypto.randomUUID();
      }
      try { sessionStorage.setItem(storageKey, paymentAttemptRef.current); } catch { /* in-memory retries still work */ }
      await sendJson(`/api/invoices/${id}/payments`, {
        method: "POST", body: { ...payForm.getValues(), idempotencyKey: paymentAttemptRef.current },
      }, "Hasil pencatatan belum dapat dipastikan. Coba lagi dengan rincian yang sama agar pembayaran tidak tercatat dua kali.");
      paymentAttemptRef.current = null;
      try { sessionStorage.removeItem(storageKey); } catch { /* storage can be unavailable */ }
      toast.success("Pembayaran dicatat");
      closePaymentDialog();
      fetchInvoice();
    } catch (err) {
      // Back to the form so the server's field error (e.g. overpayment) is
      // shown next to the field it belongs to.
      setPayStep("form");
      applyServerErrors(payForm, err, "Hasil pencatatan belum dapat dipastikan. Coba lagi dengan rincian yang sama agar pembayaran tidak tercatat dua kali.");
    } finally {
      paymentSubmittingRef.current = false;
      setSubmittingPayment(false);
    }
  }

  function closePaymentDialog() {
    setPaymentDialog(false);
    setPayStep("form");
  }

  async function handleReversePayment() {
    if (!reverseTarget) return;
    const reason = reverseReason.trim();
    if (reason.length < 5) {
      setReverseError("Alasan wajib diisi (minimal 5 karakter)");
      throw new Error("reason required"); // keep the confirm dialog open
    }
    try {
      await sendJson(
        `/api/invoices/${id}/payments/${reverseTarget.id}/reverse`,
        { method: "POST", body: { reason } },
        "Gagal membatalkan pembayaran",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membatalkan pembayaran");
      setReverseError(err instanceof Error ? err.message : "Gagal membatalkan pembayaran");
      throw err; // keep the confirm dialog open so the reason is not lost
    }
    toast.success("Pembayaran dibatalkan");
    setReverseTarget(null);
    setActivityKey((k) => k + 1);
    fetchInvoice();
  }

  async function handleCreateXenditLink() {
    setCreatingXendit(true);
    const res = await fetch("/api/xendit/create-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId: id }),
    });
    if (res.ok) {
      const d = await res.json();
      // /api/xendit/create-session is batch-shaped: it answers 200 with
      // {created, failed, results[], errors[]} even when THIS invoice's link
      // failed, and never returns a top-level paymentUrl. Branching on res.ok
      // alone claimed both "link dibuat" and "disalin ke clipboard" on every
      // call while the clipboard write silently never ran.
      const paymentUrl: string | undefined = d.results?.[0]?.paymentUrl;
      if (d.created > 0 && paymentUrl) {
        toast.success("Link pembayaran dibuat");
        try {
          await navigator.clipboard.writeText(paymentUrl);
          toast.info("Link disalin ke clipboard — kirim via WhatsApp");
        } catch {
          // Clipboard can be blocked by permissions or a non-secure context.
          // Never claim a copy that didn't happen.
          toast.info("Link pembayaran siap disalin dari detail tagihan.");
        }
      } else {
        toast.error(d.errors?.[0] ?? "Gagal membuat link pembayaran");
      }
      fetchInvoice();
    } else {
      const d = await res.json();
      toast.error(d.error || "Gagal membuat link pembayaran");
    }
    setCreatingXendit(false);
  }

  async function handleRetryLink() {
    setRetrying(true);
    try {
      const res = await fetch("/api/invoices/retry-payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: [id] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error || "Gagal mencoba ulang link");
        return;
      }
      const out = await res.json();
      if (out.succeeded > 0) {
        toast.success("Link pembayaran berhasil dibuat");
      } else {
        // Never splice the raw "<prefix>: <vendor message>" into a toast —
        // the humanised sentence goes here, the raw detail stays on the
        // invoice's paymentLinkError disclosure.
        const parsed = parsePaymentLinkError(out.results?.[0]?.error);
        toast.error(parsed ? `Masih gagal. ${parsed.userMessage}` : "Masih gagal membuat link pembayaran.");
      }
      fetchInvoice();
    } finally {
      setRetrying(false);
    }
  }

  /**
   * Manual payment reconciliation — asks the server to poll the payment
   * gateway and apply whatever it reports, using the same transitions the
   * webhook performs. The fallback for a webhook that never fired.
   *
   * Safe to click repeatedly; the server side is idempotent. The toast
   * distinguishes "we changed something" from "nothing to change" so a
   * no-op click never reads as a success.
   */
  async function handleRefreshPayment() {
    setRefreshingPayment(true);
    try {
      const res = await fetch(`/api/invoices/${id}/refresh-payment`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Gagal memeriksa status pembayaran");
        return;
      }
      if (d.code === "UPDATED") toast.success(d.message);
      else if (d.code === "GATEWAY_ERROR" || d.code === "UNAVAILABLE" || d.code === "NEEDS_REVIEW") toast.warning(d.message);
      else toast.info(d.message);
      await fetchInvoice();
      setActivityKey((k) => k + 1);
    } catch {
      toast.error("Gagal memeriksa status pembayaran");
    } finally {
      setRefreshingPayment(false);
    }
  }

  /**
   * "Buat link baru" — swap the stored link for a fresh one. The server asks the gateway
   * first: a payment already made is recorded instead (outcome PAID, no new link), and an
   * unreadable gateway leaves the old link alone. Every outcome ends the dialog and reloads,
   * because even a failed replacement can have dropped the old link.
   */
  async function handleReplaceLink() {
    setReplacingLink(true);
    try {
      const res = await fetch(`/api/invoices/${id}/replace-payment-link`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Link baru belum berhasil dibuat. Coba lagi sebentar lagi.");
      } else if (d.outcome === "PAID") {
        toast.success(d.message);
      } else {
        toast.success("Link baru siap. Kirim ke wali lewat WhatsApp.");
      }
      // Close before the reload swaps the page for its skeleton and unmounts the dialog.
      setReplaceLinkOpen(false);
      setActivityKey((k) => k + 1);
      await fetchInvoice();
    } catch {
      toast.error("Link baru belum berhasil dibuat. Periksa koneksi lalu coba lagi.");
      setReplaceLinkOpen(false);
      // The request may have reached the server before the connection dropped.
      await fetchInvoice();
    } finally {
      setReplacingLink(false);
    }
  }

  async function handleVoidInvoice() {
    setVoiding(true);
    const res = await fetch(`/api/invoices/${id}/void`, { method: "POST" });
    if (res.ok) {
      toast.success("Tagihan dibatalkan");
      setVoidConfirmOpen(false);
      fetchInvoice();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal membatalkan tagihan");
    }
    setVoiding(false);
  }

  if (loading) return <DetailPageSkeleton />;
  if (loadError) return <EmptyState title="Tagihan belum dapat dimuat" description="Periksa koneksi dan coba lagi. Pembayaran tidak diubah." actionLabel="Coba lagi" onAction={fetchInvoice} />;
  if (!invoice) return <EmptyState title="Tagihan tidak ditemukan" description="Data tagihan tidak tersedia dengan akses Anda." actionLabel="Kembali ke daftar tagihan" actionHref="/admin/invoices" />;

  const guardianEntry = invoice.student.guardians[0];
  const guardian = guardianEntry?.parent;
  const remaining = Number(invoice.totalDue) - Number(invoice.totalPaid);
  // Chasing an unpaid invoice: one tap opens WhatsApp on the wali's number with the
  // reminder written. The DOKU link goes in when there is one; otherwise the portal,
  // where the wali can pay. Only for a billed invoice with money left.
  const canRemind = canRemindInvoice({ status: invoice.status, remaining });
  const reminderUrl = canRemind
    ? invoiceReminderWaUrl({
        guardian,
        studentName: invoice.student.name,
        invoiceNumber: invoice.invoiceNumber,
        periodLabel: invoice.periodLabel,
        remaining,
        payUrl: invoice.xenditPaymentUrl ?? `${window.location.origin}/parent/invoices`,
      })
    : null;
  // Money already on the invoice blocks a cancel (the API enforces it too): the
  // menu item stays visible so the admin gets the reason instead of a missing
  // action, but it opens an explanation rather than the confirm (FIN-9).
  const activePayments = invoice.payments.filter((p) => p.status !== "REVERSED" && Number(p.amount) > 0);
  const paidOnInvoice = Math.max(
    activePayments.reduce((sum, p) => sum + Number(p.amount), 0),
    Number(invoice.totalPaid),
  );
  const hasActivePayments = paidOnInvoice > 0;
  const canVoid = invoice.capabilities?.void && invoice.status !== "CANCELLED";
  // Only meaningful once a checkout exists at the gateway. A CANCELLED
  // invoice is terminal — the processor refuses to credit it either way, so
  // offering the action would only produce a confusing no-op.
  // Nor is there anything left to fetch once it is Lunas (FIN-20).
  const canRefreshPayment = invoice.capabilities?.recordPayment &&
    !!invoice.xenditPaymentUrl && invoice.status !== "CANCELLED" && invoice.status !== "PAID";

  // Only while the link can still be paid: the server answers 409 for anything else.
  const canReplaceLink = !!invoice.capabilities?.create && !!invoice.xenditPaymentUrl &&
    (UNPAID_INVOICE_STATUSES as readonly string[]).includes(invoice.status) && remaining > 0;

  // FINX-9: the same kuitansi a guardian downloads, once money has landed.
  // A plain new-tab open — the route answers with a PDF, not a page to
  // client-navigate to. On a Lunas invoice nothing else competes for the
  // header, so it sits there; a partly paid one (Dibayar Sebagian or Lewat
  // Tempo) already has up to two buttons, so it goes in the overflow menu.
  const receiptAction: DetailPageHeaderAction | null =
    invoice.capabilities?.recordPayment && hasReceipt(invoice)
      ? {
          label: "Unduh kuitansi",
          icon: <FileText size={14} aria-hidden="true" />,
          onClick: () => window.open(`/api/invoices/${id}/pdf`, "_blank", "noopener"),
          testId: "invoice-receipt-btn",
        }
      : null;

  return (
    <>
      <DetailPageHeader
        backHref="/admin/invoices"
        backLabel="Kembali ke Daftar Tagihan"
        title={`${invoice.invoiceNumber}`}
        description={`${invoice.student.name} · ${invoice.periodLabel}`}
        badge={<StatusBadge status={invoice.status} />}
        primaryActions={[
          // canRefreshPayment requires an existing xenditPaymentUrl, and "Buat
          // Link Pembayaran" requires its absence, so at most one of the two
          // renders — together with the recordPayment action that's never
          // more than 2 visible buttons.
          ...(canRefreshPayment
            ? [
                {
                  label: refreshingPayment ? "Memeriksa..." : "Cek status pembayaran",
                  icon: (
                    <RefreshCw
                      size={14}
                      aria-hidden="true"
                      className={refreshingPayment ? "animate-spin" : ""}
                    />
                  ),
                  onClick: handleRefreshPayment,
                  disabled: refreshingPayment,
                  testId: "invoice-refresh-payment-btn",
                } satisfies DetailPageHeaderAction,
              ]
            : []),
          ...(invoice.status !== "PAID" &&
          invoice.status !== "CANCELLED" &&
          invoice.capabilities?.create &&
          !invoice.xenditPaymentUrl
            ? [
                {
                  label: creatingXendit ? "Membuat..." : "Buat Link Pembayaran",
                  onClick: handleCreateXenditLink,
                  disabled: creatingXendit,
                } satisfies DetailPageHeaderAction,
              ]
            : []),
          ...(invoice.status !== "PAID" && invoice.status !== "CANCELLED" && invoice.capabilities?.recordPayment
            ? [
                {
                  label: "Catat Pembayaran",
                  icon: <CreditCard size={14} aria-hidden="true" />,
                  onClick: () => {
                    // Prefilled with the whole balance for convenience — the
                    // review step is what stops a stray click from booking it.
                    payForm.reset({ amount: remaining, method: "CASH", reference: "", notes: "", paidAt: getTodayInTimezone("Asia/Jakarta") });
                    setPayStep("form");
                    setPaymentDialog(true);
                  },
                  // The header's one filled (non-outline) action — recording
                  // a payment is the single highest-value thing to do here.
                  variant: "default",
                } satisfies DetailPageHeaderAction,
              ]
            : []),
          ...(receiptAction && invoice.status === "PAID" ? [receiptAction] : []),
        ]}
        menuActions={[
          ...(canReplaceLink
            ? [
                {
                  label: "Buat link baru",
                  icon: <Link2 size={14} aria-hidden="true" />,
                  onClick: () => setReplaceLinkOpen(true),
                  disabled: replacingLink,
                  testId: "invoice-replace-link-btn",
                } satisfies DetailPageHeaderAction,
              ]
            : []),
          ...(receiptAction && invoice.status !== "PAID" ? [receiptAction] : []),
          ...(canVoid
            ? [
                {
                  label: "Batalkan Tagihan",
                  icon: <Ban size={14} aria-hidden="true" />,
                  onClick: () => (hasActivePayments ? setVoidBlockedOpen(true) : setVoidConfirmOpen(true)),
                  destructive: true,
                  testId: "invoice-void-btn",
                } satisfies DetailPageHeaderAction,
              ]
            : []),
        ]}
      />

      {/* Replace the payment link — the old one may still take a payment until it expires */}
      <ConfirmDialog
        open={replaceLinkOpen}
        onOpenChange={(o) => !replacingLink && setReplaceLinkOpen(o)}
        title="Ganti link pembayaran?"
        description="Link lama akan diganti. Jika orang tua sudah membayar lewat link lama, pembayarannya tetap tercatat."
        onConfirm={handleReplaceLink}
        confirmLabel="Buat link baru"
        loading={replacingLink}
      />

      {/* Void Confirmation */}
      <ConfirmDialog
        open={voidConfirmOpen}
        onOpenChange={(o) => !voiding && setVoidConfirmOpen(o)}
        title="Batalkan Tagihan"
        description={`Tagihan ${invoice.invoiceNumber} (${invoice.student.name}) tidak bisa dibayar lagi. Riwayat tetap tersimpan.`}
        onConfirm={handleVoidInvoice}
        confirmLabel={voiding ? "Membatalkan..." : "Ya, Batalkan"}
        destructive
      />

      {/* Void blocked — explains instead of failing with a 409 */}
      <ConfirmDialog
        open={voidBlockedOpen}
        onOpenChange={setVoidBlockedOpen}
        title="Tagihan sudah menerima pembayaran"
        description={`Tagihan ${invoice.invoiceNumber} sudah menerima ${formatRupiah(paidOnInvoice)}. Batalkan pembayarannya lebih dulu di Riwayat Pembayaran, lalu batalkan tagihan.${activePayments.some((p) => isGatewayPayment(p)) ? " Pembayaran lewat gateway (Virtual Account) tidak bisa dibatalkan dari sini." : ""}`}
        onConfirm={() => undefined}
        confirmLabel="Mengerti"
        cancelLabel="Tutup"
      />

      {/* Reverse a manual payment — reason is mandatory */}
      <ConfirmDialog
        open={!!reverseTarget}
        onOpenChange={(o) => { if (!o) { setReverseTarget(null); setReverseError(null); setReverseReason(""); } }}
        title="Batalkan pembayaran?"
        description={
          reverseTarget
            ? `Pembayaran ${formatRupiah(reverseTarget.amount)} (${paymentMethodLabel(reverseTarget.method, reverseTarget.channelCode)}, ${formatDateShort(reverseTarget.paidAt)}) tidak dihitung lagi dan sisa tagihan bertambah. Riwayat tetap tersimpan sebagai Dibatalkan.`
            : undefined
        }
        onConfirm={handleReversePayment}
        confirmLabel="Ya, Batalkan Pembayaran"
        destructive
      >
        <div className="space-y-1.5">
          <label htmlFor="reverse-reason" className="text-sm font-medium">
            Alasan pembatalan <span className="text-destructive" aria-hidden="true">*</span>
          </label>
          <Textarea
            id="reverse-reason"
            value={reverseReason}
            onChange={(e) => { setReverseReason(e.target.value); setReverseError(null); }}
            placeholder="Contoh: salah input nominal"
            rows={3}
            maxLength={300}
            aria-required="true"
            aria-invalid={!!reverseError}
            aria-describedby={reverseError ? "reverse-reason-error" : undefined}
          />
          {reverseError && <p id="reverse-reason-error" role="alert" className="text-sm text-destructive">{reverseError}</p>}
        </div>
      </ConfirmDialog>

      {invoice.paymentLinkError && (
        <Card className="border-warning/40 bg-warning/5 p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium">Link pembayaran belum berhasil dibuat</p>
              {/* Was rendering the stored "<prefix>: <vendor message>" string
                  verbatim — e.g. "5xx: Xendit API error: 500". The raw vendor
                  text stays available behind the disclosure for support. */}
              {(() => {
                const parsed = parsePaymentLinkError(invoice.paymentLinkError);
                if (!parsed) return null;
                return (
                  <>
                    <p className="text-xs text-muted-foreground mt-1">{parsed.userMessage}</p>
                    <details className="mt-1">
                      <summary className="text-xs text-muted-foreground cursor-pointer">
                        Lihat detail teknis
                      </summary>
                      <p className="text-xs text-muted-foreground mt-1 break-all">
                        {parsed.code} · {parsed.detail}
                      </p>
                    </details>
                  </>
                );
              })()}
            </div>
            {invoice.capabilities?.create && <Button size="sm" onClick={handleRetryLink} disabled={retrying}>
              {retrying ? "..." : "Coba Lagi"}
            </Button>}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Invoice Lines */}
        <Card className="p-card lg:col-span-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Rincian Tagihan</h3>
          <div className="space-y-2">
            {invoice.lines.map(line => (
              <div key={line.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div>
                  <p className="text-sm font-medium">{line.labelSnapshot}</p>
                  {line.adjustmentAmount !== 0 && (
                    <p className="text-xs text-muted-foreground">Penyesuaian: {formatRupiah(line.adjustmentAmount)} {line.adjustmentNote && `(${line.adjustmentNote})`}</p>
                  )}
                </div>
                <span className="font-currency text-sm font-bold">{formatRupiah(line.finalAmount)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border mt-3 pt-3 space-y-1">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total Tagihan</span><span className="font-currency font-bold">{formatRupiah(invoice.totalDue)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Dibayar</span><span className="font-currency font-bold text-status-present">{formatRupiah(invoice.totalPaid)}</span></div>
            {remaining > 0 && invoice.status !== "CANCELLED" && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Sisa</span><span className="font-currency font-bold text-destructive">{formatRupiah(remaining)}</span></div>}
          </div>
        </Card>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Guardian info */}
          {guardian && (
            <Card className="p-card">
              <SectionHeading label="Kontak Wali" />
              <p className="text-sm font-medium">{guardian.name}</p>
              {guardian.phone && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Phone size={12} /> {guardian.phone}</p>}
              {guardian.email && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Mail size={12} /> {guardian.email}</p>}
              {guardian.whatsapp && <p className="text-xs text-muted-foreground mt-0.5">WhatsApp {guardian.whatsapp}</p>}
              {(canRemind || invoice.lastRemindedAt) && (
                <p className="mt-2 text-xs text-muted-foreground" data-testid="invoice-last-reminded" aria-live="polite">
                  {invoice.lastRemindedAt
                    ? `Terakhir diingatkan ${formatRelativeTime(invoice.lastRemindedAt)}${invoice.lastRemindedByName ? ` · oleh ${invoice.lastRemindedByName}` : ""}`
                    : "Belum diingatkan"}
                </p>
              )}
              {canRemind &&
                (reminderUrl ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    nativeButton={false}
                    // Base UI would otherwise mark the anchor role="button"; it navigates.
                    role="link"
                    data-testid="invoice-whatsapp-reminder"
                    // Stamping needs payments.record; without it the link still opens, unrecorded.
                    onClick={invoice.capabilities?.recordPayment ? handleStampReminder : undefined}
                    render={
                      <a
                        href={reminderUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Chat WhatsApp: ingatkan ${guardian.name} soal tagihan ini`}
                      />
                    }
                  >
                    <MessageCircle aria-hidden="true" />
                    Chat WhatsApp
                  </Button>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">Belum ada nomor WhatsApp wali untuk mengingatkan tagihan ini.</p>
                ))}
            </Card>
          )}

          {/* Payment link */}
          {invoice.xenditPaymentUrl && invoice.status !== "PAID" && invoice.status !== "CANCELLED" && (
            <Card className="p-card">
              <SectionHeading label="Link Pembayaran" />
              <a href={invoice.xenditPaymentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex text-xs text-primary-text hover:underline break-all [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center">{invoice.xenditPaymentUrl}</a>
              <PaymentLinkExpiryLine invoice={invoice} />
              <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => { navigator.clipboard.writeText(invoice.xenditPaymentUrl!); toast.success("Link disalin"); }}>
                Salin Link
              </Button>
            </Card>
          )}

          {/* Payment history */}
          <Card className="p-card">
            <SectionHeading label="Riwayat Pembayaran" />
            {invoice.payments.length === 0 ? (
              <EmptyState title="Belum ada pembayaran" description="Pembayaran yang dicatat manual atau diterima via link akan tampil di sini." />
            ) : (
              <div className="space-y-2">
                {invoice.payments.map(p => {
                  const reversed = p.status === "REVERSED";
                  const canReverse =
                    invoice.capabilities?.recordPayment && !reversed && !isGatewayPayment(p) && invoice.status !== "CANCELLED";
                  return (
                    <div key={p.id} data-testid={`payment-row-${p.id}`} data-status={p.status} className="border-b border-border/50 last:border-0 pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-xs">{paymentMethodLabel(p.method, p.channelCode)}</Badge>
                          {reversed && <StatusBadge status="REVERSED" />}
                        </span>
                        <span className={cn("font-currency text-sm font-bold", reversed ? "text-muted-foreground line-through" : "text-status-present")}>
                          {formatRupiah(p.amount)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDateShort(p.paidAt)}
                        {p.reference && ` · Ref: ${p.reference}`}
                        {p.createdByName && ` · Dicatat oleh ${p.createdByName}`}
                      </p>
                      {p.notes && <p className="text-xs text-muted-foreground whitespace-pre-line">{p.notes}</p>}
                      {canReverse && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-1 h-7 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => { setReverseReason(""); setReverseError(null); setReverseTarget(p); }}
                        >
                          <Undo2 size={12} aria-hidden="true" /> Batalkan pembayaran
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Gateway money that needs a person — above the log so it is seen first */}
          <PaymentProblemsAlert problems={invoice.paymentProblems ?? []} />

          {/* Aktivitas Pembayaran — hides itself when 0 events */}
          <PaymentActivityCard invoiceId={invoice.id} refreshKey={activityKey} />
        </div>
      </div>

      {/* Payment Dialog — ResponsiveFormDialog owns the Dialog/Sheet breakpoint switch.
          Two steps: fill (Tinjau Pembayaran) -> review (Catat Rp ...). */}
      <ResponsiveFormDialog
        open={paymentDialog}
        onOpenChange={(o) => { if (!submittingPayment) { setPaymentDialog(o); if (!o) setPayStep("form"); } }}
        title="Catat Pembayaran"
        size="lg"
        footer={
          payStep === "form" ? (
            <FormDialogFooter
              formId={paymentFormId}
              pending={payForm.formState.isSubmitting}
              onCancel={closePaymentDialog}
              submitLabel="Tinjau Pembayaran"
              pendingLabel="Memeriksa..."
            />
          ) : (
            <div className="contents">
              <Button type="button" variant="ghost" onClick={() => setPayStep("form")} disabled={submittingPayment}>
                Ubah
              </Button>
              <Button type="button" onClick={handleConfirmPayment} disabled={submittingPayment} aria-busy={submittingPayment || undefined}>
                {submittingPayment ? "Mencatat..." : `Catat ${formatRupiah(Number(payForm.getValues("amount") ?? 0))}`}
              </Button>
            </div>
          )
        }
      >
        {payStep === "form" ? (
          <form id={paymentFormId} onSubmit={handleReviewPayment} noValidate className="space-y-field">
            <FormRootError formState={payForm.formState} />
            <PaymentFormBody control={payForm.control} remaining={remaining} today={getTodayInTimezone("Asia/Jakarta")} />
          </form>
        ) : (
          <PaymentReview
            invoice={invoice}
            amount={Number(payForm.getValues("amount") ?? 0)}
            method={payForm.getValues("method") ?? "CASH"}
            paidAt={payForm.getValues("paidAt")}
            reference={payForm.getValues("reference") ?? ""}
            notes={payForm.getValues("notes") ?? ""}
            remaining={remaining}
          />
        )}
      </ResponsiveFormDialog>
    </>
  );
}
