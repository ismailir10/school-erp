"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DossierSection } from "@/components/admin/dossier-section";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateShort } from "@/lib/format";

type AttendanceRecord = { id: string; date: string; status: string; notes: string | null; classSection: { name: string } };
type AttendanceSummary = { present: number; absent: number; sick: number; permission: number; total: number };

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * "Kehadiran" — lazy, like Keringanan/Buku Penghubung: nothing is requested
 * until the section is opened (`active` flips true and never back). Owns its
 * own month picker and fetch, unlike those two blocks, because changing the
 * month re-requests even after the initial open.
 */
export const KehadiranSection = memo(function KehadiranSection({
  studentId,
  active,
  open,
  onOpenChange,
}: {
  studentId: string;
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [month, setMonth] = useState<string>(() => currentMonth());
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAttendance = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/students/${studentId}/attendance?month=${m}`);
      if (!res.ok) { toast.error("Gagal memuat riwayat kehadiran"); return; }
      const data = await res.json();
      setRecords(data.records);
      setSummary(data.summary);
    } catch {
      toast.error("Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  // One-way latch: `records !== null` is the guard, not an input to re-run on
  // — the first open of the section pays for the fetch, later opens don't.
  useEffect(() => {
    if (!active || records !== null) return;
    fetchAttendance(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function handleMonthChange(value: string) {
    setMonth(value);
    if (value) fetchAttendance(value);
  }

  return (
    <DossierSection
      id="kehadiran"
      label="Kehadiran"
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <Input
          type="month"
          className="h-8 w-40 text-base md:text-xs"
          aria-label="Bulan kehadiran"
          value={month}
          onChange={(e) => handleMonthChange(e.target.value)}
        />
      }
    >
      {summary && (
        <div className="mb-4 grid grid-cols-4 gap-3">
          <div className="rounded-lg border p-2.5 text-center">
            <p className="text-lg font-bold text-status-present-text">{summary.present}</p>
            <p className="text-xs text-muted-foreground">Hadir</p>
          </div>
          <div className="rounded-lg border p-2.5 text-center">
            <p className="text-lg font-bold text-status-absent-text">{summary.absent}</p>
            <p className="text-xs text-muted-foreground">Alpa</p>
          </div>
          <div className="rounded-lg border p-2.5 text-center">
            <p className="text-lg font-bold text-status-leave-text">{summary.sick}</p>
            <p className="text-xs text-muted-foreground">Sakit</p>
          </div>
          <div className="rounded-lg border p-2.5 text-center">
            <p className="text-lg font-bold text-status-leave-text">{summary.permission}</p>
            <p className="text-xs text-muted-foreground">Izin</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : !records || records.length === 0 ? (
        <EmptyState title="Belum ada data kehadiran" description="Belum ada rekap kehadiran untuk bulan ini." />
      ) : (
        <div className="space-y-0">
          {records.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-b border-border/50 py-2.5 last:border-0">
              <div>
                <p className="text-sm font-medium">{formatDateShort(r.date)}</p>
                <p className="text-xs text-muted-foreground">{r.classSection.name}{r.notes ? ` · ${r.notes}` : ""}</p>
              </div>
              <StatusBadge status={r.status} />
            </div>
          ))}
        </div>
      )}
    </DossierSection>
  );
});
