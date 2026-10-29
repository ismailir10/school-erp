"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, getStatusConfig } from "@/components/ui/status-badge";
import { sendJson } from "@/lib/api/send-json";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import { formatLeaveRange } from "@/lib/enrollment-leave/months";
import { joinWithDan } from "./cuti-months";
import { CutiCreateDialog } from "./cuti-create-dialog";
import { CutiInvoicesDialog } from "./cuti-invoices-dialog";
import type {
  AffectedRun,
  CreateLeaveResponse,
  LeaveEnrollmentOption,
  OpenInvoice,
  OpenInvoicesFollowUp,
  StudentLeave,
} from "./cuti-types";

/**
 * Cuti block of the student dossier (Keuangan group): the billing pauses
 * recorded on this student's enrollments, `docs/cycles/2026-10-29-student-enrollment-leave.md`.
 *
 * Lazy like Keringanan: nothing is requested until the row is first opened, and
 * `active` never flips back. Recording and cancelling need the student-edit
 * right (`canManage`); the API additionally needs invoice-create and answers 403
 * otherwise, which the dialogs turn into a plain "no access" message.
 */

const NO_ACCESS_VIEW = "Anda tidak punya akses untuk melihat tagihan.";

function draftNotice(runs: AffectedRun[]): string {
  const labels = joinWithDan(runs.map((r) => r.periodLabel));
  return `Draf tagihan ${labels} dibuat sebelum cuti ini; siswa dikecualikan. Hitung ulang draf agar biaya lain tetap ditagih.`;
}

function cancelNotice(runs: AffectedRun[]): string {
  const labels = joinWithDan(runs.map((r) => r.periodLabel));
  return `Kalau ada draf tagihan ${labels} yang dibuat selama cuti ini, hitung ulang draf agar siswa ditagih lagi.`;
}

function placementLabel(e: StudentLeave["enrollment"]): string {
  return `${e.programName} · ${e.className}`;
}

