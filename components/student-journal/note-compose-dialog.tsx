"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { formatDateShort } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

type Mode = "create" | "edit";

export type NoteComposeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  studentId: string;
  weekDates: string[];
  initialDate?: string;
  initialBody?: string;
  noteId?: string;
  /** Override the dialog title. Default: "Tulis catatan" / "Edit catatan". */
  title?: string;
  /** Override the textarea placeholder. Default: "Tulis catatan rumah di sini…". */
  placeholder?: string;
  /**
   * Who is composing. Drives the "who reads this" line under the title — a note
   * is a message to the other side of the buku penghubung, and neither author
   * was told that anywhere in the flow. Omit to render no line.
   */
  audience?: "teacher" | "parent";
  onSaved: () => void;
};

const AUDIENCE_HINT: Record<"teacher" | "parent", string> = {
  teacher: "Catatan ini akan dibaca wali murid.",
  parent: "Catatan ini akan dibaca Ustadzah.",
};

const MAX_LEN = 2000;

/** Cap to MAX_LEN without leaving half an emoji (a lone surrogate) at the cut. */
function capToMax(text: string): string {
  let out = text.slice(0, MAX_LEN);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}
const DEFAULT_PLACEHOLDER = "Tulis catatan rumah di sini…";
const PORTAL_TIMEZONE = "Asia/Jakarta";

function pickDefaultDate(
  dateOptions: string[],
  today: string,
  initialDate?: string,
): string {
  if (initialDate && dateOptions.includes(initialDate)) return initialDate;
  if (dateOptions.includes(today)) return today;
  return dateOptions[0] ?? "";
}

