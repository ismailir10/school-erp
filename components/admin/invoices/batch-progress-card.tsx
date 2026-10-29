"use client";

import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { BatchProgressSnapshot, FailureRow } from "@/lib/finance/run-bulk-generate";
import type { BulkRetrySnapshot, RetryFailureRow } from "@/lib/finance/run-bulk-retry";
import { parsePaymentLinkError } from "@/lib/payments/error-prefix";

/**
 * Sticky progress card shown during a bulk-generate or bulk-retry run.
 *
 * `mode` discriminator switches headers + done copy between the two flows:
 *   - "generate" (default): "Membuat tagihan…" / "Selesai: N dibuat, M link gagal"
 *   - "retry":              "Memperbaiki link pembayaran…" / "Selesai: N link diperbaiki, M masih gagal"
 *
 * Shadcn `<Progress>` keeps the batch indicator aligned with the shared UI
 * system while this card owns the batch-specific copy, cancellation, and
 * failure detail disclosure.
 *
 * T4 additions:
 *   - "Batalkan" ghost button while phase === "running" — calls `onCancel`
 *     which the page-level wiring fans out to AbortController.
 *   - `beforeunload` listener registered while phase === "running" with the
 *     spec-mandated copy "Pembuatan tagihan sedang berjalan. Yakin keluar?"
 *   - Collapsible <details> "Lihat detail (N gagal)" listing failed students.
 */
type GenerateProps = {
  mode?: "generate";
  progress: BatchProgressSnapshot;
  onCancel?: () => void;
};

type RetryProps = {
  mode: "retry";
  progress: BulkRetrySnapshot;
  onCancel?: () => void;
};

export type BatchProgressCardProps = GenerateProps | RetryProps;

const BEFORE_UNLOAD_MESSAGE = "Pembuatan tagihan sedang berjalan. Yakin keluar?";

/**
 * beforeunload guard — fires whenever the orchestrator is mid-run so a
 * fat-finger sidebar click triggers the browser's native confirm dialog.
 */
function useBeforeUnloadWhileRunning(running: boolean) {
  useEffect(() => {
    if (!running) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore custom strings but `returnValue` is still the
      // canonical signal that a confirm dialog should fire.
      e.returnValue = BEFORE_UNLOAD_MESSAGE;
      return BEFORE_UNLOAD_MESSAGE;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [running]);
}

export function BatchProgressCard(props: BatchProgressCardProps) {
  if (props.mode === "retry") {
    return <RetryCard progress={props.progress} onCancel={props.onCancel} />;
  }
  return <GenerateCard progress={props.progress} onCancel={props.onCancel} />;
}

function FailureDetails({ failures }: { failures: ReadonlyArray<FailureRow | RetryFailureRow> }) {
  if (failures.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
        Lihat detail ({failures.length} gagal)
      </summary>
      <ul className="mt-2 space-y-1 text-xs">
        {failures.map((f, i) => (
          <li key={`${f.studentId}-${i}`} className="flex flex-col gap-0.5 py-1 border-t border-border/40 first:border-t-0">
            <span className="font-medium">{f.studentName}</span>
            <span className="text-muted-foreground">{parsePaymentLinkError(f.error)?.userMessage ?? "Gagal membuat link pembayaran."}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function GenerateCard({
  progress,
  onCancel,
}: {
  progress: BatchProgressSnapshot;
  onCancel?: () => void;
}) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const isRunning = progress.phase === "running";
  useBeforeUnloadWhileRunning(isRunning);

  return (
    <Card className="sticky top-4 z-sticky p-4 mb-4 border-primary/30 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        {isRunning ? (
          <Spinner className="text-primary" aria-hidden />
        ) : null}
        {progress.phase === "done" ? (
          <CheckCircle2 size={16} className="text-success" aria-hidden />
        ) : null}
        <span className="text-sm font-medium">
          {progress.phase === "running" && `Membuat tagihan… ${progress.done}/${progress.total}`}
          {progress.phase === "done" &&
            `Selesai: ${progress.created} dibuat, ${progress.xenditFailed} link gagal`}
          {progress.phase === "aborted" &&
            `Dibatalkan: ${progress.created} dibuat, ${progress.xenditFailed} link gagal`}
        </span>
        {isRunning && onCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="ml-auto h-7 text-xs"
          >
            Batalkan
          </Button>
        )}
      </div>

      <Progress value={pct} className="mb-2" />

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{progress.xenditOk} link berhasil</span>
        {progress.xenditFailed > 0 && (
          <span className="text-warning">{progress.xenditFailed} link gagal</span>
        )}
      </div>

      <FailureDetails failures={progress.failures ?? []} />
    </Card>
  );
}

function RetryCard({
  progress,
  onCancel,
}: {
  progress: BulkRetrySnapshot;
  onCancel?: () => void;
}) {
  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  const isRunning = progress.phase === "running" || progress.phase === "fetching-pending";
  useBeforeUnloadWhileRunning(isRunning);

  return (
    <Card className="sticky top-4 z-sticky p-4 mb-4 border-primary/30 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        {isRunning ? (
          <Spinner className="text-primary" aria-hidden />
        ) : null}
        {progress.phase === "done" ? (
          <CheckCircle2 size={16} className="text-success" aria-hidden />
        ) : null}
        <span className="text-sm font-medium">
          {progress.phase === "fetching-pending" && "Memperbaiki link pembayaran…"}
          {progress.phase === "running" &&
            `Memperbaiki link pembayaran… ${progress.processed}/${progress.total}`}
          {progress.phase === "done" &&
            `Selesai: ${progress.fixed} link diperbaiki, ${progress.stillFailed} masih gagal`}
          {progress.phase === "aborted" &&
            `Dibatalkan: ${progress.fixed} diperbaiki, ${progress.stillFailed} masih gagal`}
          {progress.phase === "overflow" && "Memperbaiki link pembayaran…"}
        </span>
        {isRunning && onCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="ml-auto h-7 text-xs"
          >
            Batalkan
          </Button>
        )}
      </div>

      <Progress value={pct} className="mb-2" />

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{progress.fixed} link diperbaiki</span>
        {progress.stillFailed > 0 && (
          <span className="text-warning">{progress.stillFailed} masih gagal</span>
        )}
      </div>

      <FailureDetails failures={progress.failures ?? []} />
    </Card>
  );
}
