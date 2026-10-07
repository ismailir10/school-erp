"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RupiahInput } from "@/components/ui/rupiah-input";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatRupiah } from "@/lib/format";
import { userMessage, ApiError } from "@/lib/api/client-errors";
import { cn } from "@/lib/utils";
import type {
  BillingRunLineData,
  BillingRunRowData,
  FeeComponentOption,
  MutateBillingRunLineResponse,
  DeleteBillingRunLineResponse,
} from "./types";

// Billing Run wizard (Cycle B2 — docs/cycles/2026-08-14-billing-run-wizard-b2.md,
// Task T5). Step 2's line-editing surface: per-line edit + remove, plus
// "Tambah potongan" / "Tambah komponen" per row. Mounted by step-2-review.tsx
// in place of its read-only line list, only for rows whose status is
// PENDING or EXCLUDED — mirrors the route's `MUTABLE_ROW_STATUSES` allowlist
// (app/api/billing-runs/[id]/rows/[rowId]/lines/route.ts) so the UI never
// offers an action the server will refuse with a 409.
//
// State ownership: this file only fetches + reports results. The row list
// itself lives in step-2-review.tsx's `rowsPage` state; every dialog here
// calls `onMutated` with the server's response and lets the parent patch
// its own state, exactly like `handleToggleInclude` already does for the
// exclude switch.
//
// better-accessibility: editing is a real form (label + input + submit),
// not a click-to-edit cell — each row action is a labelled button that
// opens a Dialog/Sheet (ResponsiveFormDialog) or ConfirmDialog; closing
// either returns focus to its trigger, so focus lands somewhere sensible
// after every save. Cross-checked design-system.html §07 Forms (Field +
// FieldLabel + FieldDescription, errors under the field) and §13 Overlays
// (Dialog on desktop / Sheet on mobile via ResponsiveFormDialog,
// ConfirmDialog for the destructive remove confirm).

const DEFAULT_ADJUSTMENT_NOTE_HELP =
  "Orang tua akan melihat catatan ini pada tagihan mereka — jangan tulis catatan internal di sini.";

