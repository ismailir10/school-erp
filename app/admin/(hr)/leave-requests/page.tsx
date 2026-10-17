"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { Button } from "@/components/ui/button";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormRootError } from "@/components/ui/form";
import { Check, X, Clock, CheckCircle, XCircle, FileText } from "lucide-react";
import { toast } from "sonner";
import { formatDateShort } from "@/lib/format";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useRouter, useSearchParams } from "next/navigation";
import { leaveReviewFormSchema } from "@/lib/validations/leave";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type LeaveRequest = {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  reviewNote: string | null;
  createdAt: string;
  employee: {
    nama: string;
    kode: string;
    jabatan: string;
    campus: { name: string };
  };
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const TYPE_LABELS: Record<string, string> = {
  ANNUAL: "Cuti Tahunan",
  SICK: "Sakit",
  PERMISSION: "Izin",
  OTHER: "Lainnya",
};

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Review body (shared between Dialog on desktop and Sheet on mobile)
// ------------------------------------------------------------------

type LeaveReviewForm = ReturnType<typeof useZodForm<typeof leaveReviewFormSchema>>;

type ReviewBodyProps = {
  target: LeaveRequest;
  viewOnly: boolean;
  reviewAction: "approve" | "reject";
  form: LeaveReviewForm;
};

function LeaveReviewBody({
  target,
  viewOnly,
  reviewAction,
  form,
}: ReviewBodyProps) {
  return (
    <div className="space-y-3">
      <div className="text-sm">
        <p>
          <strong>Tanggal:</strong>{" "}
          {target.startDate ? formatDateShort(target.startDate) : ""} —{" "}
          {target.endDate ? formatDateShort(target.endDate) : ""}
        </p>
        <p>
          <strong>Alasan:</strong> {target.reason}
        </p>
        {target.reviewNote && (
          <p>
            <strong>Catatan:</strong> {target.reviewNote}
          </p>
        )}
      </div>
      {!viewOnly && (
        <>
          <FormRootError formState={form.formState} />
          <FormField
            control={form.control}
            name="note"
            label={reviewAction === "approve" ? "Catatan (opsional)" : "Alasan Penolakan"}
            required={reviewAction === "reject"}
            id="leave-review-note"
            render={({ field, controlProps }) => (
              <Textarea
                {...field}
                {...controlProps}
                value={field.value ?? ""}
                placeholder={
                  reviewAction === "approve"
                    ? "Catatan untuk karyawan..."
                    : "Jelaskan alasan penolakan..."
                }
                rows={2}
              />
            )}
          />
          {reviewAction === "approve" && (
            <p className="text-xs text-muted-foreground">
              Menyetujui akan otomatis membuat catatan kehadiran berstatus Izin untuk
              tanggal tersebut.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminLeavePage() {
  const routeSearchParams = useSearchParams();
  const requestId = routeSearchParams.get("requestId");
  const router = useRouter();
  const closedRequest = useRef<string | null>(null);
  const pageHeading = useRef<HTMLDivElement>(null);
  const openedFromLink = useRef(false);
  const [canApprove, setCanApprove] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [deepLinkError, setDeepLinkError] = useState(false);
  const [deepLinkLoading, setDeepLinkLoading] = useState(false);
  const [deepLinkRetry, setDeepLinkRetry] = useState(0);
  const [statsState, setStatsState] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<LeaveRequest[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });

  // F-21: single stats endpoint replaces the prior 3-call pattern. The old
  // code fired three sequential `pageSize=1` list queries just to read
  // `pagination.total` — wasteful when one `groupBy` returns all buckets.
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/leave/stats");
      if (!res.ok) throw new Error("stats unavailable");
      const json = await res.json();
      setStatsState("ready");
      setStats({
        total: json.total ?? 0,
        pending: json.pending ?? 0,
        approved: json.approved ?? 0,
        rejected: json.rejected ?? 0,
      });
    } catch {
      setStatsState("error");
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Review dialog
  const [reviewTarget, setReviewTarget] = useState<LeaveRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">("approve");
  const reviewForm = useZodForm(leaveReviewFormSchema, { defaultValues: { action: "approve", note: "" } });
  const [viewOnly, setViewOnly] = useState(false);

  const fetchRequests = useCallback(async () => {
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


      const res = await fetch(`/api/leave/requests?${params}`);
      if (!res.ok) throw new Error("leave unavailable");
      const json = await res.json();
      setCanApprove(json.capabilities?.approve === true);
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, statusFilter, sortBy, sortOrder]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    if (!requestId) {
      closedRequest.current = null;
      if (openedFromLink.current) setReviewTarget(null);
      return;
    }
    if (closedRequest.current === requestId) return;
    let active = true;
    setReviewTarget(null);
    setDeepLinkLoading(true);
    setDeepLinkError(false);
    // Resolve the selected record independently of table search, status and page.
    fetch(`/api/leave/requests?requestId=${encodeURIComponent(requestId)}&page=1&pageSize=1`)
      .then(async (res) => {
        if (!res.ok) throw new Error("request unavailable");
        const json = await res.json();
        if (!active) return;
        const record = json.data?.find((row: LeaveRequest) => row.id === requestId);
        if (!record) { setDeepLinkError(true); return; }
        setCanApprove(json.capabilities?.approve === true);
        openReview(record, "view", true);
      })
      .catch(() => { if (active) setDeepLinkError(true); })
      .finally(() => { if (active) setDeepLinkLoading(false); });
    return () => { active = false; };
    // `openReview` now closes over `reviewForm` (useZodForm's return value),
    // so the rule no longer treats it as stable (setState setters only).
    // It must stay out of these deps regardless — this effect fires once
    // per `requestId`/`deepLinkRetry` change, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, deepLinkRetry]);

  // ResponsiveFormDialog doesn't expose Base UI's `finalFocus` passthrough, so
  // a deep-linked review (opened with no trigger element to restore focus to)
  // would otherwise drop focus on close. Restore it to the page heading once
  // the dialog has actually unmounted — an effect, not an inline call in
  // closeReview(), so it runs after Base UI's own close/unmount work instead
  // of racing it (see reference_focus_settimeout_race).
  useEffect(() => {
    if (!reviewTarget && openedFromLink.current) {
      pageHeading.current?.focus();
      openedFromLink.current = false;
    }
  }, [reviewTarget]);

  function closeReview() {
    setDeepLinkError(false);
    setDeepLinkLoading(false);
    setReviewTarget(null);
    setViewOnly(false);
    if (requestId) {
      closedRequest.current = requestId;
      const next = new URLSearchParams(routeSearchParams.toString());
      next.delete("requestId");
      router.replace(`/admin/leave-requests${next.size ? `?${next}` : ""}`, { scroll: false });
    }
  }

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

  function openReview(req: LeaveRequest, action: "approve" | "reject" | "view", fromLink = false) {
    openedFromLink.current = fromLink;
    setReviewTarget(req);
    if (action === "view") {
      setViewOnly(true);
      reviewForm.reset({ action: reviewAction, note: "" });
    } else {
      setViewOnly(false);
      setReviewAction(action);
      reviewForm.reset({ action, note: "" });
    }
  }

  function switchReviewAction(action: "approve" | "reject") {
    setReviewAction(action);
    setViewOnly(false);
    reviewForm.setValue("action", action);
  }

  const handleReview = reviewForm.handleSubmit(async (values) => {
    if (!reviewTarget || !canApprove) return;
    try {
      await sendJson(
        `/api/leave/requests/${reviewTarget.id}/${values.action}`,
        { method: "POST", body: { note: values.note } },
        "Gagal memproses pengajuan cuti. Coba lagi.",
      );
      toast.success(values.action === "approve" ? "Cuti disetujui" : "Cuti ditolak");
      closeReview();
      fetchRequests();
      fetchStats();
    } catch (err) {
      applyServerErrors(reviewForm, err, "Gagal memproses pengajuan cuti. Coba lagi.");
    }
  });

  // ------------------------------------------------------------------
  // Columns (needs access to openReview)
  // ------------------------------------------------------------------

  // Memoized so TanStack's `flexRender` keeps one stable component per cell
  // (ui.md's DataTable note) — an unmemoized array rebuilt on every render
  // remounts every row's cells, which would close the row's "⋮" action
  // menu mid-interaction on any unrelated state update (e.g. the stats
  // fetch resolving).
  const columns: ColumnDef<LeaveRequest>[] = useMemo(() => [
    {
      id: "employee",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Karyawan" />
      ),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <DataTableLinkCell
            onClick={() => openReview(r, "view")}
            className="whitespace-normal"
            description={
              <>
                <span className="hidden md:inline">
                  {r.employee.jabatan} · {r.employee.campus.name}
                </span>
                <DataTableMobileMeta>
                  <StatusBadge status={r.leaveType} label={TYPE_LABELS[r.leaveType]} />
                  <span className="font-medium">{r.days} hari</span>
                  <span>
                    {formatDateShort(r.startDate)} — {formatDateShort(r.endDate)}
                  </span>
                  <StatusBadge status={r.status} />
                </DataTableMobileMeta>
              </>
            }
          >
            {r.employee.nama}
            <span className="ml-2 font-currency text-xs text-muted-foreground">
              {r.employee.kode}
            </span>
          </DataTableLinkCell>
        );
      },
    },
    {
      id: "leave",
      header: "Cuti",
      // Type, days, dates and status sit under the name below `md`.
      meta: { priority: "low" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div>
            <div className="flex items-center gap-2">
              <StatusBadge status={r.leaveType} label={TYPE_LABELS[r.leaveType]} />
              <span className="text-xs font-medium">{r.days} hari</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatDateShort(r.startDate)} — {formatDateShort(r.endDate)}
            </p>
          </div>
        );
      },
    },
    {
      id: "reason",
      header: "Alasan",
      meta: { priority: "low" },
      cell: ({ row }) => (
        <div className="max-w-[200px]">
          <p className="text-xs truncate">{row.original.reason}</p>
          {row.original.reviewNote && (
            <p className="text-xs text-muted-foreground italic mt-0.5 truncate">
              Catatan: {row.original.reviewNote}
            </p>
          )}
        </div>
      ),
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
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const r = row.original;
        const isPending = canApprove && r.status === "PENDING";
        return (
          <DataTableRowActions
            rowLabel={r.employee.nama}
            extraActions={
              isPending
                ? [
                    {
                      label: "Setujui",
                      icon: <Check size={14} />,
                      onClick: () => openReview(r, "approve"),
                    },
                    {
                      label: "Tolak",
                      icon: <X size={14} />,
                      onClick: () => openReview(r, "reject"),
                      destructive: true,
                    },
                  ]
                : undefined
            }
          />
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canApprove]);

  return (
    <>
      <div ref={pageHeading} tabIndex={-1} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
        <PageHeader
          title="Pengajuan Cuti"
          description={fetchError ? "Daftar pengajuan belum tersedia" : "Tinjau dan proses pengajuan cuti karyawan"}
        />
      </div>

      {deepLinkLoading && <p role="status" className="mb-field text-body">Memuat pengajuan yang dipilih…</p>}
      {deepLinkError && <Alert className="mb-field"><AlertTitle>Pengajuan tidak tersedia</AlertTitle><AlertDescription><p>Pengajuan tidak ditemukan atau tidak dapat dibuka dengan akses Anda.</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setDeepLinkRetry(value => value + 1)}>Coba lagi</Button><Button variant="ghost" onClick={closeReview}>Lihat daftar pengajuan</Button></div></AlertDescription></Alert>}
      {statsState === "error" && <Alert className="mb-field"><AlertTitle>Ringkasan izin belum tersedia</AlertTitle><AlertDescription><Button variant="outline" onClick={fetchStats}>Muat ulang ringkasan</Button></AlertDescription></Alert>}
      {statsState === "ready" && <StatsCardsRow>
        <StatCard label="Total Pengajuan" value={stats.total} icon={FileText} color="primary" index={0} />
        <StatCard label="Menunggu" value={stats.pending} icon={Clock} color="warning" index={1} />
        <StatCard label="Disetujui" value={stats.approved} icon={CheckCircle} color="success" index={2} />
        <StatCard label="Ditolak" value={stats.rejected} icon={XCircle} color="error" index={3} />
      </StatsCardsRow>}

      <DataTableToolbar
        searchPlaceholder="Cari nama karyawan..."
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
            options: [
              { value: "PENDING", label: "Menunggu" },
              { value: "APPROVED", label: "Disetujui" },
              { value: "REJECTED", label: "Ditolak" },
              { value: "all", label: "Semua" },
            ],
          },
        ]}
        actions={
          stats.pending > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
              <Clock size={12} /> Menunggu: {stats.pending}
            </span>
          ) : undefined
        }
      />

      {fetchError ? <Alert><AlertTitle>Daftar pengajuan belum dapat dimuat</AlertTitle><AlertDescription><Button onClick={fetchRequests} variant="outline">Coba lagi</Button></AlertDescription></Alert> : <DataTable
        columns={columns}
        data={data}
        pagination={pagination}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onSortChange={handleSortChange}
        defaultSort={{ field: "createdAt", order: "desc" }}
        loading={loading}
        emptyTitle="Tidak ada pengajuan cuti"
        emptyDescription="Pengajuan cuti dari guru akan muncul di sini."
      />}

      {/* Review dialog — Dialog on desktop, Sheet on mobile via ResponsiveFormDialog */}
      {reviewTarget && (
        <ResponsiveFormDialog
          open={!!reviewTarget}
          onOpenChange={(o) => { if (!o && !reviewForm.formState.isSubmitting) closeReview(); }}
          title={viewOnly ? "Detail Cuti" : reviewAction === "approve" ? "Setujui Cuti" : "Tolak Cuti"}
          description={
            <>
              {reviewTarget.employee.nama} —{" "}
              {TYPE_LABELS[reviewTarget.leaveType] ?? reviewTarget.leaveType} (
              {reviewTarget.days} hari)
            </>
          }
          size="xl"
          footer={
            <>
              <Button variant="ghost" onClick={closeReview} disabled={reviewForm.formState.isSubmitting}>
                {viewOnly ? "Tutup" : "Batal"}
              </Button>
              {/* FIND-018: mirror row-kebab Setujui/Tolak in detail view — the
                  detail view otherwise only offers Tutup, forcing admins to
                  close and re-open via the kebab to act. */}
              {viewOnly && canApprove && reviewTarget.status === "PENDING" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => switchReviewAction("reject")}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    Tolak
                  </Button>
                  <Button onClick={() => switchReviewAction("approve")}>
                    Setujui
                  </Button>
                </>
              )}
              {!viewOnly && (
                <Button
                  onClick={handleReview}
                  disabled={reviewForm.formState.isSubmitting}
                  variant={reviewAction === "reject" ? "destructive" : "default"}
                >
                  {reviewForm.formState.isSubmitting
                    ? "Memproses..."
                    : reviewAction === "approve"
                      ? "Setujui"
                      : "Tolak"}
                </Button>
              )}
            </>
          }
        >
          <LeaveReviewBody
            target={reviewTarget}
            viewOnly={viewOnly}
            reviewAction={reviewAction}
            form={reviewForm}
          />
        </ResponsiveFormDialog>
      )}
    </>
  );
}
