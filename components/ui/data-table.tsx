"use client";

import { flexRender } from "@tanstack/react-table";
import type { CellData, RowData, SortingState, TableFeatures } from "@tanstack/react-table";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useLegacyTable,
} from "@tanstack/react-table/legacy";
import type { LegacyColumn, LegacyColumnDef } from "@tanstack/react-table/legacy";
import { useEffect, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DataTablePagination } from "./data-table-pagination";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";
import { Inbox, SearchX } from "lucide-react";

/**
 * Mobile contract for every DataTable consumer (cycle 2026-09-26,
 * admin-ui-standard-c1 T1).
 *
 * - `priority: "low"` marks a column secondary (created/updated-at, ids, …):
 *   hidden below `md`, back on `md+`.
 * - `sticky: "right"` pins a column to the right edge when a table overflows — the
 *   row-actions column gets this automatically by `id === "actions"`, but a
 *   column can opt in explicitly if a page names its actions column
 *   differently.
 */
// The interface this augments lives in `@tanstack/table-core` (v9 split core
// from `@tanstack/react-table`, which re-exports it via `export *`) — that is
// the module TypeScript's declaration merging actually needs named here, not
// the re-exporting package.
declare module "@tanstack/table-core" {
  // Declaration merging: these generics must match upstream's ColumnMeta exactly,
  // even though our two added fields do not use them.
  /* eslint-disable @typescript-eslint/no-unused-vars */
  interface ColumnMeta<
    in out TFeatures extends TableFeatures,
    in out TData extends RowData,
    TValue extends CellData = CellData,
  > {
    priority?: "low";
    sticky?: "right";
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}

function isStickyRight<TData extends RowData>(column: LegacyColumn<TData>) {
  return column.id === "actions" || column.columnDef.meta?.sticky === "right";
}

function isLowPriority<TData extends RowData>(column: LegacyColumn<TData>) {
  return column.columnDef.meta?.priority === "low";
}

// Same left shadow on the header (`bg-muted` twin of the body's
// `bg-background`) so the sticky action column reads as one opaque strip
// instead of the header seam showing through under it while scrolled.
const STICKY_RIGHT_CLASS =
  "sticky right-0 z-[1] shadow-sticky-edge";

/**
 * Tracks whether the table's horizontal scroll container overflows to the
 * right and hasn't been scrolled to the end yet — drives the edge-fade
 * affordance below `md`. `Table` (components/ui/table.tsx) owns the actual
 * scrolling div (`data-slot="table-container"`) and has other consumers, so
 * this reaches it by selector off a ref on our own wrapper rather than
 * asking `Table` for a new prop.
 */
function useEdgeFade(watch: unknown) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(false);

  useEffect(() => {
    const scrollEl = wrapperRef.current?.querySelector<HTMLElement>(
      '[data-slot="table-container"]'
    );
    if (!scrollEl) return;

    const update = () => {
      const overflowing = scrollEl.scrollWidth - scrollEl.clientWidth > 1;
      const atEnd =
        scrollEl.scrollWidth - scrollEl.clientWidth - scrollEl.scrollLeft <= 1;
      setShowFade(overflowing && !atEnd);
    };

    update();
    scrollEl.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scrollEl);
    const tableEl = scrollEl.querySelector("table");
    if (tableEl) observer.observe(tableEl);

    return () => {
      scrollEl.removeEventListener("scroll", update);
      observer.disconnect();
    };
    // `watch` is deliberately the only dep — it's a cheap proxy ("loading" or
    // a `data`/`columns` length key) for "the table's shape changed enough to
    // re-measure"; `wrapperRef` is a stable ref and never needs to retrigger.
  }, [watch]);

  return { wrapperRef, showFade };
}

