"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionLabel } from "@/components/portal/section-label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Plus, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateShort } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

export type LeaveBalance = {
  annual: { total: number; used: number; remaining: number };
  sick: { total: number; used: number; remaining: number };
};

export type LeaveRequest = {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  reviewNote: string | null;
  createdAt: string;
};

type LeavePrefetchState = "loading" | "ready" | "error";

const TYPE_LABELS: Record<string, string> = {
  ANNUAL: "Cuti tahunan",
  SICK: "Cuti sakit",
  PERMISSION: "Izin",
  OTHER: "Lainnya",
};
const SHEET_CLOSE_TRANSITION_MS = 240;
const PAST_START_MESSAGE = "Tanggal mulai tidak boleh sebelum hari ini.";
// Same-day leave is valid, so the rule is "on or after", not "after".
const END_BEFORE_START_MESSAGE = "Tanggal selesai harus sama atau setelah tanggal mulai";

type FormField = "startDate" | "endDate" | "reason";

/**
 * Days already asked for but not yet approved, per balanced type. The balance
 * API only counts APPROVED days, while the server refuses a request that
 * exceeds remaining minus pending — so the sheet subtracts pending itself, over
 * the same calendar-year window (`lib/leave/balance.ts`).
 */
function pendingDays(requests: LeaveRequest[], leaveType: "ANNUAL" | "SICK"): number {
  const periodStart = `${new Date().getFullYear()}-01-01`;
  return requests
    .filter((r) => r.status === "PENDING" && r.leaveType === leaveType && r.startDate >= periodStart)
    .reduce((sum, r) => sum + r.days, 0);
}

/** Count weekdays between two ISO date strings (inclusive). Matches API logic. */
function countWeekdays(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (e < s) return 0;
  let count = 0;
  const d = new Date(s);
  while (d <= e) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

type LeaveSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Data prefetched by the parent page on mount. When provided and loaded, the sheet renders content instantly. */
  prefetchedBalance?: LeaveBalance | null;
  /** Requests prefetched by the parent page on mount. */
  prefetchedRequests?: LeaveRequest[] | null;
  /** Explicit parent prefetch state so a failure cannot render as an empty list. */
  prefetchState?: LeavePrefetchState;
  /** Callback to re-trigger the parent's prefetch after a mutation (submit / cancel). */
  onRefetch?: () => void;
};

