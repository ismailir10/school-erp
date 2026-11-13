"use client";

import { memo, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatRupiah, formatDateShort } from "@/lib/format";

/**
 * Keringanan block of the student dossier — the durable per-student fee
 * adjustments (`docs/cycles/2026-08-13-keringanan-fee-adjustments.md`) that
 * decide what this family is actually billed.
 *
 * Read-only by design. Granting, editing and deactivating a keringanan is a
 * money decision with its own validation and audit surface on
 * `/admin/fees?tab=keringanan`; duplicating that form here would mean two
 * places to keep correct. The dossier only has to answer "does this child hold
 * one, and for how much".
 *
 * Owns its own fetch: the section is lazy, so nothing is requested until an
 * admin opens it. `active` flips true on first open and never back — a second
 * open must not re-request.
 */

type Adjustment = {
  id: string;
  type: string;
  mode: string;
  value: number | string;
  reason: string;
  validFrom: string | null;
  validTo: string | null;
  status: string;
  feeComponent: { label: string } | null;
  academicYear: { name: string } | null;
};

const TYPE_LABELS: Record<string, string> = { DISCOUNT: "Diskon", SURCHARGE: "Tambahan" };

function formatValue(mode: string, value: number | string): string {
  return mode === "PERCENT" ? `${Number(value) || 0}%` : formatRupiah(value);
}

function formatValidity(from: string | null, to: string | null): string {
  if (!from && !to) return "Berlaku terus";
  if (from && to) return `${formatDateShort(from)} – ${formatDateShort(to)}`;
  if (from) return `Mulai ${formatDateShort(from)}`;
  return `Sampai ${formatDateShort(to!)}`;
}

export const StudentKeringananBlock = memo(function StudentKeringananBlock({
  studentId,
  active,
  onCountChange,
}: {
  studentId: string;
  active: boolean;
  /** Lets the section header show a count once the fetch lands. */
  onCountChange?: (count: number | null) => void;
}) {
  const [rows, setRows] = useState<Adjustment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      // pageSize 100: a single student's keringanan list is a handful of rows
      // per year, so one page is the whole truth and paging UI would be noise.
      const res = await fetch(
        `/api/student-fee-adjustments?studentId=${encodeURIComponent(studentId)}&pageSize=100`,
      );
      if (!res.ok) {
        setError(true);
        return;
      }
      const json = await res.json();
      const data: Adjustment[] = Array.isArray(json?.data) ? json.data : [];
      setRows(data);
      onCountChange?.(data.length);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [studentId, onCountChange]);

  useEffect(() => {
    if (!active || rows !== null || loading || error) return;
    load();
    // `rows`/`loading`/`error` are the guard, not inputs to re-run on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const feesLink = (
    <Link
      href="/admin/fees?tab=keringanan"
      className="text-sm text-primary-text hover:underline"
    >
      Kelola keringanan di halaman Biaya →
    </Link>
  );

  if (loading || (active && rows === null && !error)) {
    return (
      <div className="space-y-2">
        {[...Array(2)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Gagal memuat data keringanan.</p>
        <button
          type="button"
          onClick={load}
          className="rounded-md text-sm text-primary-text hover:underline outline-none focus-visible:focus-outline"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          title="Belum ada keringanan"
          description="Siswa ini belum menerima diskon atau tambahan biaya."
        />
        <div className="text-center">{feesLink}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-0">
        {rows.map((adj) => (
          <li
            key={adj.id}
            className="flex items-start justify-between gap-3 border-b border-border/50 py-2.5 last:border-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {TYPE_LABELS[adj.type] ?? adj.type} {formatValue(adj.mode, adj.value)}
                {adj.feeComponent ? ` · ${adj.feeComponent.label}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[adj.academicYear?.name, formatValidity(adj.validFrom, adj.validTo)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{adj.reason}</p>
            </div>
            <StatusBadge status={adj.status} />
          </li>
        ))}
      </ul>
      {feesLink}
    </div>
  );
});