interface DataTableProps<TData extends RowData> {
  columns: LegacyColumnDef<TData>[];
  data: TData[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  onSortChange?: (field: string, order: "asc" | "desc") => void;
  defaultSort?: { field: string; order: "asc" | "desc" };
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * Optional call-to-action rendered on the empty state (e.g. "Tambah
   * Kampus" opening the create dialog). Pass-through to `EmptyState`'s own
   * `actionLabel`/`actionHref`/`onAction` — provide either `onClick` or
   * `href`, not both.
   */
  emptyAction?: { label: string; onClick?: () => void; href?: string };
  /**
   * True while a search or filter is narrowing the list. An empty result then
   * means "nothing matches", not "nothing exists yet" — so the first-run copy
   * and CTA (`emptyTitle` / `emptyDescription` / `emptyAction`) are replaced by
   * a no-match message (CORE-9 / FIN-12).
   */
  isFiltered?: boolean;
  loading?: boolean;
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  pagination,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  defaultSort,
  emptyTitle = "Belum ada data untuk ditampilkan",
  emptyDescription,
  emptyAction,
  isFiltered = false,
  loading = false,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(
    defaultSort
      ? [{ id: defaultSort.field, desc: defaultSort.order === "desc" }]
      : []
  );
  const isClientPaginated = Boolean(pagination && !onPageChange);
  const [clientPage, setClientPage] = useState(pagination?.page ?? 1);
  const [clientPageSize, setClientPageSize] = useState(pagination?.pageSize ?? 10);
  const clientTotalPages = Math.max(1, Math.ceil(data.length / clientPageSize));
  const displayPagination = pagination
    ? isClientPaginated
      ? {
          page: Math.min(clientPage, clientTotalPages),
          pageSize: clientPageSize,
          total: data.length,
          totalPages: clientTotalPages,
        }
      : pagination
    : undefined;

  useEffect(() => {
    if (!isClientPaginated) return;
    setClientPage((page) => Math.min(page, clientTotalPages));
  }, [clientTotalPages, isClientPaginated]);

  const table = useLegacyTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: onSortChange ? undefined : getSortedRowModel(),
    getPaginationRowModel: isClientPaginated ? getPaginationRowModel() : undefined,
    onSortingChange: setSorting,
    state: {
      sorting,
      ...(displayPagination && isClientPaginated
        ? {
            pagination: {
              pageIndex: Math.max(0, displayPagination.page - 1),
              pageSize: displayPagination.pageSize,
            },
          }
        : {}),
    },
    manualPagination: !isClientPaginated,
    manualSorting: !!onSortChange,
    pageCount: pagination?.totalPages ?? -1,
  });

  // Notify parent when sorting changes (server-side sorting)
  useEffect(() => {
    if (!onSortChange || sorting.length === 0) return;
    const { id, desc } = sorting[0];
    onSortChange(id, desc ? "desc" : "asc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorting]);

  const { wrapperRef, showFade: overflowsToTheRight } = useEdgeFade(
    loading ? "loading" : `${data.length}-${columns.length}`
  );
  // A sticky-right column's own left shadow already signals "there's more
  // this way" — stacking the edge-fade under it (it sits at the same right-0
  // edge, opaque, with a higher z-index) would just hide the fade entirely.
  // Show it only on tables with no sticky column to speak for them.
  const hasStickyColumn = table.getVisibleLeafColumns().some(isStickyRight);
  const showFade = overflowsToTheRight && !hasStickyColumn;

  if (loading) {
    return (
      <div ref={wrapperRef} className="relative rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {columns.map((column, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    column.meta?.priority === "low" && "hidden md:table-cell",
                    (column.id === "actions" || column.meta?.sticky === "right") &&
                      cn(STICKY_RIGHT_CLASS, "bg-muted")
                  )}
                >
                  <Skeleton className="h-4 w-20" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[1, 2, 3, 4, 5].map((row) => (
              <TableRow key={row} className="group/row">
                {columns.map((column, i) => (
                  <TableCell
                    key={i}
                    className={cn(
                      column.meta?.priority === "low" && "hidden md:table-cell",
                      (column.id === "actions" || column.meta?.sticky === "right") &&
                        cn(STICKY_RIGHT_CLASS, "bg-background group-hover/row:bg-muted/50")
                    )}
                  >
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (data.length === 0 && !loading) {
    return (
      <EmptyState
        icon={isFiltered ? SearchX : Inbox}
        title={isFiltered ? "Tidak ada hasil yang cocok" : emptyTitle}
        description={
          isFiltered ? "Coba kata kunci lain, atau atur ulang pencarian dan filter." : emptyDescription
        }
        actionLabel={isFiltered ? undefined : emptyAction?.label}
        actionHref={isFiltered ? undefined : emptyAction?.href}
        onAction={isFiltered ? undefined : emptyAction?.onClick}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div ref={wrapperRef} className="relative rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/50">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "text-xs font-semibold text-muted-foreground tracking-wider",
                      isLowPriority(header.column) && "hidden md:table-cell",
                      isStickyRight(header.column) &&
                        cn(STICKY_RIGHT_CLASS, "bg-muted")
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="group/row hover:bg-muted/30 transition-colors"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      "text-sm",
                      isLowPriority(cell.column) && "hidden md:table-cell",
                      isStickyRight(cell.column) &&
                        cn(
                          STICKY_RIGHT_CLASS,
                          "bg-background group-hover/row:bg-muted/30 transition-colors"
                        )
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {/* Edge-fade affordance — hints there's more to the right below `md`,
            where the table scrolls horizontally instead of wrapping. */}
        {showFade && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-r from-transparent to-background md:hidden"
          />
        )}
      </div>

      {displayPagination && (
        <DataTablePagination
          page={displayPagination.page}
          pageSize={displayPagination.pageSize}
          total={displayPagination.total}
          totalPages={displayPagination.totalPages}
          onPageChange={
            isClientPaginated
              ? (page) => setClientPage(Math.min(Math.max(page, 1), clientTotalPages))
              : onPageChange
          }
          onPageSizeChange={
            isClientPaginated
              ? (pageSize) => {
                  setClientPageSize(pageSize);
                  setClientPage(1);
                }
              : onPageSizeChange
          }
        />
      )}
    </div>
  );
}
