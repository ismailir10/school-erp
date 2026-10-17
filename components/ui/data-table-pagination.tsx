"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface DataTablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

export function DataTablePagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: DataTablePaginationProps) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <div>
        Menampilkan {start}–{end} dari {total}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(pageSize)}
          onValueChange={(v) => v && onPageSizeChange?.(parseInt(v))}
        >
          {/* Renders only the page-size number, so nothing supplies an
              accessible name — a screen reader announces "20, combobox" with
              no indication of what it controls. */}
          <SelectTrigger aria-label="Baris per halaman" className="h-8 w-[70px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 20, 50, 100].map((size) => (
              <SelectItem key={size} value={String(size)}>{size}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs" aria-live="polite">
          Hal. {page}/{totalPages}
        </span>

        <div className="flex gap-1" role="group" aria-label="Navigasi halaman">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange?.(1)}
            disabled={page <= 1}
            aria-label="Halaman pertama"
          >
            <ChevronsLeft size={14} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange?.(page - 1)}
            disabled={page <= 1}
            aria-label={`Halaman sebelumnya, ${Math.max(1, page - 1)}`}
          >
            <ChevronLeft size={14} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange?.(page + 1)}
            disabled={page >= totalPages}
            aria-label={`Halaman berikutnya, ${Math.min(totalPages, page + 1)}`}
          >
            <ChevronRight size={14} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange?.(totalPages)}
            disabled={page >= totalPages}
            aria-label="Halaman terakhir"
          >
            <ChevronsRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
