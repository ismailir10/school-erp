"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { formatRupiah } from "@/lib/format";
import { userMessage, ApiError } from "@/lib/api/client-errors";
import { cn } from "@/lib/utils";
import { rowHasKeringanan } from "@/lib/finance/billing-run-line-source";
import { isZeroTotal, ZERO_TOTAL_REASON } from "@/lib/finance/billing-run-zero-total";
import { EditableRowLines } from "./line-editor";
import { WizardFooter } from "./wizard-footer";
import type {
  BillingRunLineData,
  BillingRunRowData,
  BillingRunRowsPage,
  FeeComponentOption,
} from "./types";

// Step 2 — Review (Cycle B1, Task T9; made editable in Cycle B2, Task T5).
// The read-only line list from B1 is now editable on rows whose status is
// PENDING or EXCLUDED (see `EDITABLE_ROW_STATUSES` below, mirroring the
// line-mutation routes' `MUTABLE_ROW_STATUSES` allowlist) — a component
// amount can be edited, an ad-hoc discount or catalog line can be added, and
// a line can be removed, via `line-editor.tsx`. Other rows (COMMITTED,
// SKIPPED_*, FAILED) keep the plain read-only list, since nothing there can
// be edited anyway. The per-row exclude/include toggle
// (`PATCH /api/billing-runs/[id]/rows/[rowId]`) is unchanged from B1.
//
// Server-paginated against `GET /api/billing-runs/[id]` (Assumption 4) — a
// run is ~200 students x ~3 lines, so this fetches one page at a time as the
// admin pages through rather than the whole run at once. Step 3 (commit)
// needs the full row set for its totals + row-id list, so it does its own
// bounded multi-page fetch on entry rather than this step keeping every page
// it has ever loaded in memory.

const DEFAULT_PAGE_SIZE = 20;

// Statuses billed for reasons the draft already knows and can't be changed
// from here — no lines were ever materialized for these (see
// lib/finance/build-billing-run.ts), so there is nothing to expand and no
// exclude/include toggle makes sense.
const SKIP_REASON_LABEL: Partial<Record<BillingRunRowData["status"], string>> = {
  SKIPPED_ALREADY_INVOICED: "Sudah pernah ditagih periode ini",
  SKIPPED_NO_FEE_STRUCTURE: "Tidak ada struktur biaya berlaku",
  SKIPPED_ON_LEAVE: "Sedang cuti",
};

// Shared with step 3's "Dengan keringanan" count via
// lib/finance/billing-run-line-source.ts, so the badge and the count can never
// disagree about what a keringanan is. See rowHasKeringanan's doc comment for
// why `adjustmentAmount !== 0` alone is the wrong test.
function hasAdjustment(row: BillingRunRowData): boolean {
  return rowHasKeringanan(row.lines);
}

// Rows editable from step 2 (Cycle B2) — mirrors `MUTABLE_ROW_STATUSES` in
// app/api/billing-runs/[id]/rows/[rowId]/lines/route.ts exactly, so the UI
// never offers an edit/add/remove action the server will refuse with a 409.
const EDITABLE_ROW_STATUSES = new Set<BillingRunRowData["status"]>(["PENDING", "EXCLUDED"]);

function hasLineSource(row: BillingRunRowData, source: string): boolean {
  return row.lines.some((l) => l.source === source);
}

function RowSkeleton() {
  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <Skeleton className="size-4 shrink-0 rounded-sm" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-9 rounded-full" />
      </div>
    </li>
  );
}

