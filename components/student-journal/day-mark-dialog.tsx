"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { DAY_MARK_REASON_MAX } from "@/lib/validations/student-journal";
import { DAY_MARK_SUGGESTIONS } from "@/lib/student-journal/day-mark-rules";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classSectionId: string;
  /** `YYYY-MM-DD` of the class-day being marked. */
  date: string;
  /** Current keterangan when the day is already marked (turns on "Hapus tanda"). */
  initialReason?: string | null;
  /** Called with the saved keterangan, or null once the mark is removed. */
  onSaved: (reason: string | null) => void;
};

async function errorMessage(res: Response, fallback: string): Promise<string> {
  if (res.status === 429) return "Terlalu banyak permintaan. Coba lagi sebentar.";
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return json.error ?? fallback;
}

/**
 * Mark a class-day "hari tanpa buku penghubung" with a short keterangan (Renang,
 * Libur …). Shared by the guru's entry page and the admin monitoring view; both
 * hit the same route, which decides who may write.
 */
export function DayMarkDialog({ open, onOpenChange, classSectionId, date, initialReason, onSaved }: Props) {
  const [reason, setReason] = useState(initialReason ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason(initialReason ?? "");
      setError(null);
      setSubmitting(false);
    }
  }, [open, initialReason]);

  const trimmed = reason.trim();
  const canSave = trimmed.length > 0 && trimmed !== (initialReason ?? "") && !submitting;

  async function send(method: "PUT" | "DELETE") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/student-journal/day-marks", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          method === "PUT" ? { classSectionId, date, reason: trimmed } : { classSectionId, date },
        ),
      });
      if (!res.ok) {
        const message = await errorMessage(res, method === "PUT" ? "Gagal menyimpan keterangan" : "Gagal menghapus tanda");
        setError(message);
        toast.error(message);
        return;
      }
      toast.success(method === "PUT" ? "Hari ditandai tanpa buku penghubung" : "Tanda hari dihapus");
      onSaved(method === "PUT" ? trimmed : null);
      onOpenChange(false);
    } catch {
      const message = "Koneksi terputus. Coba lagi sebentar ya.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
      title="Hari tanpa buku penghubung"
      description={`${formatDate(date, { weekday: "long", day: "numeric", month: "long" })}. Wali akan melihat keterangan ini di kolom hari tersebut.`}
      size="sm"
      contentClassName="p-card"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {initialReason ? (
            <Button
              variant="ghost"
              className="tap-target text-destructive"
              onClick={() => send("DELETE")}
              disabled={submitting}
              data-testid="day-mark-remove"
            >
              Hapus tanda
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" className="tap-target" onClick={() => onOpenChange(false)} disabled={submitting}>
              Batal
            </Button>
            <Button className="tap-target" onClick={() => send("PUT")} disabled={!canSave} data-testid="day-mark-save">
              {submitting ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </div>
      }
    >
      <Field>
        <FieldLabel htmlFor="day-mark-reason">Keterangan</FieldLabel>
        <Input
          id="day-mark-reason"
          value={reason}
          maxLength={DAY_MARK_REASON_MAX}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSave) {
              e.preventDefault();
              void send("PUT");
            }
          }}
          placeholder="Misal: Renang"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          className="tap-target"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          {error ? <p className="text-xs text-destructive">{error}</p> : <span />}
          <span className="text-xs tabular-nums text-muted-foreground">
            {reason.length}/{DAY_MARK_REASON_MAX}
          </span>
        </div>
      </Field>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Keterangan yang sering dipakai">
        {DAY_MARK_SUGGESTIONS.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => setReason(label)}
            className="tap-target inline-flex items-center rounded-full border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 active:bg-primary/20 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {label}
          </button>
        ))}
      </div>
    </ResponsiveFormDialog>
  );
}