export function LeaveSheet({
  open,
  onOpenChange,
  prefetchedBalance,
  prefetchedRequests,
  prefetchState,
  onRefetch,
}: LeaveSheetProps) {
  // Local state is used only when prefetch data is absent (cold open before prefetch resolves,
  // or fallback when the parent page didn't pass props).
  const hasPrefetch =
    prefetchState !== undefined ||
    (prefetchedBalance !== undefined && prefetchedRequests !== undefined);

  const [localBalance, setLocalBalance] = useState<LeaveBalance | null>(null);
  const [localRequests, setLocalRequests] = useState<LeaveRequest[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState(false);

  const balance = hasPrefetch ? prefetchedBalance : localBalance;
  const requests = hasPrefetch ? (prefetchedRequests ?? []) : localRequests;
  const loading = hasPrefetch ? prefetchState === "loading" : localLoading;
  const loadError = hasPrefetch ? prefetchState === "error" : localError;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    leaveType: "ANNUAL",
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  // R2-T-10: fields flagged by the last submit attempt; cleared as each is edited.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FormField, string>>>({});
  const pendingOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pendingOverlayTimerRef.current) {
        clearTimeout(pendingOverlayTimerRef.current);
      }
    };
  }, []);

  async function fetchData() {
    setLocalLoading(true);
    setLocalError(false);
    try {
      const [balRes, reqRes] = await Promise.all([
        fetch("/api/leave/balance"),
        fetch("/api/leave/my"),
      ]);
      if (!balRes.ok || !reqRes.ok) {
        toast.error("Data cuti tidak bisa dimuat. Coba lagi sebentar ya.");
        setLocalError(true);
        return;
      }
      setLocalBalance(await balRes.json());
      setLocalRequests(await reqRes.json());
    } catch {
      toast.error("Data cuti tidak bisa dimuat. Coba lagi sebentar ya.");
      setLocalError(true);
    } finally {
      setLocalLoading(false);
    }
  }

  useEffect(() => {
    // Only run the local fetch when there is no prefetch wiring from the parent.
    if (!open || hasPrefetch) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasPrefetch]);

  /** Refresh data after a mutation — uses parent refetch when wired, otherwise local fetch. */
  function refetchAfterMutation() {
    if (onRefetch) {
      onRefetch();
    } else {
      fetchData();
    }
  }

  async function handleSubmit() {
    const errors: Partial<Record<FormField, string>> = {};
    if (!form.startDate) errors.startDate = "Pilih tanggal mulai.";
    if (!form.endDate) errors.endDate = "Pilih tanggal selesai.";
    if (!form.reason.trim()) errors.reason = "Tulis alasannya dulu ya.";
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      toast.error("Lengkapi tanggal dan alasan dulu ya.");
      return;
    }
    if (endBeforeStart) {
      setFieldErrors({ endDate: END_BEFORE_START_MESSAGE });
      toast.error(END_BEFORE_START_MESSAGE);
      return;
    }
    if (startsInPast) {
      toast.error(PAST_START_MESSAGE);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    // TCHX-2: a dropped connection makes fetch() reject, which used to skip
    // setSaving(false) and leave both buttons disabled forever. The form values
    // are kept on every failure so she can retry.
    try {
      const res = await fetch("/api/leave/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast.success("Pengajuan cuti terkirim");
        setDialogOpen(false);
        setForm({ leaveType: "ANNUAL", startDate: "", endDate: "", reason: "" });
        setFieldErrors({});
        refetchAfterMutation();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Pengajuan tidak terkirim. Coba lagi sebentar ya.");
      }
    } catch {
      toast.error("Koneksi terputus. Pengajuan belum terkirim — coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    let res: Response;
    try {
      res = await fetch(`/api/leave/requests/${cancelTarget}/cancel`, {
        method: "POST",
      });
    } catch (err) {
      toast.error("Koneksi terputus. Pembatalan belum terkirim — coba lagi.");
      // Rethrow: ConfirmDialog stays open and re-enables its buttons for a retry.
      throw err;
    }
    if (res.ok) {
      toast.success("Pengajuan dibatalkan");
      refetchAfterMutation();
      return;
    } else {
      toast.error("Pembatalan tidak tersimpan. Coba lagi sebentar ya.");
      throw new Error("leave cancel failed");
    }
  }

  const dayCount = countWeekdays(form.startDate, form.endDate);
  // Only sick leave may be filed after the fact; other types start today or later.
  const minDate = form.leaveType === "SICK" ? undefined : getTodayInTimezone("Asia/Jakarta");
  const startsInPast = !!minDate && !!form.startDate && form.startDate < minDate;
  const endBeforeStart = !!form.startDate && !!form.endDate && form.endDate < form.startDate;
  const endDateError = endBeforeStart ? END_BEFORE_START_MESSAGE : fieldErrors.endDate;
  const annualPending = pendingDays(requests, "ANNUAL");
  const sickPending = pendingDays(requests, "SICK");
  const annualAvailable = balance ? Math.max(0, balance.annual.remaining - annualPending) : 0;
  const sickAvailable = balance ? Math.max(0, balance.sick.remaining - sickPending) : 0;

  function updateForm(patch: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...patch }));
    setFieldErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(patch)) delete next[key as FormField];
      return next;
    });
  }

  function openAfterSheetCloses(openNext: () => void) {
    if (pendingOverlayTimerRef.current) {
      clearTimeout(pendingOverlayTimerRef.current);
    }
    onOpenChange(false);
    pendingOverlayTimerRef.current = setTimeout(() => {
      pendingOverlayTimerRef.current = null;
      openNext();
    }, SHEET_CLOSE_TRANSITION_MS);
  }

  function openRequestForm() {
    openAfterSheetCloses(() => {
      setFieldErrors({});
      setDialogOpen(true);
    });
  }

  function openCancelConfirm(id: string) {
    openAfterSheetCloses(() => setCancelTarget(id));
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[85vh] max-w-md mx-auto rounded-t-2xl px-page-x pb-card pt-2 overflow-y-auto">
          <SheetHeader className="px-0 pt-2">
            <SheetTitle>Cuti dan izin</SheetTitle>
            <SheetDescription>Kelola pengajuan cuti dan izin Anda</SheetDescription>
          </SheetHeader>

          {/*
            Balance cards. The figures used `.font-currency` — JetBrains Mono,
            bold, 24px, one teal and one blue — which is the exact treatment
            #500 retired from the parent Tagihan total, applied here to a count
            of days. `.font-amount` keeps the tabular alignment on the brand
            sans, and both cards read in the same neutral foreground because
            "12 days left" and "14 days left" are not different kinds of fact.
          */}
          {balance && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Card className="p-3">
                <SectionLabel>Cuti tahunan</SectionLabel>
                <p className="font-amount text-2xl font-semibold text-foreground">
                  {annualAvailable}
                </p>
                <p className="text-xs text-muted-foreground">
                  sisa dari {balance.annual.total} hari
                  {annualPending > 0 && ` · ${annualPending} menunggu`}
                </p>
                <Progress
                  value={balance.annual.total > 0 ? (annualAvailable / balance.annual.total) * 100 : 0}
                  className="mt-2 h-1.5"
                />
              </Card>
              <Card className="p-3">
                <SectionLabel>Cuti sakit</SectionLabel>
                <p className="font-amount text-2xl font-semibold text-foreground">
                  {sickAvailable}
                </p>
                <p className="text-xs text-muted-foreground">
                  sisa dari {balance.sick.total} hari
                  {sickPending > 0 && ` · ${sickPending} menunggu`}
                </p>
                <Progress
                  value={balance.sick.total > 0 ? (sickAvailable / balance.sick.total) * 100 : 0}
                  className="mt-2 h-1.5 [&_[data-slot=progress-indicator]]:bg-status-leave"
                />
              </Card>
            </div>
          )}

          {/* Request button */}
          <Button className="tap-target w-full mb-4" onClick={openRequestForm}>
            <Plus size={16} className="mr-1" aria-hidden="true" /> Ajukan cuti
          </Button>

          {/* Request list */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          ) : loadError ? (
            <EmptyState
              icon={CalendarDays}
              // "tidak dapat dimuat" / "Periksa koneksi lalu" — the rest of the
              // portal says "tidak bisa dimuat" / "Periksa koneksi, lalu".
              title="Data cuti tidak bisa dimuat"
              description="Periksa koneksi, lalu coba lagi."
              actionLabel="Coba lagi"
              onAction={onRefetch ?? fetchData}
            />
          ) : requests.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Belum ada pengajuan cuti"
              description="Ajukan cuti untuk membuat pengajuan baru."
              actionLabel="Ajukan cuti"
              onAction={openRequestForm}
            />
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <Card key={r.id} className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {TYPE_LABELS[r.leaveType] ?? r.leaveType}
                        </span>
                        <StatusBadge status={r.status} />
                      </div>
                      {/*
                        A one-day leave printed the same date twice —
                        "20 Agu 2026 — 20 Agu 2026 (1 hari)".
                      */}
                      <p className="text-xs text-muted-foreground mt-1">
                        {r.startDate === r.endDate
                          ? `${formatDateShort(r.startDate)} · ${r.days} hari`
                          : `${formatDateShort(r.startDate)} — ${formatDateShort(r.endDate)} · ${r.days} hari`}
                      </p>
                      <p className="text-xs mt-1">{r.reason}</p>
                      {r.reviewNote && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Catatan admin: {r.reviewNote}
                        </p>
                      )}
                    </div>
                    {r.status === "PENDING" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="tap-target text-destructive shrink-0"
                        onClick={() => openCancelConfirm(r.id)}
                      >
                        Batalkan
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Batalkan pengajuan"
        description="Yakin ingin membatalkan pengajuan cuti ini? Anda perlu mengajukan ulang jika berubah pikiran."
        onConfirm={handleCancel}
        confirmLabel="Batalkan pengajuan"
        destructive
      />

      <ResponsiveFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Ajukan cuti"
        description="Pengajuan akan dikirim ke admin untuk persetujuan"
        size="md"
        footer={
          <>
            <Button variant="ghost" className="tap-target" onClick={() => setDialogOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button className="tap-target" onClick={handleSubmit} disabled={saving}>
              {saving ? "Mengirim…" : "Ajukan"}
            </Button>
          </>
        }
      >
        <Field>
          <FieldLabel htmlFor="leave-type">Jenis cuti</FieldLabel>
          <Select
            value={form.leaveType}
            onValueChange={(v) => v && updateForm({ leaveType: v })}
          >
            <SelectTrigger id="leave-type" className="tap-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/*
                The balance card says "Cuti sakit" and this list said "Sakit"
                for the same leave type — one name each.
              */}
              <SelectItem value="ANNUAL">
                Cuti tahunan ({balance ? annualAvailable : "?"} hari tersisa
                {annualPending > 0 && `, ${annualPending} menunggu`})
              </SelectItem>
              <SelectItem value="SICK">
                Cuti sakit ({balance ? sickAvailable : "?"} hari tersisa
                {sickPending > 0 && `, ${sickPending} menunggu`})
              </SelectItem>
              <SelectItem value="PERMISSION">Izin</SelectItem>
              <SelectItem value="OTHER">Lainnya</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="leave-start-date">Tanggal mulai</FieldLabel>
            <Input
              id="leave-start-date"
              className="tap-target"
              type="date"
              min={minDate}
              value={form.startDate}
              onChange={(e) => updateForm({ startDate: e.target.value })}
              aria-invalid={!!fieldErrors.startDate || undefined}
              aria-describedby={fieldErrors.startDate ? "leave-start-date-error" : undefined}
            />
            {fieldErrors.startDate && (
              <p id="leave-start-date-error" className="text-xs text-destructive">
                {fieldErrors.startDate}
              </p>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="leave-end-date">Tanggal selesai</FieldLabel>
            <Input
              id="leave-end-date"
              className="tap-target"
              type="date"
              min={form.startDate || minDate}
              value={form.endDate}
              onChange={(e) => updateForm({ endDate: e.target.value })}
              aria-invalid={!!endDateError || undefined}
              aria-describedby={endDateError ? "leave-end-date-error" : undefined}
            />
            {endDateError && (
              <p id="leave-end-date-error" className="text-xs text-destructive">
                {endDateError}
              </p>
            )}
          </Field>
        </div>
        {startsInPast && <p className="text-xs text-destructive">{PAST_START_MESSAGE}</p>}
        {dayCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {dayCount} hari kerja (tidak termasuk akhir pekan)
          </p>
        )}
        <Field>
          <FieldLabel htmlFor="leave-reason">Alasan</FieldLabel>
          <Textarea
            id="leave-reason"
            value={form.reason}
            onChange={(e) => updateForm({ reason: e.target.value })}
            placeholder="Jelaskan alasan cuti Anda"
            rows={3}
            aria-invalid={!!fieldErrors.reason || undefined}
            aria-describedby={fieldErrors.reason ? "leave-reason-error" : undefined}
          />
          {fieldErrors.reason && (
            <p id="leave-reason-error" className="text-xs text-destructive">
              {fieldErrors.reason}
            </p>
          )}
        </Field>
      </ResponsiveFormDialog>
    </>
  );
}
