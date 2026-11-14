"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, Lock } from "lucide-react";
import { EntityLink } from "@/components/entity-link";
import { entityHref } from "@/lib/entity-links";
import { MESSAGES } from "@/lib/feedback";
import { campusShortLabels, formatDate, formatTime } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { BackLink } from "@/components/portal/back-link";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Users } from "lucide-react";

type DailyRow = {
  employee: { id: string; kode: string; nama: string; jabatan: string; campusId: string; campusName: string };
  attendance: {
    id: string;
    status: string;
    checkInTime: string | null;
    source: string;
    approvalStatus: string;
    isLocked: boolean;
  } | null;
};

type Campus = { id: string; name: string };

// Hadir / Sakit / Izin / Alpa → the codebase's own AttendanceRecord statuses.
const QUICK = [
  { status: "PRESENT", label: "Hadir" },
  { status: "SICK", label: "Sakit" },
  { status: "PERMISSION", label: "Izin" },
  { status: "ABSENT", label: "Alpa" },
] as const;

const SOURCE_LABEL: Record<string, string> = { SELF: "Mandiri", ADMIN: "Admin", KIOSK: "Kios" };

export default function DailyStaffAttendancePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-section px-page-x py-page-y">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      }
    >
      <DailyStaffAttendancePageInner />
    </Suspense>
  );
}

function DailyStaffAttendancePageInner() {
  // Empty until the server answers with today in the school's timezone.
  const [date, setDate] = useState("");
  const [today, setToday] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The URL is the single source of truth, so back/forward keeps the control in step.
  const rawCampusId = searchParams?.get("campusId") || "all";
  const [campuses, setCampuses] = useState<Campus[]>([]);
  // The URL value is only trusted once the campus list confirms it exists.
  const campusId = campuses.length === 0 || campuses.some((c) => c.id === rawCampusId) ? rawCampusId : "all";
  const campusShort = campusShortLabels(campuses.map((c) => c.name));
  const campusQs = campusId === "all" ? "" : `?campusId=${encodeURIComponent(campusId)}`;
  function selectCampus(v: string) {
    router.replace(v === "all" ? pathname : `${pathname}?campusId=${encodeURIComponent(v)}`, { scroll: false });
  }
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ campusId });
      if (date) params.set("date", date);
      const res = await fetch(`/api/attendance/daily?${params}`);
      if (!res.ok) {
        toast.error(MESSAGES.loadFailed("Data kehadiran"));
        return;
      }
      const body = (await res.json()) as { date: string; today: string; rows: DailyRow[] };
      setRows(body.rows);
      setToday(body.today);
      if (!date) setDate(body.date);
    } catch {
      toast.error(MESSAGES.loadFailed("Data kehadiran"));
    } finally {
      setLoading(false);
    }
  }, [date, campusId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/config/campuses")
      .then((r) => (r.ok ? r.json() : []))
      .then((c: Campus[]) => setCampuses(Array.isArray(c) ? c : []))
      .catch(() => {});
  }, []);

  const unmarked = rows.filter((r) => !r.attendance).length;
  const isFuture = !!today && !!date && date > today;

  const groups = useMemo(() => {
    const byCampus = new Map<string, { name: string; rows: DailyRow[] }>();
    for (const r of rows) {
      const g = byCampus.get(r.employee.campusId) ?? { name: r.employee.campusName, rows: [] };
      g.rows.push(r);
      byCampus.set(r.employee.campusId, g);
    }
    return [...byCampus.values()].sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [rows]);

  async function undo(ids: string[]) {
    try {
      const res = await fetch("/api/attendance/daily", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error();
      toast.success("Dibatalkan.");
    } catch {
      toast.error("Belum bisa membatalkan. Coba lagi sebentar ya.");
    }
    load();
  }

  async function markAll() {
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/daily/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, ...(campusId !== "all" ? { campusId } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof body.error === "string" ? body.error : "Belum bisa menandai. Coba lagi sebentar ya.");
        return;
      }
      const ids: string[] = body.ids ?? [];
      toast.success(`${body.count} staf ditandai hadir.`, {
        duration: 10_000,
        action: ids.length > 0 ? { label: "Urungkan", onClick: () => undo(ids) } : undefined,
      });
      await load();
    } catch {
      toast.error("Belum bisa menandai. Coba lagi sebentar ya.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(row: DailyRow, status: string) {
    if (row.attendance?.status === status && row.attendance.approvalStatus === "APPROVED") return;
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/daily", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: row.employee.id, date, status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof body.error === "string" ? body.error : "Belum bisa menyimpan. Coba lagi sebentar ya.");
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.employee.id === row.employee.id ? { ...r, attendance: body } : r)),
      );
    } catch {
      toast.error("Belum bisa menyimpan. Coba lagi sebentar ya.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <BackLink href={`/admin/employee-attendance${campusQs}`} label="Kembali ke Kehadiran" className="mb-2" />
      <PageHeader
        title="Absensi Staf Harian"
        description={date ? formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : undefined}
        primaryAction={{
          label: `Tandai semua hadir${unmarked > 0 ? ` (${unmarked})` : ""}`,
          onClick: markAll,
          disabled: busy || loading || unmarked === 0 || isFuture,
          icon: <CheckCheck size={14} />,
        }}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <DatePicker value={date} onChange={setDate} className="w-full sm:w-44" />
        {campuses.length > 1 && (
        <Select
          value={campusId}
          onValueChange={(v) => v && selectCampus(v)}
          items={{ all: "Semua Kampus", ...Object.fromEntries(campuses.map((c) => [c.id, campusShort.get(c.name) ?? c.name])) }}
        >
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Semua Kampus" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Kampus</SelectItem>
            {campuses.map((c) => <SelectItem key={c.id} value={c.id}>{campusShort.get(c.name) ?? c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        )}
      </div>

      {loading && rows.length === 0 ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Belum ada staf aktif"
          description="Tambahkan karyawan atau ubah filter kampus untuk mulai mencatat kehadiran."
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.name} aria-label={g.name}>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{g.name}</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {g.rows.map((r) => {
                  const att = r.attendance;
                  const locked = att?.isLocked ?? false;
                  return (
                    <li
                      key={r.employee.id}
                      className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                      data-testid="daily-row"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          <EntityLink href={entityHref.employee(r.employee.id)}>{r.employee.nama}</EntityLink>
                        </p>
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>{r.employee.jabatan}</span>
                          {att ? (
                            <>
                              <StatusBadge status={att.approvalStatus === "PENDING" ? "PENDING" : att.status} />
                              {att.checkInTime ? <span className="font-currency">{formatTime(att.checkInTime)}</span> : null}
                              <span>{SOURCE_LABEL[att.source] ?? att.source}</span>
                            </>
                          ) : (
                            <span>Belum dicatat</span>
                          )}
                          {locked ? (
                            <span className="inline-flex items-center gap-1"><Lock size={12} /> Terkunci</span>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex gap-1.5" role="group" aria-label={`Status ${r.employee.nama}`}>
                        {QUICK.map((q) => {
                          const active = att?.status === q.status && att.approvalStatus === "APPROVED";
                          return (
                            <Button
                              key={q.status}
                              type="button"
                              size="sm"
                              variant={active ? "default" : "outline"}
                              aria-pressed={active}
                              disabled={locked || busy || (isFuture && (q.status === "PRESENT" || q.status === "ABSENT"))}
                              onClick={() => setStatus(r, q.status)}
                              className="min-h-11 flex-1 sm:flex-none"
                            >
                              {q.label}
                            </Button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
