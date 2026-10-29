"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { BatchProgressCard } from "@/components/admin/invoices/batch-progress-card";
import { ManualInvoiceDialog } from "@/components/admin/invoices/manual-invoice-dialog";
import { SppPrepayDialog } from "@/components/admin/invoices/spp-prepay-dialog";
import { PaymentLinkExpiryCell } from "@/components/admin/invoices/payment-link-expiry-cell";
import { PendingLinkBreakdownPopover } from "@/components/admin/invoices/pending-link-breakdown-popover";
import { ReminderQueueDialog } from "@/components/admin/invoices/reminder-queue-dialog";
import { BillingRunWizard } from "@/components/admin/invoices/billing-run-wizard/billing-run-wizard";
import { type AcademicYear } from "@/components/admin/invoices/billing-run-wizard/billing-defaults";
import { Plus, FileText, Receipt, CheckCircle, Clock, AlertTriangle, AlertCircle, LinkIcon, CircleDashed, RefreshCw, FilePlus2, MessageCircle, Wallet, Banknote, CreditCard, CalendarCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { userMessage, ApiError } from "@/lib/api/client-errors";
import { parsePaymentLinkError } from "@/lib/payments/error-prefix";
import { formatRupiah, formatDateShort } from "@/lib/format";
import { INVOICE_STATUS_LABELS, VOIDABLE_INVOICE_STATUSES } from "@/lib/constants/invoice-status";
import {
  runBulkRetry,
  type BulkRetrySnapshot,
} from "@/lib/finance/run-bulk-retry";
// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type Invoice = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  dueDate: string;
  totalDue: number;
  totalPaid: number;
  status: string;
  xenditPaymentUrl?: string | null;
  paymentLinkExpiresAt?: string | null;
  createdAt: string;
  student: { name: string; nickname: string | null };
  _count: { payments: number };
};

// `AcademicYear` lives in
// components/admin/invoices/billing-run-wizard/billing-defaults.ts (Cycle
// B1, Task T8). Re-exported here for any code that still imports the type
// from this module.
export type { AcademicYear };

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

// ------------------------------------------------------------------
// Columns
// ------------------------------------------------------------------

// Statuses with money still owed and a live payment-recording flow.
const PAYABLE_INVOICE_STATUSES = ["SENT", "OVERDUE", "PARTIALLY_PAID"] as const;

