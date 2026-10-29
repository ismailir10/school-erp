"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { sendJson } from "@/lib/api/send-json";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import { formatDateShort, formatRupiah } from "@/lib/format";
import type { OpenInvoice, OpenInvoicesFollowUp } from "./cuti-types";

const NO_VOID_ACCESS = "Anda tidak punya akses untuk membatalkan tagihan.";

/**
 * Asked inside the row, not in a second overlay: the follow-up is already a
 * dialog, and `ui.md` allows one overlay at a time. Focus lands on the safe
 * choice and Escape backs out of the question instead of closing the dialog.
 */
function VoidQuestion({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div
      role="alert"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="space-y-2 rounded-md border border-destructive/30 bg-destructive-subtle p-3"
    >
      <p className="text-sm font-medium">Batalkan tagihan?</p>
      <p className="text-sm text-muted-foreground">Tagihan tidak bisa dibayar lagi. Riwayat tetap tersimpan.</p>
      <div className="flex justify-end gap-2">
        <Button ref={cancelRef} type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={onConfirm} disabled={busy}>
          {busy ? "Memproses..." : "Ya, batalkan"}
        </Button>
      </div>
    </div>
  );
}

function InvoiceRow({
  invoice,
  canVoid,
  confirming,
  busy,
  onAskVoid,
  onCancelVoid,
  onConfirmVoid,
}: {
  invoice: OpenInvoice;
  canVoid: boolean;
  confirming: boolean;
  busy: boolean;
  onAskVoid: () => void;
  onCancelVoid: () => void;
  onConfirmVoid: () => void;
}) {
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{invoice.invoiceNumber}</p>
          <p className="text-xs text-muted-foreground">
            {invoice.periodLabel} · Jatuh tempo {formatDateShort(invoice.dueDate)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={invoice.status} />
          <span className="font-currency text-sm font-semibold tabular-nums">{formatRupiah(invoice.totalDue)}</span>
        </div>
      </div>

      <ul className="space-y-1 text-sm" aria-label={`Rincian ${invoice.invoiceNumber}`}>
        {invoice.lines.map((line, i) => (
          <li key={`${line.label}-${i}`} className="flex items-start justify-between gap-3">
            <span className="min-w-0 break-words">
              {line.label}
              {!line.isRecurring && (
                <Badge variant="outline" className="ml-2 align-middle text-xs">
                  Sekali bayar
                </Badge>
              )}
            </span>
            <span className="font-currency shrink-0 tabular-nums text-muted-foreground">
              {formatRupiah(line.finalAmount)}
            </span>
          </li>
        ))}
      </ul>

      {invoice.hasOneOffLines && (
        <p className="text-xs text-muted-foreground">
          Ada biaya sekali bayar di tagihan ini. Biaya itu ikut batal kalau tagihan dibatalkan.
        </p>
      )}

      {canVoid &&
        (confirming ? (
          <VoidQuestion busy={busy} onCancel={onCancelVoid} onConfirm={onConfirmVoid} />
        ) : (
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={onAskVoid} disabled={busy}>
              Batalkan tagihan
            </Button>
          </div>
        ))}
    </li>
  );
}

/**
 * "Tagihan yang masih terbuka": the student's unpaid, still-cancellable
 * invoices for the months a leave covers. Nothing is cancelled automatically;
 * closing without cancelling is fine and the copy says so. The per-row cancel
 * button needs the void right (`canVoid`), the list itself the invoice-view
 * right (the API leaves it out otherwise).
 */
export function CutiInvoicesDialog({
  open,
  onOpenChange,
  followUp,
  onVoided,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followUp: OpenInvoicesFollowUp | null;
  /** Called with the invoice id once the server cancelled it. */
  onVoided: (invoiceId: string) => void;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmingId(null);
      setBusyId(null);
    }
  }, [open]);

  const invoices = followUp?.invoices ?? [];

  async function voidInvoice(id: string) {
    setBusyId(id);
    try {
      await sendJson(`/api/invoices/${id}/void`, { method: "POST" }, "Gagal membatalkan tagihan");
      toast.success("Tagihan dibatalkan");
      setConfirmingId(null);
      onVoided(id);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 403
          ? NO_VOID_ACCESS
          : userMessage(err, "Gagal membatalkan tagihan"),
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={(o) => busyId === null && onOpenChange(o)}
      title="Tagihan yang masih terbuka"
      description="Tagihan siswa yang belum dibayar untuk bulan cuti. Tidak ada yang dibatalkan otomatis; menutup dialog ini tidak apa-apa."
      size="xl"
      footer={
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busyId !== null}>
          Tutup
        </Button>
      }
    >
      {followUp?.otherActiveEnrollments && (
        <Alert role="status">
          <TriangleAlert aria-hidden="true" className="text-warning" />
          <AlertDescription>
            Tagihan ini mungkin memuat biaya kelas lain. Kalau dibatalkan, buat tagihan baru manual untuk biaya itu.
          </AlertDescription>
        </Alert>
      )}

      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada tagihan yang masih terbuka untuk bulan cuti ini.</p>
      ) : (
        <ul className="space-y-3" aria-label="Tagihan terbuka">
          {invoices.map((inv) => (
            <InvoiceRow
              key={inv.id}
              invoice={inv}
              canVoid={followUp?.canVoid ?? false}
              confirming={confirmingId === inv.id}
              busy={busyId === inv.id}
              onAskVoid={() => setConfirmingId(inv.id)}
              onCancelVoid={() => setConfirmingId(null)}
              onConfirmVoid={() => void voidInvoice(inv.id)}
            />
          ))}
        </ul>
      )}

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Tagihan dengan label periode lain tidak ditampilkan.</p>
        <p>Bulan yang tagihannya dibatalkan tidak ditagih ulang otomatis.</p>
      </div>
    </ResponsiveFormDialog>
  );
}