export function NoteComposeDialog({
  open,
  onOpenChange,
  mode,
  studentId,
  weekDates,
  initialDate,
  initialBody,
  noteId,
  title,
  placeholder,
  audience,
  onSaved,
}: NoteComposeDialogProps) {
  // Read per render rather than memoised on `open`: the value only changes at
  // midnight, and keying it to `open` was a lint-flagged dependency that did
  // not describe what it recomputed for.
  const today = getTodayInTimezone(PORTAL_TIMEZONE);
  const dateOptions = useMemo(() => {
    // An edited note may predate the week on screen (the thread is not
    // week-scoped), so its own date must stay selectable/displayed.
    if (mode === "edit") {
      return initialDate && !weekDates.includes(initialDate)
        ? [initialDate, ...weekDates]
        : weekDates;
    }
    return weekDates.filter((d) => d <= today);
  }, [mode, weekDates, today, initialDate]);

  const [date, setDate] = useState<string>(() =>
    pickDefaultDate(dateOptions, today, initialDate),
  );
  const [body, setBody] = useState<string>(initialBody ?? "");
  // Set when typed/pasted text went past MAX_LEN and was cut (TCHX-16).
  const [truncated, setTruncated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const keepWritingRef = useRef<HTMLButtonElement>(null);

  // Reset form whenever the dialog reopens or its inputs change
  useEffect(() => {
    if (open) {
      setDate(pickDefaultDate(dateOptions, today, initialDate));
      setBody(initialBody ?? "");
      setTruncated(false);
      setError(null);
      setSubmitting(false);
      setConfirmDiscard(false);
    }
  }, [open, initialDate, initialBody, dateOptions, today]);

  const trimmedLen = body.trim().length;
  const canSubmit =
    trimmedLen > 0 &&
    trimmedLen <= MAX_LEN &&
    !submitting &&
    (mode === "edit" || dateOptions.includes(date));

  // A half-written catatan is the one thing in this dialog that cannot be
  // recovered, and the dimmed backdrop is easy to hit one-handed (TCH-3). Every
  // way of dismissing — outside tap, Escape, Batal — goes through here; only a
  // saved note or an explicit "Buang" closes over a changed draft.
  //
  // The "Buang catatan?" question is asked inside this dialog's footer, not in
  // a second overlay on top of it (ui.md: one overlay at a time). While it is
  // showing, Escape / outside tap mean "keep writing".
  const dirty = body.trim() !== (initialBody ?? "").trim();
  useEffect(() => {
    if (confirmDiscard) keepWritingRef.current?.focus();
  }, [confirmDiscard]);
  function requestClose(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (submitting) return;
    if (confirmDiscard) {
      setConfirmDiscard(false);
      return;
    }
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      let res: Response;
      if (mode === "create") {
        res = await fetch("/api/student-journal/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, date, body: body.trim() }),
        });
      } else {
        if (!noteId) {
          setError("ID catatan tidak ditemukan");
          setSubmitting(false);
          return;
        }
        res = await fetch(`/api/student-journal/notes/${noteId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: body.trim() }),
        });
      }

      if (!res.ok) {
        let message: string;
        if (res.status === 429) {
          message = "Terlalu banyak permintaan. Coba lagi sebentar.";
        } else {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          message = json.error ?? "Gagal menyimpan catatan";
        }
        setError(message);
        toast.error(message);
        setSubmitting(false);
        return;
      }

      toast.success("Catatan tersimpan");
      onSaved();
      onOpenChange(false);
    } catch {
      const message = "Gagal terhubung ke server";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={requestClose}
      title={title ?? (mode === "create" ? "Tulis catatan" : "Edit catatan")}
      description={audience ? AUDIENCE_HINT[audience] : undefined}
      size="sm"
      contentClassName="p-card"
      footer={
        confirmDiscard ? (
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div role="alert" className="text-sm">
              <p className="font-medium">Buang catatan?</p>
              <p className="text-muted-foreground">Catatan yang belum disimpan akan hilang.</p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                ref={keepWritingRef}
                variant="ghost"
                className="tap-target"
                onClick={() => setConfirmDiscard(false)}
              >
                Lanjut menulis
              </Button>
              <Button variant="destructive" className="tap-target" onClick={() => onOpenChange(false)}>
                Buang
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button
              variant="ghost"
              className="tap-target"
              onClick={() => requestClose(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button className="tap-target" onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? "Menyimpan…" : "Simpan"}
            </Button>
          </>
        )
      }
    >
      <Field>
        <FieldLabel htmlFor="note-date">Tanggal</FieldLabel>
        <Select
          value={date}
          onValueChange={(v) => v && setDate(v)}
          disabled={mode === "edit" || dateOptions.length === 0}
        >
          <SelectTrigger id="note-date" className="tap-target w-full">
            <SelectValue
              placeholder={dateOptions.length > 0 ? "Pilih tanggal" : "Tidak ada tanggal tersedia"}
            />
          </SelectTrigger>
          <SelectContent>
            {dateOptions.map((d) => (
              <SelectItem key={d} value={d}>
                {formatDateShort(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mode === "create" && dateOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Catatan hanya bisa dibuat untuk tanggal hari ini atau sebelumnya.
          </p>
        ) : null}
      </Field>

      <Field className="min-w-0">
        <FieldLabel htmlFor="note-body">Isi catatan</FieldLabel>
        <Textarea
          id="note-body"
          value={body}
          onChange={(e) => {
            // Not `maxLength`: the browser trims a paste silently. Cap here so
            // the teacher is told their text was cut.
            const next = e.target.value;
            if (next.length > MAX_LEN) {
              setBody(capToMax(next));
              setTruncated(true);
            } else {
              setBody(next);
              setTruncated(false);
            }
          }}
          rows={5}
          // Capped so a long note scrolls inside the box and the counter below stays on screen.
          className="min-w-0 max-h-48 overflow-y-auto [overflow-wrap:anywhere]"
          placeholder={placeholder ?? DEFAULT_PLACEHOLDER}
          aria-invalid={error ? true : undefined}
        />
        <div className="flex items-center justify-between mt-1">
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : truncated ? (
            <p role="status" className="text-xs text-status-late-text">
              Catatan dipotong ke {MAX_LEN} karakter.
            </p>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground">
            {body.length}/{MAX_LEN}
          </span>
        </div>
      </Field>
    </ResponsiveFormDialog>
  );
}