export const CutiSection = memo(function CutiSection({
  studentId,
  active,
  canManage,
  onCountChange,
  onInvoiceVoided,
}: {
  studentId: string;
  /** Flips true on first open and never back — a second open must not re-request. */
  active: boolean;
  /** Student-edit right: gates "Catat cuti" and "Batalkan cuti". */
  canManage: boolean;
  /** Lets the section header show a count of active leaves once the fetch lands. */
  onCountChange?: (count: number | null) => void;
  /** An invoice was cancelled from the follow-up; the page refreshes its Tagihan block. */
  onInvoiceVoided?: () => void;
}) {
  const [leaves, setLeaves] = useState<StudentLeave[] | null>(null);
  const [enrollments, setEnrollments] = useState<LeaveEnrollmentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<"failed" | "denied" | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<StudentLeave | null>(null);
  const [followUp, setFollowUp] = useState<OpenInvoicesFollowUp | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      // A reload after create/cancel keeps the list on screen instead of flashing skeletons.
      // If that reload fails, the list stays as it was: swapping the page for an
      // error state would also unmount a follow-up dialog the admin is working in.
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await fetch(`/api/students/${encodeURIComponent(studentId)}/leaves`);
        if (!res.ok) {
          if (!silent) setError(res.status === 403 ? "denied" : "failed");
          return;
        }
        const json = await res.json();
        const data: StudentLeave[] = Array.isArray(json?.data) ? json.data : [];
        setLeaves(data);
        setEnrollments(Array.isArray(json?.enrollments) ? json.enrollments : []);
        onCountChange?.(data.filter((l) => l.status === "ACTIVE").length);
      } catch {
        if (!silent) setError("failed");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [studentId, onCountChange],
  );

  useEffect(() => {
    if (!active || leaves !== null || loading || error) return;
    void load();
    // `leaves`/`loading`/`error` are the guard, not inputs to re-run on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function handleCreated(result: CreateLeaveResponse) {
    setCreateOpen(false);
    toast.success("Cuti dicatat");
    const runs = result.affectedRuns ?? [];
    setNotice(runs.length > 0 ? draftNotice(runs) : null);
    void load(true);
    // No invoice-view right -> openInvoices is null: nothing to show, silently.
    if (result.openInvoices && result.openInvoices.length > 0) {
      setFollowUp({
        invoices: result.openInvoices,
        canVoid: result.canVoid,
        otherActiveEnrollments: result.otherActiveEnrollments,
      });
      setFollowUpOpen(true);
    }
  }

  async function handleCancelLeave() {
    const target = cancelTarget;
    if (!target) return;
    try {
      const res = await sendJson<{ affectedRuns?: AffectedRun[] }>(
        `/api/students/${studentId}/leaves/${target.id}`,
        { method: "PUT", body: { status: "INACTIVE" } },
        "Gagal membatalkan cuti",
      );
      toast.success("Cuti dibatalkan");
      const runs = res?.affectedRuns ?? [];
      setNotice(runs.length > 0 ? cancelNotice(runs) : null);
      await load(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Already cancelled (another tab, another admin): show the truth, close the question.
        toast.error(err.message);
        await load(true);
        return;
      }
      toast.error(
        err instanceof ApiError && err.status === 403
          ? "Anda tidak punya akses untuk membatalkan cuti."
          : userMessage(err, "Gagal membatalkan cuti"),
      );
      // Rethrow so ConfirmDialog stays open for a retry.
      throw err;
    }
  }

  async function handleCheckInvoices(leave: StudentLeave) {
    setCheckingId(leave.id);
    try {
      const res = await fetch(`/api/students/${studentId}/leaves/${leave.id}/open-invoices`);
      if (!res.ok) {
        toast.error(res.status === 403 ? NO_ACCESS_VIEW : "Gagal memuat tagihan");
        return;
      }
      const json = await res.json();
      setFollowUp({
        invoices: Array.isArray(json?.openInvoices) ? (json.openInvoices as OpenInvoice[]) : [],
        canVoid: json?.canVoid === true,
        otherActiveEnrollments: json?.otherActiveEnrollments === true,
      });
      setFollowUpOpen(true);
    } catch {
      toast.error("Terjadi kesalahan jaringan");
    } finally {
      setCheckingId(null);
    }
  }

  function handleVoided(invoiceId: string) {
    setFollowUp((prev) => (prev ? { ...prev, invoices: prev.invoices.filter((i) => i.id !== invoiceId) } : prev));
    onInvoiceVoided?.();
    void load(true);
  }

  if (loading || (active && leaves === null && !error)) {
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
        <p className="text-sm text-muted-foreground">
          {error === "denied" ? "Anda tidak punya akses untuk melihat data cuti." : "Gagal memuat data cuti."}
        </p>
        {error === "failed" && (
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md text-sm text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Coba lagi
          </button>
        )}
      </div>
    );
  }

  const eligible = enrollments.filter((e) => e.eligible && e.window !== null);
  const reasons = [...new Set(enrollments.map((e) => e.ineligibleReason).filter((r): r is string => !!r))];
  const rows = leaves ?? [];

  return (
    <div className="space-y-3">
      {canManage && leaves !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {eligible.length > 0 ? (
            <>
              <p className="text-small text-muted-foreground">Siswa tidak ditagih untuk bulan yang dicatat cuti.</p>
              <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden="true" />
                Catat cuti
              </Button>
            </>
          ) : (
            <p className="text-small text-muted-foreground">
              Cuti belum bisa dicatat.{" "}
              {enrollments.length === 0 ? "Siswa belum terdaftar di kelas." : reasons.join(" ")}
            </p>
          )}
        </div>
      )}

      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Tutup pemberitahuan" onClick={() => setNotice(null)}>
              <X aria-hidden="true" />
            </Button>
          </AlertAction>
        </Alert>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="Belum ada cuti"
          description="Catat cuti kalau siswa berhenti sementara dan tidak perlu ditagih."
        />
      ) : (
        <ul className="space-y-0">
          {rows.map((leave) => {
            const isActive = leave.status === "ACTIVE";
            return (
              <li key={leave.id} className="space-y-2 border-b border-border/50 py-3 first:pt-0 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{placementLabel(leave.enrollment)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatLeaveRange(leave.startMonth, leave.endMonth)} · {leave.enrollment.academicYearName}
                    </p>
                    <p className="mt-1 break-words text-sm text-muted-foreground">{leave.reason}</p>
                    {leave.enrollment.status !== "ACTIVE" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Pendaftaran kelas: {getStatusConfig(leave.enrollment.status).label}
                      </p>
                    )}
                  </div>
                  {isActive ? <StatusBadge status="ACTIVE" /> : <StatusBadge status="CANCELLED" />}
                </div>
                {isActive && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCheckInvoices(leave)}
                      disabled={checkingId === leave.id}
                    >
                      {checkingId === leave.id ? "Memuat..." : "Cek tagihan"}
                    </Button>
                    {canManage && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setCancelTarget(leave)}>
                        Batalkan cuti
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CutiCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        studentId={studentId}
        enrollments={eligible}
        onCreated={handleCreated}
      />

      <CutiInvoicesDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        followUp={followUp}
        onVoided={handleVoided}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Batalkan cuti?"
        description="Siswa akan ditagih lagi di tagihan berikutnya. Tagihan yang sudah dibatalkan tidak dibuat ulang otomatis."
        confirmLabel="Ya, batalkan"
        destructive
        onConfirm={handleCancelLeave}
      >
        {cancelTarget && (
          <p className="text-sm font-medium">
            {placementLabel(cancelTarget.enrollment)} · {formatLeaveRange(cancelTarget.startMonth, cancelTarget.endMonth)}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
});