function parseIntegerAmount(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

const SOURCE_BADGE: Partial<Record<string, string>> = {
  EDITED: "Diedit",
  MANUAL: "Manual",
};

function LineSourceBadge({ source }: { source: string }) {
  const label = SOURCE_BADGE[source];
  if (!label) return null;
  return (
    <Badge variant="outline" className="shrink-0 text-xs">
      {label}
    </Badge>
  );
}

function availableCatalogComponents(
  all: FeeComponentOption[],
  row: BillingRunRowData,
): FeeComponentOption[] {
  const usedIds = new Set(row.lines.map((l) => l.feeComponentId));
  return all.filter((c) => c.isEnabled && c.status === "ACTIVE" && !usedIds.has(c.id));
}

// ------------------------------------------------------------------
// Edit an existing line's final amount / label / note
// ------------------------------------------------------------------

function EditLineDialog({
  runId,
  row,
  line,
  open,
  onOpenChange,
  onMutated,
}: {
  runId: string;
  row: BillingRunRowData;
  line: BillingRunLineData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutated: (line: BillingRunLineData, totalDue: number) => void;
}) {
  const [amount, setAmount] = useState(String(Number(line.finalAmount)));
  const [label, setLabel] = useState(line.labelSnapshot);
  // Pre-fill from the line's existing adjustmentNote — a keringanan line's
  // reason must never be silently clobbered by opening this dialog and
  // saving (Spec acceptance).
  const [note, setNote] = useState(line.adjustmentNote ?? "");
  const [errors, setErrors] = useState<{ amount?: string; label?: string }>({});
  const [saving, setSaving] = useState(false);

  // Reopening the dialog for a (possibly different) line must reset to that
  // line's current values, not whatever was left over from the last edit.
  function handleOpenChange(next: boolean) {
    if (next) {
      setAmount(String(Number(line.finalAmount)));
      setLabel(line.labelSnapshot);
      setNote(line.adjustmentNote ?? "");
      setErrors({});
    }
    onOpenChange(next);
  }

  async function handleSubmit() {
    const parsedAmount = parseIntegerAmount(amount);
    const trimmedLabel = label.trim();
    const nextErrors: { amount?: string; label?: string } = {};
    if (parsedAmount === null) {
      nextErrors.amount = "Jumlah harus berupa bilangan bulat";
    } else if (line.source !== "MANUAL" && parsedAmount < 0) {
      nextErrors.amount = "Jumlah akhir tidak boleh negatif untuk komponen biaya";
    }
    if (!trimmedLabel) nextErrors.label = "Label wajib diisi";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || parsedAmount === null) return;

    setSaving(true);
    try {
      const res = await fetch(
        `/api/billing-runs/${runId}/rows/${row.id}/lines/${line.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            finalAmount: parsedAmount,
            label: trimmedLabel,
            // Explicit null (not omitted) clears the note — omitting the key
            // means "leave unchanged" server-side, matching the schema
            // comment's Cycle A validFrom/validTo lesson.
            note: note.trim() === "" ? null : note.trim(),
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(body?.error || "Gagal menyimpan perubahan baris");
      }
      const json = (await res.json()) as MutateBillingRunLineResponse;
      onMutated(json.line, json.totalDue);
      handleOpenChange(false);
    } catch (err) {
      toast.error(userMessage(err, "Gagal menyimpan perubahan baris"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Edit Baris Tagihan"
      description={`${row.studentNameSnapshot} · ${line.labelSnapshot}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan"}
          </Button>
        </>
      }
    >
      <Field data-invalid={errors.label ? "true" : undefined}>
        <FieldLabel required htmlFor={`line-edit-label-${line.id}`}>
          Label
        </FieldLabel>
        <Input
          id={`line-edit-label-${line.id}`}
          required
          aria-required="true"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <FieldError>{errors.label}</FieldError>
      </Field>

      {/* A MANUAL-source line's finalAmount may legally go negative (a
          correction after an overcharge, or a "Tambah potongan" line, which
          is stored as a negative — see handleSubmit's
          `line.source !== "MANUAL" && parsedAmount < 0` branch and
          resolveLineEdit in lib/finance/billing-run-lines.ts), so only those
          lines get `allowNegative`; every other source stays non-negative. A
          native number input could not read "1.500.000" or "1500000,50". */}
      <Field data-invalid={errors.amount ? "true" : undefined}>
        <FieldLabel required htmlFor={`line-edit-amount-${line.id}`}>
          Jumlah Akhir
        </FieldLabel>
        <RupiahInput
          id={`line-edit-amount-${line.id}`}
          required
          aria-required="true"
          allowNegative={line.source === "MANUAL"}
          value={amount === "" ? null : Number(amount)}
          onChange={(v) => setAmount(v === null ? "" : String(v))}
        />
        <FieldDescription>Jumlah yang ditagih ke keluarga untuk komponen ini (Rupiah).</FieldDescription>
        <FieldError>{errors.amount}</FieldError>
      </Field>

      <Field>
        <FieldLabel htmlFor={`line-edit-note-${line.id}`}>Catatan</FieldLabel>
        <Textarea
          id={`line-edit-note-${line.id}`}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Contoh: potongan sibling, anak kedua dan ketiga"
        />
        <FieldDescription>{DEFAULT_ADJUSTMENT_NOTE_HELP}</FieldDescription>
      </Field>
    </ResponsiveFormDialog>
  );
}

// ------------------------------------------------------------------
// Add an ad-hoc discount line ("Tambah potongan")
// ------------------------------------------------------------------

function AddDiscountDialog({
  runId,
  row,
  open,
  onOpenChange,
  onMutated,
}: {
  runId: string;
  row: BillingRunRowData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutated: (line: BillingRunLineData, totalDue: number) => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<{ label?: string; amount?: string }>({});
  const [saving, setSaving] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      setLabel("");
      setAmount("");
      setErrors({});
    }
    onOpenChange(next);
  }

  async function handleSubmit() {
    const trimmedLabel = label.trim();
    const parsedAmount = parseIntegerAmount(amount);
    const nextErrors: { label?: string; amount?: string } = {};
    if (!trimmedLabel) nextErrors.label = "Label wajib diisi";
    if (parsedAmount === null || parsedAmount < 0) {
      nextErrors.amount = "Jumlah potongan harus bilangan bulat, 0 atau lebih";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || parsedAmount === null) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/billing-runs/${runId}/rows/${row.id}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "DISCOUNT", label: trimmedLabel, amount: parsedAmount }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(body?.error || "Gagal menambahkan potongan");
      }
      const json = (await res.json()) as MutateBillingRunLineResponse;
      onMutated(json.line, json.totalDue);
      handleOpenChange(false);
    } catch (err) {
      toast.error(userMessage(err, "Gagal menambahkan potongan"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Tambah Potongan"
      description={`Potongan manual untuk ${row.studentNameSnapshot}. Mengurangi total tagihan baris ini.`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Menyimpan..." : "Tambah Potongan"}
          </Button>
        </>
      }
    >
      <Field data-invalid={errors.label ? "true" : undefined}>
        <FieldLabel required htmlFor={`discount-label-${row.id}`}>
          Label
        </FieldLabel>
        <Input
          id={`discount-label-${row.id}`}
          required
          aria-required="true"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Contoh: Potongan promo Ramadhan"
        />
        <FieldError>{errors.label}</FieldError>
      </Field>

      <Field data-invalid={errors.amount ? "true" : undefined}>
        <FieldLabel required htmlFor={`discount-amount-${row.id}`}>
          Jumlah Potongan
        </FieldLabel>
        <RupiahInput
          id={`discount-amount-${row.id}`}
          required
          value={amount === "" ? null : Number(amount)}
          onChange={(v) => setAmount(v === null ? "" : String(v))}
        />
        <FieldDescription>Nominal potongan dalam Rupiah — masukkan sebagai angka positif.</FieldDescription>
        <FieldError>{errors.amount}</FieldError>
      </Field>
    </ResponsiveFormDialog>
  );
}

// ------------------------------------------------------------------
// Add a line from the FeeComponentDef catalog ("Tambah komponen")
// ------------------------------------------------------------------

function AddComponentDialog({
  runId,
  row,
  options,
  open,
  onOpenChange,
  onMutated,
}: {
  runId: string;
  row: BillingRunRowData;
  options: FeeComponentOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutated: (line: BillingRunLineData, totalDue: number) => void;
}) {
  const [feeComponentId, setFeeComponentId] = useState("");
  // DEVIATION from the cycle doc's acceptance criterion ("amount pre-fills
  // from ProgramFeeStructure"): BillingRunRow does not carry `programId`, so
  // there is no way to look up the right fee-structure row from what step 2
  // has, and plumbing `programId` through the row is out of scope for this
  // cycle. The amount starts blank and the admin types it.
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [errors, setErrors] = useState<{ feeComponentId?: string; amount?: string; label?: string }>({});
  const [saving, setSaving] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      setFeeComponentId("");
      setAmount("");
      setLabel("");
      setErrors({});
    }
    onOpenChange(next);
  }

  function handleComponentChange(value: string) {
    if (!value) return;
    setFeeComponentId(value);
    const selected = options.find((c) => c.id === value);
    // Prefill the label with the component's own label — the admin can
    // still rename it before submitting.
    if (selected) setLabel(selected.label);
  }

  async function handleSubmit() {
    const trimmedLabel = label.trim();
    const parsedAmount = parseIntegerAmount(amount);
    const nextErrors: { feeComponentId?: string; amount?: string; label?: string } = {};
    if (!feeComponentId) nextErrors.feeComponentId = "Komponen biaya wajib dipilih";
    if (!trimmedLabel) nextErrors.label = "Label wajib diisi";
    if (parsedAmount === null || parsedAmount < 0) {
      nextErrors.amount = "Jumlah harus bilangan bulat, 0 atau lebih";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || parsedAmount === null) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/billing-runs/${runId}/rows/${row.id}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "CATALOG",
          feeComponentId,
          label: trimmedLabel,
          amount: parsedAmount,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(body?.error || "Gagal menambahkan komponen");
      }
      const json = (await res.json()) as MutateBillingRunLineResponse;
      onMutated(json.line, json.totalDue);
      handleOpenChange(false);
    } catch (err) {
      toast.error(userMessage(err, "Gagal menambahkan komponen"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Tambah Komponen"
      description={`Tambahkan komponen biaya dari katalog untuk ${row.studentNameSnapshot}.`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Menyimpan..." : "Tambah Komponen"}
          </Button>
        </>
      }
    >
      <Field data-invalid={errors.feeComponentId ? "true" : undefined}>
        <FieldLabel required htmlFor={`component-select-${row.id}`}>
          Komponen Biaya
        </FieldLabel>
        <Select value={feeComponentId} onValueChange={(v) => handleComponentChange(String(v ?? ""))}>
          <SelectTrigger id={`component-select-${row.id}`} aria-required="true">
            <SelectValue placeholder="Pilih komponen" />
          </SelectTrigger>
          <SelectContent>
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                Semua komponen aktif sudah dipakai pada baris ini
              </div>
            ) : (
              options.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <FieldError>{errors.feeComponentId}</FieldError>
      </Field>

      <Field data-invalid={errors.label ? "true" : undefined}>
        <FieldLabel required htmlFor={`component-label-${row.id}`}>
          Label
        </FieldLabel>
        <Input
          id={`component-label-${row.id}`}
          required
          aria-required="true"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <FieldError>{errors.label}</FieldError>
      </Field>

      <Field data-invalid={errors.amount ? "true" : undefined}>
        <FieldLabel required htmlFor={`component-amount-${row.id}`}>
          Jumlah
        </FieldLabel>
        <RupiahInput
          id={`component-amount-${row.id}`}
          required
          value={amount === "" ? null : Number(amount)}
          onChange={(v) => setAmount(v === null ? "" : String(v))}
        />
        <FieldDescription>
          Tidak terisi otomatis dari struktur biaya program — masukkan jumlah secara manual.
        </FieldDescription>
        <FieldError>{errors.amount}</FieldError>
      </Field>
    </ResponsiveFormDialog>
  );
}

// ------------------------------------------------------------------
// Remove a line
// ------------------------------------------------------------------

function DeleteLineConfirm({
  runId,
  row,
  line,
  onOpenChange,
  onRemoved,
}: {
  runId: string;
  row: BillingRunRowData;
  line: BillingRunLineData | null;
  onOpenChange: (open: boolean) => void;
  onRemoved: (lineId: string, totalDue: number) => void;
}) {
  async function handleConfirm() {
    if (!line) return;
    try {
      const res = await fetch(
        `/api/billing-runs/${runId}/rows/${row.id}/lines/${line.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Never a silent no-op — the last-line-of-a-PENDING-row 409 has a
        // specific message pointing at the exclude toggle instead, and the
        // admin must see it, not just watch the dialog close.
        throw new ApiError(body?.error || "Gagal menghapus baris tagihan");
      }
      const json = (await res.json()) as DeleteBillingRunLineResponse;
      onRemoved(line.id, json.totalDue);
    } catch (err) {
      toast.error(userMessage(err, "Gagal menghapus baris tagihan"));
      // Re-throw so ConfirmDialog keeps the dialog open on failure instead
      // of closing as if the delete had succeeded.
      throw err;
    }
  }

  return (
    <ConfirmDialog
      open={!!line}
      onOpenChange={(o) => !o && onOpenChange(false)}
      title="Hapus baris tagihan ini?"
      description={`${line ? `"${line.labelSnapshot}"` : "Baris ini"} akan dihapus dari tagihan ${row.studentNameSnapshot}. Tindakan ini tidak bisa dibatalkan.`}
      confirmLabel="Ya, Hapus"
      destructive
      onConfirm={handleConfirm}
    />
  );
}

// ------------------------------------------------------------------
// Top-level: editable line list + row actions
// ------------------------------------------------------------------

export function EditableRowLines({
  runId,
  row,
  feeComponents,
  onLineUpdated,
  onLineAdded,
  onLineRemoved,
}: {
  runId: string;
  row: BillingRunRowData;
  feeComponents: FeeComponentOption[];
  onLineUpdated: (line: BillingRunLineData, totalDue: number) => void;
  onLineAdded: (line: BillingRunLineData, totalDue: number) => void;
  onLineRemoved: (lineId: string, totalDue: number) => void;
}) {
  const [editingLine, setEditingLine] = useState<BillingRunLineData | null>(null);
  const [deletingLine, setDeletingLine] = useState<BillingRunLineData | null>(null);
  const [addDiscountOpen, setAddDiscountOpen] = useState(false);
  const [addComponentOpen, setAddComponentOpen] = useState(false);

  const catalogOptions = useMemo(
    () => availableCatalogComponents(feeComponents, row),
    [feeComponents, row],
  );

  return (
    <div className="mt-3 space-y-2 border-t border-border/60 pt-3 pl-7">
      <ul className="space-y-2">
        {row.lines.map((line) => (
          <li key={line.id} className="flex items-center justify-between gap-3 text-small">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-foreground">
                {line.labelSnapshot}
                <LineSourceBadge source={line.source} />
              </p>
              {Number(line.adjustmentAmount) !== 0 ? (
                <p className="text-caption text-muted-foreground">
                  Penyesuaian: {formatRupiah(line.adjustmentAmount)}
                  {line.adjustmentNote ? ` (${line.adjustmentNote})` : ""}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-currency tabular-nums text-foreground">
                {formatRupiah(line.finalAmount)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Edit baris ${line.labelSnapshot}`}
                onClick={() => setEditingLine(line)}
              >
                <Pencil size={13} aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("size-7 text-destructive hover:text-destructive")}
                aria-label={`Hapus baris ${line.labelSnapshot}`}
                onClick={() => setDeletingLine(line)}
              >
                <Trash2 size={13} aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={() => setAddDiscountOpen(true)}>
          <Plus size={13} className="mr-1" aria-hidden="true" />
          Tambah Potongan
        </Button>
        {catalogOptions.length > 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setAddComponentOpen(true)}>
            <Plus size={13} className="mr-1" aria-hidden="true" />
            Tambah Komponen
          </Button>
        ) : (
          <span className="text-caption text-muted-foreground">
            Semua komponen aktif sudah dipakai pada baris ini
          </span>
        )}
      </div>

      {editingLine ? (
        <EditLineDialog
          runId={runId}
          row={row}
          line={editingLine}
          open={!!editingLine}
          onOpenChange={(open) => !open && setEditingLine(null)}
          onMutated={onLineUpdated}
        />
      ) : null}

      <DeleteLineConfirm
        runId={runId}
        row={row}
        line={deletingLine}
        onOpenChange={(open) => !open && setDeletingLine(null)}
        onRemoved={onLineRemoved}
      />

      <AddDiscountDialog
        runId={runId}
        row={row}
        open={addDiscountOpen}
        onOpenChange={setAddDiscountOpen}
        onMutated={onLineAdded}
      />

      <AddComponentDialog
        runId={runId}
        row={row}
        options={catalogOptions}
        open={addComponentOpen}
        onOpenChange={setAddComponentOpen}
        onMutated={onLineAdded}
      />
    </div>
  );
}
