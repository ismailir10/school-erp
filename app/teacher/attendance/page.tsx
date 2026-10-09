"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { AttendanceCalendar } from "@/components/attendance/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarDays } from "lucide-react";
import { LeaveSheet, type LeaveBalance, type LeaveRequest } from "@/components/teacher/leave-sheet";
import { PageHeader } from "@/components/portal/page-header";
import { toast } from "sonner";

type LeavePrefetchState = "loading" | "ready" | "error";

type AttendanceRecord = {
  id: string;
  date: string;
  status: string;
  checkInTime: string | null;
  checkOutTime: string | null;
};

/** Cache key for a given year + month pair (pure helper). */
function cacheKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Returns the prior month as { year, month } (1-indexed). */
function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** Returns the next month as { year, month } (1-indexed). */
function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export default function TeacherAttendancePage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthError, setMonthError] = useState(false);

  // Client-side LRU-lite cache: keyed by cacheKey(year, month) → records[].
  const cache = useRef<Map<string, AttendanceRecord[]>>(new Map());

  // Active AbortController — replaced on each navigation, aborted on unmount.
  const abortRef = useRef<AbortController | null>(null);

  const [leaveSheetOpen, setLeaveSheetOpen] = useState(false);
  // The home's "Keputusan cuti" rows land here with ?cuti=1: open the sheet the
  // decision lives in instead of leaving the guru to find the card (X-21).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("cuti") === "1") {
      setLeaveSheetOpen(true);
    }
  }, []);

  // Prefetch leave data on page mount so the sheet opens with instant content.
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalance | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[] | null>(null);
  const [leavePrefetchState, setLeavePrefetchState] =
    useState<LeavePrefetchState>("loading");

  const fetchLeaveData = useCallback(async () => {
    setLeavePrefetchState("loading");
    try {
      const [balRes, reqRes] = await Promise.all([
        fetch("/api/leave/balance"),
        fetch("/api/leave/my"),
      ]);
      if (!balRes.ok || !reqRes.ok) {
        setLeavePrefetchState("error");
        return;
      }
      setLeaveBalance(await balRes.json());
      setLeaveRequests(await reqRes.json());
      setLeavePrefetchState("ready");
    } catch {
      setLeavePrefetchState("error");
    }
  }, []);

  /**
   * Fetch a single month's records. Returns null on any error (network, !ok, abort).
   * Pass signal for cooperative cancellation.
   */
  const fetchMonth = useCallback(
    async (
      y: number,
      m: number,
      signal?: AbortSignal,
    ): Promise<AttendanceRecord[] | null> => {
      try {
        const res = await fetch(`/api/attendance/my?month=${m}&year=${y}`, { signal });
        if (!res.ok) return null;
        return (await res.json()) as AttendanceRecord[];
      } catch {
        // Covers AbortError + network failures.
        return null;
      }
    },
    [],
  );

  /**
   * Best-effort background prefetch of the adjacent (prev + next) months.
   * Results land in cache; never touches loading state; never shows error UI.
   */
  const prefetchAdjacent = useCallback(
    (y: number, m: number, signal: AbortSignal) => {
      const prev = prevMonth(y, m);
      const next = nextMonth(y, m);

      const prefetchOne = async (py: number, pm: number) => {
        const key = cacheKey(py, pm);
        if (cache.current.has(key)) return; // already warm
        const data = await fetchMonth(py, pm, signal);
        if (data !== null && !signal.aborted) {
          cache.current.set(key, data);
        }
      };

      // Fire both in parallel; neither blocks rendering.
      Promise.allSettled([
        prefetchOne(prev.year, prev.month),
        prefetchOne(next.year, next.month),
      ]).catch(() => {});
    },
    [fetchMonth],
  );

  /**
   * Initial mount: fetch current month (with loading state) + adjacent months
   * in parallel (best-effort, no loading state for adjacent).
   */
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    // Capture initial month/year synchronously (stale-closure safe at mount).
    const initMonth = now.getMonth() + 1;
    const initYear = now.getFullYear();

    const prev = prevMonth(initYear, initMonth);
    const next = nextMonth(initYear, initMonth);

    const run = async () => {
      setLoading(true);

      // Fetch all three months in parallel.
      const [currentData, prevData, nextData] = await Promise.all([
        fetchMonth(initYear, initMonth, signal),
        fetchMonth(prev.year, prev.month, signal),
        fetchMonth(next.year, next.month, signal),
      ]);

      if (signal.aborted) return;

      // Populate adjacent cache entries (best-effort — null means failure, skip).
      if (prevData !== null) {
        cache.current.set(cacheKey(prev.year, prev.month), prevData);
      }
      if (nextData !== null) {
        cache.current.set(cacheKey(next.year, next.month), nextData);
      }

      // Current month drives the UI.
      if (currentData === null) {
        setMonthError(true);
        toast.error("Gagal memuat kehadiran. Coba lagi sebentar ya.");
      } else {
        cache.current.set(cacheKey(initYear, initMonth), currentData);
        setRecords(currentData);
        setMonthError(false);
      }
      setLoading(false);
    };

    run();

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once at mount

  // Fire leave prefetch once on mount, independent of attendance fetch.
  useEffect(() => { fetchLeaveData(); }, [fetchLeaveData]);

  // Abort any in-flight prefetch on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function handleMonthChange(m: number, y: number) {
    const key = cacheKey(y, m);
    const cached = cache.current.get(key);

    // A foreground month change supersedes every prior foreground request.
    // Without this, a slow response for month A can land after the teacher has
    // already switched to month B and overwrite B's calendar.
    abortRef.current?.abort();

    if (cached !== undefined) {
      // Cache hit — instant render, no loading state.
      setMonth(m);
      setYear(y);
      setRecords(cached);
      setMonthError(false);
      setLoading(false);

      // Keep the buffer warm: prefetch new adjacent months in background.
      const controller = new AbortController();
      abortRef.current = controller;
      prefetchAdjacent(y, m, controller.signal);
    } else {
      // Cache miss — fall back to on-demand fetch with loading state.
      setMonth(m);
      setYear(y);

      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      setLoading(true);
      setMonthError(false);
      fetchMonth(y, m, signal).then((data) => {
        if (signal.aborted) return;
        if (data === null) {
          setMonthError(true);
          toast.error("Gagal memuat kehadiran. Coba lagi sebentar ya.");
        } else {
          cache.current.set(key, data);
          setRecords(data);
          setMonthError(false);
        }
        setLoading(false);
        // After rendering, prefetch adjacent months to keep buffer warm.
        prefetchAdjacent(y, m, signal);
      });
    }
  }

  function retryCurrentMonth() {
    const key = cacheKey(year, month);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    setLoading(true);
    setMonthError(false);
    fetchMonth(year, month, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      if (data === null) {
        setMonthError(true);
      } else {
        cache.current.set(key, data);
        setRecords(data);
        prefetchAdjacent(year, month, controller.signal);
      }
      setLoading(false);
    });
  }

  return (
    <div>
      <PageHeader title="Kehadiran saya" />

      {/* Cuti action card — opens Sheet instead of navigating */}
      <button
        type="button"
        className="w-full mb-4 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={() => setLeaveSheetOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={leaveSheetOpen}
      >
        <Card className="p-card hover:border-primary/30 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <CalendarDays size={20} className="text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Cuti dan izin</p>
              <p className="text-xs text-muted-foreground">Lihat saldo dan ajukan cuti</p>
            </div>
          </div>
        </Card>
      </button>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : monthError ? (
        <div role="alert">
          <EmptyState
            icon={CalendarDays}
            title="Kehadiran tidak bisa dimuat"
            description="Periksa koneksi, lalu coba lagi."
            actionLabel="Coba lagi"
            onAction={retryCurrentMonth}
          />
        </div>
      ) : (
        <AttendanceCalendar
          records={records}
          month={month}
          year={year}
          onMonthChange={handleMonthChange}
        />
      )}

      <LeaveSheet
        open={leaveSheetOpen}
        onOpenChange={setLeaveSheetOpen}
        prefetchedBalance={leaveBalance}
        prefetchedRequests={leaveRequests}
        prefetchState={leavePrefetchState}
        onRefetch={fetchLeaveData}
      />
    </div>
  );
}