function RowLines({ row }: { row: BillingRunRowData }) {
  return (
    <ul className="mt-3 space-y-2 border-t border-border/60 pt-3 pl-7">
      {row.lines.map((line) => (
        <li key={line.id} className="flex items-center justify-between gap-3 text-small">
          <div className="min-w-0">
            <p className="text-foreground">{line.labelSnapshot}</p>
            {/* Non-zero only — the parent invoice sheet gets this right
                (app/parent/invoices/invoice-detail-sheet.tsx) and the admin
                invoice detail page renders "Penyesuaian: Rp 0" on unadjusted
                lines; this follows the parent one. */}
            {Number(line.adjustmentAmount) !== 0 ? (
              <p className="text-caption text-muted-foreground">
                Penyesuaian: {formatRupiah(line.adjustmentAmount)}
                {line.adjustmentNote ? ` (${line.adjustmentNote})` : ""}
              </p>
            ) : null}
          </div>
          <span className="font-currency shrink-0 tabular-nums text-foreground">
            {formatRupiah(line.finalAmount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RunRow({
  runId,
  row,
  expanded,
  onToggleExpand,
  onToggleInclude,
  toggling,
  feeComponents,
  onLineUpdated,
  onLineAdded,
  onLineRemoved,
}: {
  runId: string;
  row: BillingRunRowData;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleInclude: () => void;
  toggling: boolean;
  feeComponents: FeeComponentOption[];
  onLineUpdated: (rowId: string, line: BillingRunLineData, totalDue: number) => void;
  onLineAdded: (rowId: string, line: BillingRunLineData, totalDue: number) => void;
  onLineRemoved: (rowId: string, lineId: string, totalDue: number) => void;
}) {
  const skipReason = SKIP_REASON_LABEL[row.status];
  const excluded = row.status === "EXCLUDED";
  // Rp 0 (keringanan >= SPP, or a line edited to 0): the commit leaves it out
  // instead of creating an invoice nobody can collect (FINX-4). Said plainly
  // here so the admin sees why before committing.
  const zeroTotal = !skipReason && row.lines.length > 0 && isZeroTotal(row.totalDue);
  const toggleable = row.status === "PENDING" || row.status === "EXCLUDED";
  const canExpand = row.lines.length > 0;
  const adjustmentBadge = hasAdjustment(row);
  const editable = EDITABLE_ROW_STATUSES.has(row.status);
  const editedBadge = hasLineSource(row, "EDITED");
  const manualBadge = hasLineSource(row, "MANUAL");

  return (
    <li
      className={cn(
        "rounded-lg border p-3 transition-colors",
        excluded && "border-dashed bg-muted/30",
      )}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleExpand}
          disabled={!canExpand}
          aria-expanded={expanded}
          aria-controls={`billing-run-row-${row.id}-lines`}
          aria-label={
            canExpand
              ? `${expanded ? "Sembunyikan" : "Tampilkan"} rincian tagihan ${row.studentNameSnapshot}`
              : "Tidak ada rincian"
          }
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight
            size={16}
            aria-hidden="true"
            className={cn("transition-transform", expanded && "rotate-90")}
          />
        </button>

        <div className={cn("min-w-0 flex-1", excluded && "opacity-60")}>
          <p className="truncate text-body font-medium text-foreground">
            {row.studentNameSnapshot}
          </p>
          <p className="flex gap-1 text-small text-muted-foreground">
            <span className="truncate">{row.classLabelSnapshot ?? "Tanpa kelas"}</span>
            {row.programLabel && <span className="max-w-[50%] shrink-0 truncate">· {row.programLabel}</span>}
          </p>
        </div>

        {adjustmentBadge && !skipReason ? (
          <Badge variant="secondary" className="shrink-0 text-xs">
            Keringanan
          </Badge>
        ) : null}

        {editedBadge && !skipReason ? (
          <Badge variant="outline" className="shrink-0 text-xs">
            Diedit
          </Badge>
        ) : null}

        {manualBadge && !skipReason ? (
          <Badge variant="outline" className="shrink-0 text-xs">
            Manual
          </Badge>
        ) : null}

        {skipReason ? (
          <span className="shrink-0 text-caption text-muted-foreground">{skipReason}</span>
        ) : zeroTotal ? (
          <span className="shrink-0 text-caption text-muted-foreground">{ZERO_TOTAL_REASON}</span>
        ) : (
          <span
            className={cn(
              "font-currency shrink-0 font-medium tabular-nums",
              excluded ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {formatRupiah(row.totalDue)}
          </span>
        )}

        {toggleable ? (
          <Switch
            checked={!excluded}
            onCheckedChange={onToggleInclude}
            disabled={toggling}
            aria-label={
              excluded
                ? `Sertakan ${row.studentNameSnapshot} dalam tagihan`
                : `Kecualikan ${row.studentNameSnapshot} dari tagihan`
            }
          />
        ) : null}
      </div>

      {/* Why a row is excluded: a leave recorded after the draft was built parks the row with its
          reason. Without it the row looks like the admin's own exclusion and invites switching it
          back on, which would bill the child again. A manual exclusion carries no reason. */}
      {excluded && row.error ? (
        <p className="mt-1 pl-9 text-small text-muted-foreground">{row.error}</p>
      ) : null}

      {expanded && canExpand ? (
        <div id={`billing-run-row-${row.id}-lines`}>
          {editable ? (
            <EditableRowLines
              runId={runId}
              row={row}
              feeComponents={feeComponents}
              onLineUpdated={(line, totalDue) => onLineUpdated(row.id, line, totalDue)}
              onLineAdded={(line, totalDue) => onLineAdded(row.id, line, totalDue)}
              onLineRemoved={(lineId, totalDue) => onLineRemoved(row.id, lineId, totalDue)}
            />
          ) : (
            <RowLines row={row} />
          )}
        </div>
      ) : null}
    </li>
  );
}

export function ReviewStep({
  runId,
  onAdvance,
  onClose,
}: {
  runId: string;
  onAdvance: () => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [rowsPage, setRowsPage] = useState<BillingRunRowsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [feeComponents, setFeeComponents] = useState<FeeComponentOption[]>([]);

  // Reference data for the "Tambah komponen" catalog picker (line-editor.tsx)
  // — fetched once per step-2 mount, shared across every row rather than
  // each row's editor fetching its own copy. Filtering to
  // isEnabled/ACTIVE/not-already-on-the-row happens per-row in line-editor.tsx
  // since that depends on each row's current lines.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/fee-components")
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        const json = await res.json();
        if (!cancelled && Array.isArray(json)) setFeeComponents(json as FeeComponentOption[]);
      })
      .catch((err) => {
        console.error("[billing-run-wizard] fee components fetch failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPage = useCallback(
    async (targetPage: number, targetPageSize: number) => {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await fetch(
          `/api/billing-runs/${runId}?page=${targetPage}&pageSize=${targetPageSize}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setRowsPage(json.rows as BillingRunRowsPage);
      } catch (err) {
        console.error("[billing-run-wizard] rows fetch failed", err);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [runId],
  );

  useEffect(() => {
    loadPage(page, pageSize);
  }, [loadPage, page, pageSize]);

  function handlePageSizeChange(nextPageSize: number) {
    setPageSize(nextPageSize);
    setPage(1);
  }

  async function handleToggleInclude(row: BillingRunRowData) {
    const nextStatus = row.status === "EXCLUDED" ? "PENDING" : "EXCLUDED";
    setTogglingId(row.id);
    try {
      const res = await fetch(`/api/billing-runs/${runId}/rows/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(body?.error || "Gagal mengubah status baris");
      }
      const updated = await res.json();
      setRowsPage((prev) =>
        prev
          ? {
              ...prev,
              data: prev.data.map((r) => (r.id === row.id ? { ...r, status: updated.status } : r)),
            }
          : prev,
      );
    } catch (err) {
      toast.error(userMessage(err, "Gagal mengubah status baris"));
    } finally {
      setTogglingId(null);
    }
  }

  // The three line-mutation outcomes from line-editor.tsx. Each patches
  // local state from the mutation route's response (line + row totalDue)
  // rather than refetching the page — same pattern as `handleToggleInclude`
  // above.
  function patchRowLines(rowId: string, updater: (row: BillingRunRowData) => BillingRunRowData) {
    setRowsPage((prev) =>
      prev
        ? { ...prev, data: prev.data.map((r) => (r.id === rowId ? updater(r) : r)) }
        : prev,
    );
  }

  function handleLineUpdated(rowId: string, line: BillingRunLineData, totalDue: number) {
    patchRowLines(rowId, (r) => ({
      ...r,
      totalDue,
      lines: r.lines.map((l) => (l.id === line.id ? line : l)),
    }));
  }

  function handleLineAdded(rowId: string, line: BillingRunLineData, totalDue: number) {
    patchRowLines(rowId, (r) => ({ ...r, totalDue, lines: [...r.lines, line] }));
  }

  function handleLineRemoved(rowId: string, lineId: string, totalDue: number) {
    patchRowLines(rowId, (r) => ({
      ...r,
      totalDue,
      lines: r.lines.filter((l) => l.id !== lineId),
    }));
  }

  if (loading && !rowsPage) {
    return (
      <div className="space-y-field">
        <ul className="space-y-2" aria-hidden="true">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </ul>
        <WizardFooter>
          <Button type="button" variant="ghost" disabled>
            Tutup
          </Button>
          <Button type="button" disabled>
            Lanjutkan
          </Button>
        </WizardFooter>
      </div>
    );
  }

  if (loadError && !rowsPage) {
    return (
      <div className="space-y-field text-center">
        <p className="text-body text-muted-foreground">
          Daftar baris tagihan belum bisa dimuat. Coba lagi sebentar ya.
        </p>
        <div className="flex justify-center gap-2">
          <Button type="button" variant="outline" onClick={() => loadPage(page, pageSize)}>
            Coba Lagi
          </Button>
        </div>
      </div>
    );
  }

  const rows = rowsPage?.data ?? [];
  const pagination = rowsPage?.pagination;
  const isEmpty = pagination?.total === 0;

  return (
    <div className="space-y-field">
      {isEmpty ? (
        <EmptyState
          icon={ReceiptText}
          title="Draf tidak menghasilkan baris tagihan"
          description="Tidak ada siswa dalam cakupan yang cocok. Tutup wizard ini dan sesuaikan cakupan di langkah 1."
        />
      ) : (
        <>
          <ul className="space-y-2" aria-busy={loading}>
            {rows.map((row) => (
              <RunRow
                key={row.id}
                runId={runId}
                row={row}
                expanded={expandedId === row.id}
                onToggleExpand={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
                onToggleInclude={() => handleToggleInclude(row)}
                toggling={togglingId === row.id}
                feeComponents={feeComponents}
                onLineUpdated={handleLineUpdated}
                onLineAdded={handleLineAdded}
                onLineRemoved={handleLineRemoved}
              />
            ))}
          </ul>
          {pagination ? (
            <DataTablePagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              totalPages={pagination.totalPages}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : null}
        </>
      )}

      <WizardFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Tutup
        </Button>
        <Button type="button" onClick={onAdvance} disabled={isEmpty}>
          Lanjutkan
        </Button>
      </WizardFooter>
    </div>
  );
}
