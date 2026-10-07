"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRupiah, formatRelativeTime } from "@/lib/format";
import { userMessage, ApiError } from "@/lib/api/client-errors";
import { runBulkCommit } from "@/lib/finance/run-bulk-generate";
import { rowHasKeringanan } from "@/lib/finance/billing-run-line-source";
import { isZeroTotal, ZERO_TOTAL_REASON } from "@/lib/finance/billing-run-zero-total";
import { WizardFooter } from "./wizard-footer";
import type { BillingRunDetail, BillingRunRowData } from "./types";

// Step 3 — Commit (Cycle B1, Task T9; repointed onto the shared bulk-commit
// orchestrator in Task T10 — docs/cycles/2026-08-14-billing-run-wizard.md).
// Chunking, 5xx retry+backoff, inter-chunk pacing, abort, and the
// pending-payment-link auto-sweep all live in lib/finance/run-bulk-generate.ts
// (originally wired to the retired /api/invoices/generate/{plan,batch} flow,
// repointed at POST /api/billing-runs/[id]/commit). This component drives
// that module rather than re-deriving the same retry/backoff/pacing logic
// locally — Assumption 7 in the cycle doc.

// Server max page size (lib/api/pagination.ts MAX_PAGE_SIZE) — used to pull
// every row of the run in as few requests as possible for step 3's totals
// and row-id list. This is a *bounded* multi-request fetch (a run is ~200
// students, so 2-3 requests), not the "fetch everything in one payload" step
// 2 deliberately avoids — step 2 paginates for display; step 3 needs the
// full committable id list up front because chunking 200 ids into batches of
// 25 has to know all 200 before it can start.
const FETCH_ALL_PAGE_SIZE = 100;

// Draft staleness threshold (Cycle B1 spec Assumption 2). Surfaces the
// "Hitung ulang" rebuild prompt inside the stale-draft Alert (Cycle B2, Task
// T6 — POST /api/billing-runs/[id]/rebuild). 24h is a judgment call: a
// same-day draft is very unlikely to have a fee-structure or keringanan
// change under it, a multi-day-old one plausibly does. It is a heuristic, not
// a guarantee — the rebuild control itself is always offered below,
// regardless of age, since a draft can go stale in an hour if someone edits a
// fee structure mid-session.
const STALE_DRAFT_MS = 24 * 60 * 60 * 1000;

type CommitPhase = "idle" | "running" | "sweeping" | "done" | "aborted" | "error";

type Summary = {
  createdAt: string;
  periodLabel: string;
  billableCount: number;
  billableTotal: number;
  withAdjustments: number;
  excludedCount: number;
  skippedCount: number;
  /** Rp 0 rows (FINX-4): PENDING ones the commit will park, plus any already
   *  parked by an earlier partial commit. Never turned into invoices. */
  zeroTotalCount: number;
  /** The PENDING subset of `zeroTotalCount` — what the next commit call skips. */
  zeroTotalPendingCount: number;
  alreadyCommittedCount: number;
  committableIds: string[];
};

function summarize(run: BillingRunDetail, rows: BillingRunRowData[]): Summary {
  const pending = rows.filter((r) => r.status === "PENDING");
  // A zero row the commit already parked as EXCLUDED is "Rp 0", not an
  // admin-chosen exclusion — keep the two counts honest.
  const parkedZero = rows.filter((r) => r.status === "EXCLUDED" && r.error === ZERO_TOTAL_REASON);
  const excluded = rows.filter((r) => r.status === "EXCLUDED" && r.error !== ZERO_TOTAL_REASON);
  const pendingZero = pending.filter((r) => isZeroTotal(r.totalDue));
  const billable = pending.filter((r) => !isZeroTotal(r.totalDue));
  const skipped = rows.filter(
    (r) => r.status === "SKIPPED_ALREADY_INVOICED" || r.status === "SKIPPED_NO_FEE_STRUCTURE",
  );
  const alreadyCommitted = rows.filter((r) => r.status === "COMMITTED");
  // Same predicate as step 2's badge — shared so the two can never disagree
  // about what counts as a keringanan. See rowHasKeringanan's doc comment.
  const withAdjustments = billable.filter((r) => rowHasKeringanan(r.lines));

  return {
    createdAt: run.createdAt,
    periodLabel: run.periodLabel,
    billableCount: billable.length,
    billableTotal: billable.reduce((sum, r) => sum + Number(r.totalDue), 0),
    withAdjustments: withAdjustments.length,
    excludedCount: excluded.length,
    skippedCount: skipped.length,
    zeroTotalCount: pendingZero.length + parkedZero.length,
    zeroTotalPendingCount: pendingZero.length,
    alreadyCommittedCount: alreadyCommitted.length,
    // Zero rows are sent too: the server parks them so the run can complete,
    // it never invoices them.
    committableIds: pending.map((r) => r.id),
  };
}