const columns: ColumnDef<Invoice>[] = [
  {
    id: "student",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Siswa" />
    ),
    cell: ({ row }) => {
      const inv = row.original;
      return (
        <div className="flex items-center gap-3">
          <div className="hidden w-8 h-8 rounded-full bg-muted items-center justify-center shrink-0 md:flex">
            <FileText size={14} className="text-primary" />
          </div>
          <DataTableLinkCell
            href={`/admin/invoices/${inv.id}`}
            className="whitespace-normal"
            description={
              <>
                <span className="font-currency">{inv.invoiceNumber}</span>
                {/* Status + due date follow the name below `md` (FIN-21). */}
                <DataTableMobileMeta className="mt-1">
                  <StatusBadge status={inv.status} />
                  <span>Tempo {formatDateShort(inv.dueDate)}</span>
                  <PaymentLinkExpiryCell invoice={inv} variant="meta" />
                </DataTableMobileMeta>
              </>
            }
          >
            {inv.student.name}
          </DataTableLinkCell>
        </div>
      );
    },
  },
  {
    accessorKey: "periodLabel",
    header: "Periode",
    meta: { priority: "low" },
    cell: ({ row }) => (
      <div>
        <span className="text-sm">{row.original.periodLabel}</span>
        <p className="text-xs text-muted-foreground">
          Jatuh tempo: {formatDateShort(row.original.dueDate)}
        </p>
      </div>
    ),
  },
  {
    id: "amount",
    header: "Jumlah",
    cell: ({ row }) => {
      const inv = row.original;
      const remaining = Number(inv.totalDue) - Number(inv.totalPaid);
      return (
        <div className="text-right">
          <p className="font-currency text-sm font-bold whitespace-nowrap">
            {formatRupiah(Number(inv.totalDue))}
          </p>
          {Number(inv.totalPaid) > 0 && Number(inv.totalPaid) < Number(inv.totalDue) && (
            <p className="font-currency text-xs text-success">
              Dibayar: {formatRupiah(Number(inv.totalPaid))}
            </p>
          )}
          {remaining > 0 && inv.status !== "DRAFT" && inv.status !== "CANCELLED" && (
            <p className="font-currency text-xs text-destructive">
              Sisa: {formatRupiah(remaining)}
            </p>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Dibuat" />
    ),
    meta: { priority: "low" },
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {formatDateShort(row.original.createdAt)}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    meta: { priority: "low" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "paymentLinkExpiresAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Link berlaku" />
    ),
    meta: { priority: "low" },
    cell: ({ row }) => <PaymentLinkExpiryCell invoice={row.original} />,
  },
];

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export function InvoicesClient({ gatewayId, capabilities, initialStatus = "all" }: { gatewayId: "xendit" | "doku"; capabilities: import("@/lib/finance/invoice-capabilities").InvoiceCapabilities; /** `?status=` from the URL (dashboard "Lewat tempo" card links here). */ initialStatus?: string }) {
  const router = useRouter();
  // Columns must keep a stable identity (ui.md); read the router through a ref
  // so a new router object never rebuilds them and closes an open row menu.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const [data, setData] = useState<Invoice[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);

  // Manual single-invoice dialog — submission redirects to the detail page,
  // so no list refresh is needed on success (the user leaves the list view).
  const [manualDialog, setManualDialog] = useState(false);
  const [sppPrepayDialog, setSppPrepayDialog] = useState(false);
  // "Catat SPP di muka" creates invoices and records their payments in one step,
  // so it needs both permissions (same pair the endpoints enforce).
  const canPrepaySpp = capabilities.create && capabilities.recordPayment;

  // Billing Run wizard (bulk invoice wizard arc, Cycle B1, Task T8) — the
  // only bulk-generate entry point since Task T10 retired the legacy
  // "Buat Tagihan Bulanan" dialog and its plan/batch routes. `wizardResumeId`
  // is set when the entry point is the resumable-draft banner rather than
  // the "new run" button, so the wizard opens straight into the existing
  // draft instead of step 1.
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardResumeId, setWizardResumeId] = useState<string | null>(null);
  const [draftRun, setDraftRun] = useState<{ id: string; periodLabel: string; status: string } | null>(null);

  // Resume-banner discard (Cycle B2, Task T6) — closes B1's half-shipped
  // acceptance criterion: the banner offered "Lanjutkan draf" only, so a
  // draft was reachable to cancel only via the step-1 409 conflict panel's
  // "Buang & Mulai Baru". Drives the same PATCH /api/billing-runs/[id]
  // { status: "CANCELLED" } that panel uses.
  const [discardDraftOpen, setDiscardDraftOpen] = useState(false);

  const fetchDraftRun = useCallback(() => {
    fetch("/api/billing-runs?unfinished=true&pageSize=1&sortOrder=asc")
      .then((r) => r.json())
      .then((json) => {
        const run = json?.data?.[0];
        setDraftRun(run ? { id: run.id, periodLabel: run.periodLabel, status: run.status } : null);
      })
      .catch((err) => console.error("[invoices] draft billing run fetch failed", err));
  }, []);

  useEffect(() => {
    fetchDraftRun();
  }, [fetchDraftRun]);

  function openWizard() {
    setWizardResumeId(null);
    setWizardOpen(true);
  }

  function resumeWizard() {
    if (!draftRun) return;
    setWizardResumeId(draftRun.id);
    setWizardOpen(true);
  }

  // Cancels the DRAFT run behind the banner, then refetches so the banner
  // disappears — the same effect a fully-committed run has on this state.
  // After this, opening a fresh wizard must NOT hit the 409 conflict panel,
  // since the only DRAFT run is now CANCELLED.
  async function handleDiscardDraft() {
    if (!draftRun) return;
    try {
      const res = await fetch(`/api/billing-runs/${draftRun.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(body?.error ?? "Gagal membuang draf");
      }
      toast.success("Draf tagihan dibuang");
      fetchDraftRun();
    } catch (err) {
      toast.error(userMessage(err, "Gagal membuang draf"));
    }
  }

  // Bulk-retry orchestration state (pending-payment-link retry, unrelated to
  // the retired bulk-generate dialog — this is the "Coba Lagi Link" surface
  // driven by lib/finance/run-bulk-retry.ts, which Task T10 leaves untouched).
  const [retryConfirmOpen, setRetryConfirmOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryingRowId, setRetryingRowId] = useState<string | null>(null);
  const [checkingRowId, setCheckingRowId] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [creatingLinks, setCreatingLinks] = useState(false);
  const [reminderQueueOpen, setReminderQueueOpen] = useState(false);
  const [retryProgress, setRetryProgress] = useState<BulkRetrySnapshot | null>(null);
  const [overflowConfirm, setOverflowConfirm] = useState<{
    total: number;
    resolve: (proceed: boolean) => void;
  } | null>(null);
  const retryDoneAutoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // AbortController for the retry orchestrator — driven by the
  // BatchProgressCard "Batalkan" button. Reset to null when the run finishes
  // or is cancelled so the next click starts fresh.
  const retryAbortRef = useRef<AbortController | null>(null);
  const [statsState, setStatsState] = useState<"loading" | "ready" | "error">("loading");
  const [stats, setStats] = useState({
    total: 0,
    draft: 0,
    sent: 0,
    partiallyPaid: 0,
    paid: 0,
    overdue: 0,
    cancelled: 0,
    pendingPaymentLink: 0,
    unpaidWithoutLink: 0,
    owing: 0,
    needsReview: 0,
    outstanding: 0,
    collectedThisMonth: 0,
  });

  const fetchStats = useCallback(() => {
    fetch("/api/invoices/stats")
      .then((r) => { if (!r.ok) throw new Error("stats unavailable"); return r.json(); })
      .then((s) => {
        if (s?.error) throw new Error("stats unavailable");
        setStatsState("ready");
        setStats({
          total: s.total ?? 0,
          draft: s.draft ?? 0,
          sent: s.sent ?? 0,
          partiallyPaid: s.partiallyPaid ?? 0,
          paid: s.paid ?? 0,
          overdue: s.overdue ?? 0,
          cancelled: s.cancelled ?? 0,
          pendingPaymentLink: s.pendingPaymentLink ?? 0,
          unpaidWithoutLink: s.unpaidWithoutLink ?? 0,
          owing: s.owing ?? 0,
          needsReview: s.needsReview ?? 0,
          outstanding: Number(s.outstanding ?? 0),
          collectedThisMonth: Number(s.collectedThisMonth ?? 0),
        });
      })
      .catch(() => setStatsState("error"));
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetch("/api/academic-years")
      .then((r) => r.json())
      .then((y) => setYears(Array.isArray(y) ? y : y.data ?? []))
      .catch((err) => console.error("[invoices] academic years fetch failed", err));
  }, []);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
        sortBy,
        sortOrder,
      });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/invoices?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, statusFilter, sortBy, sortOrder]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  // Latest list + stats reload, for row actions captured by the memoized columns.
  const reloadListRef = useRef(() => {});
  useEffect(() => {
    reloadListRef.current = () => {
      fetchInvoices();
      fetchStats();
    };
  }, [fetchInvoices, fetchStats]);

  // Cleanup the auto-hide timer on unmount + flip mountedRef so any in-flight
  // runBulkRetry callbacks (onProgress, onOverflow, post-run toasts) can
  // short-circuit and avoid setting state on an unmounted component.
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (retryDoneAutoHideRef.current) clearTimeout(retryDoneAutoHideRef.current);
    };
  }, []);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setPagination((p) => ({ ...p, page }));
  }, []);

  const handlePageSizeChange = useCallback((pageSize: number) => {
    setPagination((p) => ({ ...p, page: 1, pageSize }));
  }, []);

  const handleSortChange = useCallback((field: string, order: "asc" | "desc") => {
    setSortBy(field);
    setSortOrder(order);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  // Bulk retry — drives the runBulkRetry orchestrator end-to-end. The
  // orchestrator pre-fetches all PENDING_PAYMENT_LINK invoices, chunks them
  // into 25-item slices, and POSTs each chunk through the same
  // /api/invoices/retry-payment-links endpoint used by per-row retries.
  async function handleBulkRetry() {
    setRetryConfirmOpen(false);
    setRetrying(true);

    if (retryDoneAutoHideRef.current) {
      clearTimeout(retryDoneAutoHideRef.current);
      retryDoneAutoHideRef.current = null;
    }

    // Fresh AbortController per run — wired to the card's Batalkan button.
    retryAbortRef.current = new AbortController();

    try {
      const out = await runBulkRetry({
        signal: retryAbortRef.current.signal,
        onProgress: (snapshot) => {
          if (!mountedRef.current) return;
          setRetryProgress({ ...snapshot });
        },
        onOverflow: (total) =>
          new Promise<boolean>((resolve) => {
            if (!mountedRef.current) return resolve(false);
            setOverflowConfirm({ total, resolve });
          }),
      });

      if (!mountedRef.current) return;

      if (out.phase === "no-pending") {
        toast.info("Tidak ada tagihan dengan link gagal");
        setRetryProgress(null);
      } else if (out.phase === "user-cancelled") {
        setRetryProgress(null);
      } else if (out.phase === "aborted") {
        toast.error(
          `Dibatalkan setelah ${out.final.processed}/${out.final.total} tagihan diproses`,
        );
      } else if (out.phase === "done") {
        const { fixed, stillFailed } = out.final;
        if (fixed > 0 && stillFailed === 0) {
          toast.success(`${fixed} link berhasil diperbaiki`);
        } else if (fixed > 0 && stillFailed > 0) {
          toast.success(
            `${fixed} link berhasil, ${stillFailed} masih gagal — buka invoice untuk detail`,
          );
        } else if (fixed === 0 && stillFailed > 0) {
          toast.error(`${stillFailed} link masih gagal — buka invoice untuk detail`);
        }
        fetchInvoices();
        fetchStats();

        retryDoneAutoHideRef.current = setTimeout(() => {
          setRetryProgress(null);
          retryDoneAutoHideRef.current = null;
        }, 5000);
      }
    } catch (e) {
      toast.error(userMessage(e, "Gagal mencoba ulang link"));
      setRetryProgress(null);
    } finally {
      if (mountedRef.current) setRetrying(false);
      retryAbortRef.current = null;
    }
  }

  function handleOverflowConfirm() {
    if (!overflowConfirm) return;
    const { resolve } = overflowConfirm;
    setOverflowConfirm(null);
    resolve(true);
  }

  // Per-row retry — one invoice id, single POST, no progress card. Refetch
  // the list + stats on success so the row's status badge flips.
  async function handleRowRetry(invoiceId: string) {
    setRetryingRowId(invoiceId);
    try {
      const res = await fetch("/api/invoices/retry-payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: [invoiceId] }),
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
        // Humanised sentence in the toast; the raw vendor string stays on
        // the invoice detail page's "detail teknis" disclosure.
        const parsed = parsePaymentLinkError(out.results?.[0]?.error);
        toast.error(parsed ? `Masih gagal. ${parsed.userMessage}` : "Masih gagal membuat link pembayaran.");
      }
    } finally {
      if (!mountedRef.current) return;
      setRetryingRowId(null);
      // Refresh on every exit path — even after a transient HTTP error the
      // server might have already advanced state (paymentLinkError updated).
      // Mirrors handleBulkRetry's unconditional refresh semantics.
      fetchInvoices();
      fetchStats();
    }
  }

  // Per-row payment reconciliation — same endpoint and toast mapping as the
  // detail page's "Cek status pembayaran". Idempotent server-side; refetch the
  // list + stats on every exit path so a flipped status shows up in the row.
  // The row menu is memoized and does not rebuild when filters change, so the
  // reload goes through a ref holding the CURRENT query's fetchers; a captured
  // fetchInvoices would reload the table with the previous filter.
  async function handleRowCheckPayment(invoiceId: string) {
    setCheckingRowId(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/refresh-payment`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Gagal memeriksa status pembayaran");
        return;
      }
      if (d.code === "UPDATED") toast.success(d.message);
      else if (d.code === "GATEWAY_ERROR" || d.code === "UNAVAILABLE" || d.code === "NEEDS_REVIEW") toast.warning(d.message);
      else toast.info(d.message);
    } catch {
      toast.error("Gagal memeriksa status pembayaran");
    } finally {
      if (mountedRef.current) {
        setCheckingRowId(null);
        reloadListRef.current();
      }
    }
  }

  // "Cek semua belum lunas": the server picks the next 50 unpaid invoices that
  // hold a payment link (not the visible rows, so a filter cannot hide one) and
  // asks the gateway about each. Pressing again continues with the next batch.
  async function handleCheckAllPayments() {
    setCheckingAll(true);
    try {
      const res = await fetch("/api/invoices/refresh-payments", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Gagal memeriksa status pembayaran");
        return;
      }
      if (d.checked === 0) {
        toast.info("Tidak ada tagihan belum lunas yang perlu diperiksa sekarang.");
        return;
      }
      const left = d.remaining > 0 ? ` Masih ada ${d.remaining} tagihan, tekan lagi untuk melanjutkan.` : "";
      const summary = `${d.checked} tagihan diperiksa, ${d.updated} diperbarui.${left}`;
      if (d.failed > 0) toast.warning(`${summary} ${d.failed} gagal diperiksa ke gateway.`);
      else if (d.updated > 0) toast.success(summary);
      else toast.info(summary);
    } catch {
      toast.error("Gagal memeriksa status pembayaran");
    } finally {
      if (mountedRef.current) {
        setCheckingAll(false);
        reloadListRef.current();
      }
    }
  }

  // "Buat link baru (N)": the server picks the next 25 unpaid invoices that have
  // no payment link (an expired one is cleared by the sweep) and makes one for
  // each. Pressing again continues; the count in the label falls as it goes.
  async function handleCreateMissingLinks() {
    setCreatingLinks(true);
    try {
      const res = await fetch("/api/invoices/create-missing-links", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Gagal membuat link pembayaran");
        return;
      }
      if (d.created === 0 && d.failed === 0 && d.skipped === 0) {
        toast.info("Semua tagihan belum lunas sudah punya link pembayaran.");
        return;
      }
      const left = d.remaining > 0 ? ` Masih ada ${d.remaining} tagihan, tekan lagi untuk melanjutkan.` : "";
      const summary = `${d.created} link dibuat.${left}`;
      if (d.failed > 0) toast.warning(`${summary} ${d.failed} gagal dibuat, coba lagi nanti.`);
      else toast.success(summary);
    } catch {
      toast.error("Gagal membuat link pembayaran");
    } finally {
      if (mountedRef.current) {
        setCreatingLinks(false);
        reloadListRef.current();
      }
    }
  }

  async function handleVoidInvoice() {
    if (!voidTarget) return;
    const res = await fetch(`/api/invoices/${voidTarget.id}/void`, { method: "POST" });
    if (!mountedRef.current) return;
    if (res.ok) {
      toast.success("Tagihan dibatalkan");
      setVoidTarget(null);
      fetchInvoices();
      fetchStats();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal membatalkan tagihan");
    }
  }

  const columnsWithActions = useMemo<ColumnDef<Invoice>[]>(
    () => [
      ...columns,
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const inv = row.original;
          // Overdue invoices can be cancelled too (FIN-9) — but only while no
          // money sits on them; with payments, the detail page explains that
          // they must be reversed first.
          const canVoid =
            capabilities.void &&
            (VOIDABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status) &&
            Number(inv.totalPaid) === 0;
          const isRetryRow = capabilities.create && inv.status === "PENDING_PAYMENT_LINK";
          const isRetryingThisRow = retryingRowId === inv.id;
          // R2-ADMIN-12: recording cash was three clicks deep; the menu now
          // jumps to the detail page with the existing dialog already open.
          const canRecordPayment =
            capabilities.recordPayment &&
            (PAYABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status);
          // Same rule as the detail page: only an unpaid invoice that holds a
          // gateway link can have a payment sitting at the gateway.
          const canCheckPayment = canRecordPayment && !!inv.xenditPaymentUrl;
          const isCheckingThisRow = checkingRowId === inv.id;
          const rowActions = [
            ...(canRecordPayment
              ? [
                  {
                    label: "Catat Pembayaran",
                    icon: <CreditCard size={14} />,
                    onClick: () => routerRef.current.push(`/admin/invoices/${inv.id}?bayar=1`),
                  },
                ]
              : []),
            ...(canCheckPayment
              ? [
                  {
                    label: isCheckingThisRow ? "Memeriksa..." : "Cek status pembayaran",
                    icon: <RefreshCw size={14} />,
                    onClick: () => {
                      // Row-action items have no `disabled` prop; guard against
                      // a re-trigger while any check is in flight.
                      if (!checkingRowId) handleRowCheckPayment(inv.id);
                    },
                  },
                ]
              : []),
            ...(isRetryRow
              ? [
                  {
                    label: isRetryingThisRow ? "Mencoba..." : "Coba Lagi Link",
                    icon: <RefreshCw size={14} />,
                    onClick: () => {
                      if (!isRetryingThisRow) handleRowRetry(inv.id);
                    },
                  },
                ]
              : []),
          ];
          return (
            <DataTableRowActions
              onVoid={canVoid ? () => setVoidTarget(inv) : undefined}
              extraActions={rowActions.length > 0 ? rowActions : undefined}
            />
          );
        },
      },
    ],
    // handleRowRetry is stable across renders for the purposes of this effect
    // (closes over fetchInvoices/fetchStats which are useCallback-stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [retryingRowId, checkingRowId, capabilities],
  );

  // Billing Run wizard (Cycle B1, Task T9) — fired once step 3's commit loop
  // has nothing left to commit. Refreshes everything the wizard's writes can
  // have touched: the invoice list itself, the header stats, and the
  // resumable-draft banner (a fully-committed run is no longer a DRAFT, so
  // the banner should disappear).
  const handleWizardCommitted = useCallback(() => {
    fetchInvoices();
    fetchStats();
    fetchDraftRun();
  }, [fetchInvoices, fetchStats, fetchDraftRun]);

  // The Status filter asks five questions (D12), plus a sixth only when it has an answer.
  // "Belum lunas", "Perlu link" and "Perlu dicek" are derived (`UNPAID` / `NEEDS_LINK` /
  // `NEEDS_REVIEW`); counts come from the summary request, cover the whole school and ignore
  // the search box. "Perlu link" is the sum of the two header buttons' numbers. "Perlu dicek"
  // (flagged gateway payments) shows only when N > 0, or while selected so it never vanishes.
  const statusOptions = useMemo(() => {
    const withCount = (label: string, n: number) => (statsState === "ready" ? `${label} (${n})` : label);
    const options = [
      { value: "all", label: "Semua Status" },
      { value: "UNPAID", label: withCount("Belum lunas", stats.owing) },
      { value: "OVERDUE", label: withCount("Lewat Tempo", stats.overdue) },
      { value: "NEEDS_LINK", label: withCount("Perlu link", stats.pendingPaymentLink + stats.unpaidWithoutLink) },
      ...(stats.needsReview > 0 || statusFilter === "NEEDS_REVIEW"
        ? [{ value: "NEEDS_REVIEW", label: withCount("Perlu dicek", stats.needsReview) }]
        : []),
      { value: "PAID", label: withCount("Lunas", stats.paid) },
      { value: "CANCELLED", label: withCount("Dibatalkan", stats.cancelled) },
    ];
    // A raw status from the address (e.g. `?status=SENT`) filters correctly but is not
    // advertised: show it as one extra option so the select never reads "Semua Status"
    // over a filtered list. It has no count; it disappears once another option is picked.
    if (!options.some((o) => o.value === statusFilter)) {
      options.push({ value: statusFilter, label: INVOICE_STATUS_LABELS[statusFilter] ?? statusFilter });
    }
    return options;
  }, [statsState, stats, statusFilter]);

  return (
    <>
      <PageHeader
        title="Tagihan"
        description={`${pagination.total} tagihan`}
        actions={(capabilities.create || capabilities.recordPayment) &&
          <div className="flex flex-wrap gap-2">
            {capabilities.create && stats.pendingPaymentLink > 0 && (
              <PendingLinkBreakdownPopover
                count={stats.pendingPaymentLink}
                retrying={retrying}
                onClickRetry={() => setRetryConfirmOpen(true)}
                gatewayId={gatewayId}
              />
            )}
            {capabilities.create && stats.unpaidWithoutLink > 0 && (
              <Button size="sm" variant="outline" onClick={handleCreateMissingLinks} disabled={creatingLinks}>
                <LinkIcon size={14} className="mr-1.5" />
                {creatingLinks ? "Membuat link..." : `Buat link baru (${stats.unpaidWithoutLink})`}
              </Button>
            )}
            {capabilities.recordPayment && (
              <Button size="sm" variant="outline" onClick={handleCheckAllPayments} disabled={checkingAll}>
                <RefreshCw size={14} className="mr-1.5" />
                {checkingAll ? "Memeriksa..." : "Cek semua belum lunas"}
              </Button>
            )}
            {capabilities.recordPayment && (
              <Button size="sm" variant="outline" onClick={() => setReminderQueueOpen(true)}>
                <MessageCircle size={14} className="mr-1.5" />
                Pengingat WhatsApp
              </Button>
            )}
            {capabilities.create && (
              <>
                <Button size="sm" variant="outline" onClick={() => setManualDialog(true)}>
                  <Plus size={14} className="mr-1.5" /> Tagihan Manual
                </Button>
                {canPrepaySpp && (
                  <Button size="sm" variant="outline" onClick={() => setSppPrepayDialog(true)}>
                    <CalendarCheck size={14} className="mr-1.5" /> Catat SPP di muka
                  </Button>
                )}
                <Button size="sm" onClick={openWizard}>
                  <FilePlus2 size={14} className="mr-1.5" /> Buat Tagihan
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Resumable draft banner (Cycle B1, Task T8) — a DRAFT billing run
          persists across refreshes; this is how an admin picks it back up
          instead of it silently sitting invisible until they happen to
          re-open the wizard fresh and hit the 409. */}
      {capabilities.create && draftRun && (
        <Alert className="has-data-[slot=alert-action]:pr-2.5">
          <AlertTriangle className="size-4" />
          <AlertTitle>Ada draf tagihan yang belum selesai</AlertTitle>
          <AlertDescription>
            {draftRun.status === "COMMITTING"
              ? `Pembuatan tagihan periode ${draftRun.periodLabel} belum selesai. Lanjutkan sisanya; tagihan yang sudah dibuat tidak akan dibuat ulang.`
              : `Periode ${draftRun.periodLabel} punya draf yang belum dikomit.`}
          </AlertDescription>
          <AlertAction className="static col-span-full flex flex-wrap justify-end gap-2 pt-2">
            {draftRun.status !== "COMMITTING" && <Button size="sm" variant="ghost" onClick={() => setDiscardDraftOpen(true)}>
              Buang draf
            </Button>}
            <Button size="sm" variant="outline" onClick={resumeWizard}>
              {draftRun.status === "COMMITTING" ? "Lanjutkan pembuatan tagihan" : "Lanjutkan draf"}
            </Button>
          </AlertAction>
        </Alert>
      )}

      {/* Discard-draft confirm (Cycle B2, Task T6) — names the period and
          the consequence per .claude/standards/voice.md's destructive-
          confirmations table, never a bare "are you sure?". */}
      <ConfirmDialog
        open={discardDraftOpen}
        onOpenChange={setDiscardDraftOpen}
        title="Buang draf tagihan ini?"
        description={
          draftRun
            ? `Draf periode ${draftRun.periodLabel} akan dibatalkan dan tidak bisa dilanjutkan lagi. Anda bisa membuat draf baru kapan saja.`
            : ""
        }
        confirmLabel="Buang Draf"
        onConfirm={handleDiscardDraft}
        destructive
      />

      {retryProgress && (
        <BatchProgressCard
          mode="retry"
          progress={retryProgress}
          onCancel={() => retryAbortRef.current?.abort()}
        />
      )}

      {/* Overflow confirm — surfaces when more than 1000 invoices are stuck.
          Single confirm button per spec; closing the dialog without confirming
          aborts the orchestrator cleanly. */}
      <ConfirmDialog
        open={!!overflowConfirm}
        onOpenChange={(o) => {
          if (!o && overflowConfirm) {
            const { resolve } = overflowConfirm;
            setOverflowConfirm(null);
            resolve(false);
          }
        }}
        title="Antrian retry penuh"
        description={
          overflowConfirm
            ? `1000 tagihan akan diproses sekarang. Sisa ${overflowConfirm.total - 1000} tagihan: jalankan ulang "Coba Lagi Link" setelah batch ini selesai.`
            : ""
        }
        onConfirm={handleOverflowConfirm}
        confirmLabel="Mulai Proses"
      />

      {statsState === "error" && <Alert><AlertTitle>Ringkasan tagihan belum dapat dimuat</AlertTitle><AlertDescription><Button variant="outline" onClick={fetchStats}>Muat ulang ringkasan</Button></AlertDescription></Alert>}
      {statsState === "ready" && <StatsCardsRow cols={stats.pendingPaymentLink > 0 ? 6 : 5}>
        <StatCard label="Total Tagihan" value={stats.total} icon={Receipt} color="primary" index={0} />
        <StatCard label="Draft" value={stats.draft} icon={Clock} color="warning" index={1} />
        <StatCard label="Lunas" value={stats.paid} icon={CheckCircle} color="success" index={2} />
        <StatCard label="Dibayar Sebagian" value={stats.partiallyPaid} icon={CircleDashed} color="warning" index={3} />
        <StatCard label="Lewat Tempo" value={stats.overdue} icon={AlertTriangle} color="error" index={4} />
        {stats.pendingPaymentLink > 0 && (
          <StatCard label="Link Gagal" value={stats.pendingPaymentLink} icon={LinkIcon} color="warning" index={5} />
        )}
      </StatsCardsRow>}
      {/* FIN-13: Rupiah next to the counts — what is still owed, and what came in this month. */}
      {statsState === "ready" && <StatsCardsRow cols={2}>
        <StatCard
          label="Piutang"
          value={formatRupiah(stats.outstanding)}
          sublabel={`${stats.owing} tagihan belum lunas`}
          icon={Wallet}
          color="warning"
          index={6}
        />
        <StatCard
          label="Diterima Bulan Ini"
          value={formatRupiah(stats.collectedThisMonth)}
          sublabel="Pembayaran tercatat, tanpa yang dibatalkan"
          icon={Banknote}
          color="success"
          index={7}
        />
      </StatsCardsRow>}

      <DataTableToolbar
        searchPlaceholder="Cari siswa atau nomor tagihan..."
        onSearchChange={handleSearchChange}
        filters={[
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            onChange: (v) => {
              setStatusFilter(v);
              setPagination((p) => ({ ...p, page: 1 }));
            },
            options: statusOptions,
          },
        ]}
      />

      {fetchError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive-subtle p-6 flex items-start gap-3">
          <AlertCircle className="size-5 shrink-0 text-destructive mt-0.5" />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-semibold text-foreground">Gagal memuat tagihan</p>
            <p className="text-sm text-muted-foreground">Coba lagi sebentar. Jika tetap gagal, hubungi tim teknis.</p>
            <Button size="sm" variant="outline" onClick={fetchInvoices}>
              <RefreshCw size={14} className="mr-1.5" /> Coba lagi
            </Button>
          </div>
        </div>
      ) : (
        <DataTable
          columns={columnsWithActions}
          data={data}
          pagination={pagination}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          onSortChange={handleSortChange}
          defaultSort={{ field: "createdAt", order: "desc" }}
          loading={loading}
          emptyTitle="Belum ada tagihan"
          emptyDescription="Buat tagihan bulanan untuk semua siswa aktif"
          isFiltered={search.trim() !== "" || statusFilter !== "all"}
        />
      )}

      {/* Bulk Retry Confirmation */}
      <ConfirmDialog
        open={retryConfirmOpen}
        onOpenChange={setRetryConfirmOpen}
        title="Coba Lagi Link Pembayaran"
        description={`Membuat ulang link untuk ${stats.pendingPaymentLink} tagihan. Lanjutkan?`}
        onConfirm={handleBulkRetry}
        confirmLabel="Lanjutkan"
      />

      {/* Void Confirmation */}
      <ConfirmDialog
        open={!!voidTarget}
        onOpenChange={(o) => !o && setVoidTarget(null)}
        title="Batalkan Tagihan"
        description={`Tagihan ${voidTarget?.invoiceNumber} (${voidTarget?.student.name}) tidak bisa dibayar lagi. Riwayat tetap tersimpan.`}
        onConfirm={handleVoidInvoice}
        confirmLabel="Ya, Batalkan"
        destructive
      />

      {/* WhatsApp reminder queue (cycle 2026-10-17-payment-link-reminders) —
          same permission as "Cek semua belum lunas"; making a missing link
          from inside it additionally needs `create`. */}
      {capabilities.recordPayment && (
        <ReminderQueueDialog
          open={reminderQueueOpen}
          onOpenChange={setReminderQueueOpen}
          capabilities={{ create: capabilities.create }}
        />
      )}

      {/* Manual single-invoice creation — own component handles Dialog/Sheet
          switch internally and pushes to detail page on success. */}
      <ManualInvoiceDialog
        open={manualDialog}
        onOpenChange={setManualDialog}
        // "Sudah dibayar" records the payment too, so it needs payments.record as well as invoices.create.
        canRecordPayment={capabilities.recordPayment}
        // FIND-012: pre-fix the dialog navigated straight to /admin/invoices/[id]
        // after create. When the admin clicked back to the list, the client
        // component re-mounted and re-fetched from scratch, showing the
        // 0-tagihan skeleton for 3-5s. Wiring onCreated here warms the
        // list+stats cache *before* nav, so the return trip is instant.
        onCreated={() => {
          fetchInvoices();
          fetchStats();
        }}
      />

      {/* SPP paid in advance (cycle 2026-10-27-paid-invoice-spp-prepay) — preview,
          then one confirm that settles every month. Needs create + recordPayment. */}
      {canPrepaySpp && (
        <SppPrepayDialog
          open={sppPrepayDialog}
          onOpenChange={setSppPrepayDialog}
          onRecorded={() => {
            fetchInvoices();
            fetchStats();
          }}
        />
      )}

      {/* Billing Run wizard (Cycle B1, Tasks T8-T9) — the sole bulk-generate
          entry point since Task T10 retired the legacy "Buat Tagihan
          Bulanan" dialog/sheet and its plan/batch routes. */}
      <BillingRunWizard
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) handleWizardCommitted();
        }}
        resumeRunId={wizardResumeId}
        resumeCommitting={draftRun?.id === wizardResumeId && draftRun?.status === "COMMITTING"}
        years={years}
        onDraftChanged={fetchDraftRun}
        onCommitted={handleWizardCommitted}
      />

    </>
  );
}