/** beforeunload guard while a commit is mid-flight — same copy pattern as
 *  components/admin/invoices/batch-progress-card.tsx, kept local rather than
 *  imported since that card's props are typed against the legacy
 *  BatchProgressSnapshot shape and don't fit this endpoint's response. */
function useBeforeUnloadWhileRunning(running: boolean) {
  useEffect(() => {
    if (!running) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Pembuatan tagihan sedang berjalan. Yakin keluar?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [running]);
}

/** POST /api/billing-runs/[id]/rebuild success body — mirrors
 *  CreateBillingRunResponse's `summary` shape (materializeBillingRun is
 *  shared by both routes) plus the rebuild-only `reappliedExclusions` count. */
type RebuildResponse = {
  id: string;
  summary: {
    total: number;
    pending: number;
    excluded: number;
    skippedAlreadyInvoiced: number;
    skippedNoFeeStructure: number;
    withAdjustments: number;
  };
  reappliedExclusions: number;
};

export function CommitStep({
  runId,
  onClose,
  onCommitted,
  onRebuilt,
}: {
  runId: string;
  onClose: () => void;
  /** Fired once the run has nothing left to commit — parent refreshes the
   *  invoice list + closes the wizard. */
  onCommitted: () => void;
  /** Fired once "Hitung ulang" succeeds — parent sends the wizard back to
   *  step 2 so the rebuilt rows get reviewed before a re-commit. */
  onRebuilt: () => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [remainingIds, setRemainingIds] = useState<string[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, created: 0, skipped: 0 });
  const [phase, setPhase] = useState<CommitPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // "Hitung ulang" (Cycle B2, Task T6) — rebuild confirm dialog + in-flight
  // state. Kept separate from `phase`/`isRunning` (the commit loop's state
  // machine) since a rebuild is a different request entirely and must stay
  // disabled *while a commit is running* without itself being mistaken for one.
  const [rebuildConfirmOpen, setRebuildConfirmOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const committingRef = useRef(false);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useBeforeUnloadWhileRunning(phase === "running" || phase === "sweeping");

  async function loadSummary() {
    setLoading(true);
    setLoadError(false);
    try {
      let allRows: BillingRunRowData[] = [];
      let run: BillingRunDetail | null = null;
      let page = 1;
      // Bounded loop — a page response always reports its own totalPages,
      // so this terminates as soon as every page has been read.
      for (;;) {
        const res = await fetch(
          `/api/billing-runs/${runId}?page=${page}&pageSize=${FETCH_ALL_PAGE_SIZE}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as BillingRunDetail;
        run = json;
        allRows = allRows.concat(json.rows.data);
        if (page >= json.rows.pagination.totalPages) break;
        page += 1;
      }
      if (!run) throw new Error("empty run");
      if (!mountedRef.current) return;
      const s = summarize(run, allRows);
      setSummary(s);
      setRemainingIds(s.committableIds);
      setProgress({ done: 0, total: s.committableIds.length, created: 0, skipped: 0 });
    } catch (err) {
      console.error("[billing-run-wizard] run summary fetch failed", err);
      if (mountedRef.current) setLoadError(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
    // Only on mount — the wizard has no "back to step 2" control, so the
    // committable set can only change from this step's own commit loop
    // (tracked in `remainingIds`), not from outside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Synchronous re-entry guard. The button's `disabled={isRunning}` only takes
  // effect after React commits the setPhase inside, which leaves a window where
  // a fast double-click re-enters. Both invocations would then read the same
  // `remainingIds` closure and send the same chunks. The server's atomic row
  // claim means no family is double-billed — but the loser's response comes
  // back created: 0 for a chunk it "processed", and its progress writes race
  // the winner's, so `done` can exceed `total` and the final "N dibuat" can
  // under-report. The ref flips before any await; the inner function has
  // several early returns, hence the finally.
  async function runCommit() {
    if (committingRef.current) return;
    committingRef.current = true;
    try {
      await runCommitOnce();
    } finally {
      committingRef.current = false;
    }
  }

  async function runCommitOnce() {
    setPhase("running");
    setErrorMessage(null);

    // Cumulative totals carried across "Lanjutkan Komit" resumes — the
    // orchestrator's snapshot is scoped to THIS call's rowIds only, so a
    // continuation's progress is added on top of what earlier calls already
    // landed, not reset.
    const baseline = { done: progress.done, created: progress.created, skipped: progress.skipped };
    const callRowIds = remainingIds;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const out = await runBulkCommit({
        runId,
        rowIds: callRowIds,
        signal: controller.signal,
        onProgress: (snapshot) => {
          if (!mountedRef.current) return;
          setProgress({
            done: baseline.done + snapshot.done,
            total: progress.total,
            created: baseline.created + snapshot.created,
            skipped: baseline.skipped + snapshot.skipped,
          });
          if (snapshot.phase === "sweeping") setPhase("sweeping");
        },
      });

      if (!mountedRef.current) return;

      // chunk() preserves input order and `done` only advances past a chunk
      // once it fully succeeds, so the un-advanced tail of THIS call's
      // rowIds is exactly what's still committable.
      const newRemaining = callRowIds.slice(out.final.done);
      setRemainingIds(newRemaining);

      if (out.phase === "aborted") {
        if (out.final.lastError) {
          // Three-strike chunk failure — a real infrastructure issue.
          setPhase("error");
          setErrorMessage(out.final.lastError);
          toast.error(
            "Sebagian tagihan sudah dibuat, tapi terjadi kegagalan. Baris yang sudah dikomit tidak akan diduplikasi — klik Lanjutkan Komit untuk melanjutkan sisanya.",
          );
        } else {
          // User clicked Batalkan — no error, just stopped mid-run.
          setPhase("aborted");
        }
        return;
      }

      setPhase("done");
      // Cumulative across every call in this run (including earlier
      // "Lanjutkan Komit" resumes), matching the summary card's running total.
      const totalCreated = baseline.created + out.final.created;
      const totalSkipped = baseline.skipped + out.final.skipped;
      const zeroSkipped = summary?.zeroTotalPendingCount ?? 0;
      const alreadyInvoiced = Math.max(totalSkipped - zeroSkipped, 0);
      const skippedNote =
        (alreadyInvoiced > 0 ? `, ${alreadyInvoiced} dilewati (sudah tertagih)` : "") +
        (zeroSkipped > 0 ? `, ${zeroSkipped} siswa Rp 0 tidak ditagih` : "");
      toast.success(`${totalCreated} tagihan berhasil dibuat${skippedNote}.`);
      onCommitted();
    } catch (err) {
      if (!mountedRef.current) return;
      setPhase("error");
      setErrorMessage(userMessage(err, "Gagal mengomit tagihan"));
      toast.error(
        "Sebagian tagihan sudah dibuat, tapi terjadi kegagalan. Baris yang sudah dikomit tidak akan diduplikasi — klik Lanjutkan Komit untuk melanjutkan sisanya.",
      );
    } finally {
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  // "Hitung ulang" (Cycle B2, Task T6) — rebuilds the draft's rows + lines
  // from current fee structures/keringanan via POST
  // /api/billing-runs/[id]/rebuild. Discards every manual line edit; keeps
  // EXCLUDED rows excluded by studentId (server-side, Assumption 5). Never
  // called while a commit is running — the "Hitung Ulang" triggers are both
  // disabled via `isRunning` below, and the confirm dialog itself only opens
  // from those triggers.
  async function handleRebuild() {
    setRebuilding(true);
    try {
      const res = await fetch(`/api/billing-runs/${runId}/rebuild`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Surface the server's own message verbatim — it already names the
        // exact reason (draf bukan DRAFT / sebagian sudah dikomit) rather
        // than a generic fallback.
        throw new ApiError(body?.error ?? "Gagal menghitung ulang draf");
      }
      const out = (await res.json()) as RebuildResponse;
      if (!mountedRef.current) return;
      toast.success(
        `${out.summary.pending} siswa akan ditagih setelah dihitung ulang` +
          (out.reappliedExclusions > 0
            ? `, ${out.reappliedExclusions} pengecualian dipertahankan.`
            : "."),
      );
      onRebuilt();
    } catch (err) {
      if (!mountedRef.current) return;
      toast.error(userMessage(err, "Gagal menghitung ulang draf"));
    } finally {
      if (mountedRef.current) setRebuilding(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-field">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  if (loadError || !summary) {
    return (
      <div className="space-y-field text-center">
        <p className="text-body text-muted-foreground">
          Ringkasan draf belum bisa dimuat. Coba lagi sebentar ya.
        </p>
        <div className="flex justify-center gap-2">
          <Button type="button" variant="outline" onClick={loadSummary}>
            Coba Lagi
          </Button>
        </div>
      </div>
    );
  }

  const ageMs = Date.now() - new Date(summary.createdAt).getTime();
  const isStale = Number.isFinite(ageMs) && ageMs > STALE_DRAFT_MS;
  const nothingLeftToCommit = remainingIds.length === 0;
  const isRunning = phase === "running" || phase === "sweeping";
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-field">
      <div className="rounded-lg border p-card">
        <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
          Ringkasan · {summary.periodLabel}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <dt className="text-small text-muted-foreground">Siswa akan ditagih</dt>
            <dd className="text-h2 font-medium text-foreground">{summary.billableCount}</dd>
          </div>
          <div>
            <dt className="text-small text-muted-foreground">Dikecualikan</dt>
            <dd className="text-h2 font-medium text-foreground">{summary.excludedCount}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-small text-muted-foreground">Total nilai tagihan</dt>
            <dd className="font-currency text-h2 font-medium text-foreground">
              {formatRupiah(summary.billableTotal)}
            </dd>
          </div>
          {summary.withAdjustments > 0 ? (
            <div className="col-span-2">
              <dt className="text-small text-muted-foreground">Dengan keringanan</dt>
              <dd className="text-body font-medium text-foreground">
                {summary.withAdjustments} siswa
              </dd>
            </div>
          ) : null}
        </dl>
        {summary.zeroTotalCount > 0 ? (
          <p className="mt-3 text-small text-muted-foreground">
            {summary.zeroTotalCount} siswa Rp 0 tidak ditagih (keringanan menutup seluruh biaya atau
            nominal diubah menjadi Rp 0).
          </p>
        ) : null}
        {summary.skippedCount > 0 ? (
          <p className="mt-3 text-small text-muted-foreground">
            {summary.skippedCount} siswa dilewati sejak draf dibuat (sudah pernah ditagih atau tidak
            punya struktur biaya).
          </p>
        ) : null}
        {/* Only reachable by reopening a resumable draft that already had a
            commit attempt land some rows before this session started — makes
            the "resuming continues, never duplicates" guarantee visible
            rather than just true. */}
        {summary.alreadyCommittedCount > 0 ? (
          <p className="mt-1 text-small text-muted-foreground">
            {summary.alreadyCommittedCount} tagihan sudah dikomit sebelumnya — tidak akan dibuat ulang.
          </p>
        ) : null}
      </div>

      <p className="text-small text-muted-foreground">
        Draf dibuat {formatRelativeTime(summary.createdAt)}.
      </p>
      {isStale ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>Draf ini sudah agak lama</AlertTitle>
          <AlertDescription>
            Struktur biaya atau keringanan mungkin sudah berubah sejak draf ini dibuat. Nilai
            tagihan di atas tetap memakai angka draf — hitung ulang untuk memakai data terkini.
          </AlertDescription>
          <AlertAction>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRebuildConfirmOpen(true)}
              disabled={isRunning || rebuilding}
            >
              Hitung Ulang
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {phase === "error" && errorMessage ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Komit terhenti</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {/* A ~200-student run is several sequential chunks over minutes. The
          counter ticking silently is no feedback at all for a screen-reader
          user, so the status card is a polite live region. */}
      {phase !== "idle" && progress.total > 0 ? (
        <Card className="p-4" role="status" aria-live="polite">
          <div className="mb-2 flex items-center gap-3">
            {isRunning ? <Loader2 size={16} className="animate-spin text-primary" aria-hidden /> : null}
            {phase === "done" ? <CheckCircle2 size={16} className="text-success" aria-hidden /> : null}
            <span className="text-small font-medium">
              {phase === "running" && `Mengomit tagihan… ${progress.done}/${progress.total}`}
              {phase === "sweeping" && "Memeriksa link pembayaran yang gagal…"}
              {phase === "done" &&
                `Selesai: ${progress.created} dibuat${progress.skipped > 0 ? `, ${progress.skipped} dilewati` : ""}`}
              {phase === "aborted" &&
                `Dibatalkan: ${progress.done}/${progress.total} diproses, ${progress.created} dibuat`}
              {phase === "error" &&
                `Terhenti: ${progress.done}/${progress.total} diproses, ${progress.created} dibuat`}
            </span>
            {isRunning ? (
              <Button variant="ghost" size="sm" onClick={handleCancel} className="ml-auto h-7 text-xs">
                Batalkan
              </Button>
            ) : null}
          </div>
          <Progress value={pct} />
        </Card>
      ) : null}

      <WizardFooter>
        {/* Secondary rebuild control — offered regardless of draft age
            (Task T6), not just from the stale-draft Alert above. A draft can
            go stale in an hour if someone edits a fee structure mid-session;
            STALE_DRAFT_MS is a 24h heuristic, not a guarantee. */}
        <Button
          type="button"
          variant="outline"
          onClick={() => setRebuildConfirmOpen(true)}
          disabled={isRunning || rebuilding}
          className="sm:mr-auto"
        >
          <RotateCcw size={14} aria-hidden />
          Hitung Ulang
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={isRunning}>
          Tutup
        </Button>
        {nothingLeftToCommit ? (
          phase !== "done" ? (
            <Button type="button" onClick={onCommitted}>
              Selesai
            </Button>
          ) : null
        ) : (
          <Button type="button" onClick={runCommit} disabled={isRunning}>
            {isRunning
              ? "Mengomit..."
              : phase === "aborted" || phase === "error"
                ? "Lanjutkan Komit"
                : summary.billableCount === 0
                  ? "Selesaikan Draf"
                  : `Komit ${summary.billableCount} Tagihan`}
          </Button>
        )}
      </WizardFooter>

      {/* "Hitung ulang" confirm (Task T6) — names exactly what is lost, per
          .claude/standards/voice.md's destructive-confirmations table: name
          the record, describe what happens, never "are you sure?". Shared by
          both triggers above (the stale-Alert action and the always-on
          secondary control). */}
      <ConfirmDialog
        open={rebuildConfirmOpen}
        onOpenChange={setRebuildConfirmOpen}
        title="Hitung ulang draf ini?"
        description="Baris dan nominal tagihan akan dihitung ulang dari struktur biaya dan keringanan terkini. Semua perubahan manual pada baris — nominal yang diubah, potongan, dan komponen tambahan — akan hilang. Siswa yang sudah dikecualikan tetap dikecualikan."
        confirmLabel="Hitung Ulang"
        onConfirm={handleRebuild}
        destructive
      />
    </div>
  );
}
