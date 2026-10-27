"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { RupiahInput } from "@/components/ui/rupiah-input";
import { Button } from "@/components/ui/button";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { ApiError } from "@/lib/api/client-errors";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { MANUAL_PAYMENT_METHODS, paymentMethodLabel } from "@/lib/constants/payment-methods";
import { formatRupiah, formatMonthLabel } from "@/lib/format";
import { StudentPicker, type Student } from "@/components/admin/student-picker";
import {
  DUPLICATE_LINES_MESSAGE,
  manualInvoiceFormSchema,
  paymentFromForm,
} from "@/lib/validations/invoice";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type FeeComponent = {
  id: string;
  label: string;
  isEnabled: boolean;
  status: string;
};

// ------------------------------------------------------------------
// Defaults
// ------------------------------------------------------------------

function buildInitialForm() {
  const now = new Date();
  const periodLabel = formatMonthLabel(now.getFullYear(), now.getMonth() + 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const dueDate = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
  return {
    studentId: "",
    periodLabel,
    dueDate,
    lines: [{ feeComponentId: "", amount: null as number | null }],
    // "Sudah dibayar" (only reachable with `canRecordPayment`). Kept in form
    // state while unticked but never sent.
    markPaid: false,
    method: "CASH" as "CASH" | "BANK_TRANSFER" | "OTHER" | "",
    paidAt: getTodayInTimezone("Asia/Jakarta"),
    reference: "",
    notes: "",
  };
}

/** The API names the paid fields `payment.*`; the form binds them flat. */
const PAYMENT_FIELD_PREFIX = "payment.";

function flattenPaymentFieldErrors(err: unknown): unknown {
  if (!(err instanceof ApiError) || err.fieldErrors.length === 0) return err;
  return new ApiError(err.message, {
    status: err.status,
    fieldErrors: err.fieldErrors.map((e) =>
      e.field.startsWith(PAYMENT_FIELD_PREFIX)
        ? { ...e, field: e.field.slice(PAYMENT_FIELD_PREFIX.length) }
        : e,
    ),
  });
}

const PAYMENT_FORBIDDEN_MESSAGE =
  "Anda belum punya izin mencatat pembayaran. Hapus centang \"Sudah dibayar\", atau minta akses ke admin.";

// ------------------------------------------------------------------
// Dialog
// ------------------------------------------------------------------

type ManualInvoiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  /**
   * Show the "Sudah dibayar" option (admin holds `payments.record`). When
   * false the dialog behaves exactly as before and never sends `payment`.
   */
  canRecordPayment?: boolean;
};

export function ManualInvoiceDialog({
  open,
  onOpenChange,
  onCreated,
  canRecordPayment = false,
}: ManualInvoiceDialogProps) {
  const router = useRouter();
  const formId = useId();
  // One key per dialog open: a double click or a retry after a failure replays
  // the same payment instead of recording it twice. Cleared on success/close.
  const idempotencyKeyRef = useRef<string | null>(null);

  const form = useZodForm(manualInvoiceFormSchema, { defaultValues: buildInitialForm() });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  // `useWatch` hands back a fresh array on every field change. `form.watch()`
  // returns react-hook-form's live, mutated-in-place array, so anything keyed
  // on its reference (the old `useMemo` for Total) never recomputed while
  // typing — Total lagged one edit behind, or read Rp 0.
  const lines = useWatch({ control: form.control, name: "lines" });

  // `manualInvoiceFormSchema`'s duplicate-fee-component check issues at path
  // ["lines"] (the array field itself, not one line's index). Confirmed
  // empirically (not from memory — the two disagree here): with `lines`
  // actually wired to per-item Controllers via `useFieldArray` (as below),
  // react-hook-form nests a whole-array resolver error under
  // `errors.lines.root.message`, not `errors.lines.message` — that flatter
  // shape only showed up in an isolated repro with no per-item registrations
  // at all, which doesn't match this form. Per-item errors (e.g.
  // `errors.lines[0].amount`) live in an ARRAY at the same key instead, which
  // has neither `.root` nor `.message` — both are `undefined` there, so this
  // never misreads one as the other.
  const linesError = form.formState.errors.lines as
    | { root?: { message?: string }; message?: string }
    | undefined;
  const linesMessage = linesError?.root?.message ?? linesError?.message;

  // FIN-2: the duplicate-component error is array-level, so react-hook-form
  // does not re-run it when a single line's Select changes or a line is
  // removed — the red banner then outlived the fix until the next submit.
  // Once the components are unique again, drop that message. The array-level
  // refine only runs after every per-line field parsed cleanly, so no
  // per-line error can be lost by clearing `lines` here.
  const lineComponentIds = lines?.map((l) => l.feeComponentId) ?? [];
  const linesAreUnique = new Set(lineComponentIds).size === lineComponentIds.length;
  const { clearErrors } = form;
  useEffect(() => {
    if (linesAreUnique && linesMessage === DUPLICATE_LINES_MESSAGE) clearErrors("lines");
  }, [linesAreUnique, linesMessage, clearErrors]);

  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [feeComponents, setFeeComponents] = useState<FeeComponent[]>([]);

  // Cheap arithmetic over a handful of rows — derive on every render rather
  // than memoising on a reference that can be stale.
  const markPaidValue = useWatch({ control: form.control, name: "markPaid" });
  const markPaid = canRecordPayment && markPaidValue === true;
  const total = (lines ?? []).reduce((sum, line) => {
    const amt = line?.amount;
    return typeof amt === "number" && amt > 0 ? sum + amt : sum;
  }, 0);

  // Fee components are still loaded once at dialog open — small list, no
  // pagination concern. Students moved to the on-demand StudentPicker.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    fetch("/api/fee-components")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const list: FeeComponent[] = Array.isArray(json) ? json : [];
        const active = list.filter((fc) => fc.isEnabled && fc.status === "ACTIVE");
        setFeeComponents(active);
        // Pre-fill the first line's component so single-click submit works.
        // Base UI Select shows the highlighted option in the trigger when value
        // is empty, but doesn't fire onValueChange until the user actually
        // clicks the row — that mismatch caused "Pilih komponen biaya" errors
        // for users who only opened the dropdown without clicking an option.
        const currentLines = form.getValues("lines");
        if (active.length > 0 && currentLines.length > 0 && !currentLines[0]?.feeComponentId) {
          form.setValue("lines.0.feeComponentId", active[0]!.id);
        }
      })
      .catch((err) => {
        console.error("[manual-invoice] fee components fetch failed", err);
        toast.error("Gagal memuat komponen biaya");
      });

    return () => {
      cancelled = true;
    };
  }, [open, form]);

  // Reset form whenever the dialog flips closed so the next open starts
  // fresh (avoids a stale student preselected from a previous create).
  useEffect(() => {
    if (!open) {
      form.reset(buildInitialForm());
      idempotencyKeyRef.current = null;
      setSelectedStudent(null);
    }
  }, [open, form]);

  const handleSubmit = form.handleSubmit(async (values) => {
    // Only a ticked box (and only for an admin who may record payments) sends
    // a payment; otherwise the body is exactly the pre-existing one.
    let payment: ReturnType<typeof paymentFromForm> = undefined;
    if (canRecordPayment && values.markPaid) {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      payment = paymentFromForm(values, idempotencyKeyRef.current);
    }
    try {
      const created = await sendJson<{
        id?: string;
        paid?: boolean;
        xenditPaymentUrl?: string | null;
        xenditError?: string;
      }>(
        "/api/invoices",
        {
          method: "POST",
          body: {
            studentId: values.studentId,
            periodLabel: values.periodLabel,
            dueDate: values.dueDate,
            lines: values.lines,
            ...(payment ? { payment } : {}),
          },
        },
        "Gagal membuat tagihan",
      );

      idempotencyKeyRef.current = null;
      onOpenChange(false);

      if (payment) {
        // Created paid: no payment link and no message to the wali.
        toast.success("Tagihan dibuat dan dicatat lunas");
      } else if (created?.xenditPaymentUrl) {
        const url = created.xenditPaymentUrl;
        toast.success("Tagihan dibuat", {
          action: {
            label: "Salin Link",
            onClick: () => {
              navigator.clipboard
                .writeText(url)
                .then(() => toast.success("Link disalin"))
                .catch(() => toast.error("Gagal menyalin link"));
            },
          },
        });
      } else if (created?.xenditError) {
        toast.warning("Tagihan dibuat tapi link gagal — coba retry dari list");
      } else {
        toast.success("Tagihan dibuat");
      }

      onCreated?.();
      if (created?.id) {
        router.push(`/admin/invoices/${created.id}`);
      }
    } catch (err) {
      if (payment && err instanceof ApiError && err.status === 403) {
        applyServerErrors(
          form,
          new ApiError(PAYMENT_FORBIDDEN_MESSAGE, { status: 403 }),
          "Gagal membuat tagihan",
        );
        return;
      }
      applyServerErrors(form, flattenPaymentFieldErrors(err), "Gagal membuat tagihan");
    }
  });

  function addLine() {
    append({ feeComponentId: feeComponents[0]?.id ?? "", amount: null });
  }

  const title = "Tagihan Manual";
  const description = "Buat satu tagihan untuk satu siswa dengan komponen biaya khusus.";

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="xl"
      footer={
        <FormDialogFooter
          formId={formId}
          pending={form.formState.isSubmitting}
          onCancel={() => onOpenChange(false)}
          submitLabel={markPaid ? "Simpan sebagai lunas" : "Buat Tagihan"}
          pendingLabel={markPaid ? "Menyimpan..." : "Membuat..."}
        />
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />

        <FormField
          control={form.control}
          name="studentId"
          label="Siswa"
          required
          id="manual-invoice-student"
          description="Hanya siswa aktif yang ditampilkan."
          render={({ field, controlProps }) => (
            <StudentPicker
              id="manual-invoice-student"
              aria-invalid={controlProps["aria-invalid"]}
              selected={selectedStudent}
              onSelect={(s) => {
                setSelectedStudent(s);
                field.onChange(s?.id ?? "");
              }}
            />
          )}
        />

        <FormField
          control={form.control}
          name="periodLabel"
          label="Periode"
          required
          id="manual-invoice-period"
          description="Contoh: April 2026. Untuk biaya sekali bayar, tulis nama biayanya, mis. Biaya Sekolah Tahap 1 TA 2027/2028."
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} placeholder="April 2026" maxLength={64} />
          )}
        />

        <FormField
          control={form.control}
          name="dueDate"
          label="Tanggal Jatuh Tempo"
          required
          id="manual-invoice-due-date"
          render={({ field, controlProps }) => (
            <DatePicker {...controlProps} value={field.value} onChange={field.onChange} required />
          )}
        />

        <Field aria-labelledby="manual-invoice-lines-label" data-invalid={linesMessage ? "true" : undefined}>
          <FieldLabel required id="manual-invoice-lines-label">Komponen Biaya</FieldLabel>
          <div className="flex flex-col gap-2 rounded-lg border-2 border-dashed border-muted-foreground/20 bg-muted/60 p-3">
            {fields.map((lineField, index) => (
              <div
                key={lineField.id}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 md:grid-cols-[minmax(0,1fr)_120px_auto]"
              >
                <FormField
                  control={form.control}
                  name={`lines.${index}.feeComponentId`}
                  label={`Komponen biaya ${index + 1}`}
                  required
                  id={`manual-invoice-component-${index}`}
                  className="col-span-2 min-w-0 md:col-span-1"
                  render={({ field, controlProps }) => (
                    <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                      <SelectTrigger
                        {...controlProps}
                        onBlur={field.onBlur}
                        className="w-full min-w-0 bg-background"
                      >
                        <SelectValue className="min-w-0 truncate" placeholder="Pilih komponen" />
                      </SelectTrigger>
                      <SelectContent>
                        {feeComponents.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">
                            Belum ada komponen aktif
                          </div>
                        ) : (
                          feeComponents.map((fc) => (
                            <SelectItem
                              key={fc.id}
                              value={fc.id}
                              className="[&>div]:min-w-0 [&>div]:shrink [&>div]:whitespace-normal [&>div]:wrap-break-word"
                            >
                              {fc.label}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`lines.${index}.amount`}
                  label={`Jumlah ${index + 1}`}
                  required
                  id={`manual-invoice-amount-${index}`}
                  className="min-w-0"
                  render={({ field, controlProps }) => (
                    <RupiahInput
                      {...controlProps}
                      value={(field.value as number | null | undefined) ?? null}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      className="w-full bg-background"
                    />
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  disabled={fields.length <= 1}
                  aria-label={`Hapus baris ${index + 1}`}
                >
                  <X size={14} />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addLine}
              className="self-start"
            >
              <Plus size={14} className="mr-1.5" /> Tambah Komponen
            </Button>
          </div>
          <FieldError>{linesMessage}</FieldError>
        </Field>

        <div className="flex items-center justify-between border-t-2 border-border pt-3 mt-3">
          <span className="text-sm font-semibold text-foreground">Total</span>
          <span className="font-currency text-base font-bold tabular-nums text-foreground">
            {formatRupiah(total)}
          </span>
        </div>

        {canRecordPayment && (
          <>
            <FormField
              control={form.control}
              name="markPaid"
              orientation="horizontal"
              label="Sudah dibayar"
              id="manual-invoice-mark-paid"
              description="Tagihan langsung Lunas. Tidak ada link pembayaran dan tidak ada email ke wali."
              render={({ field, controlProps }) => (
                <Checkbox
                  {...controlProps}
                  checked={field.value === true}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  onBlur={field.onBlur}
                />
              )}
            />

            {markPaid && (
              <div className="space-y-field rounded-lg border border-border bg-muted/40 p-3">
                <FormField
                  control={form.control}
                  name="method"
                  label="Metode"
                  required
                  id="manual-invoice-method"
                  render={({ field, controlProps }) => (
                    <Select value={field.value ?? ""} onValueChange={(v) => v != null && field.onChange(v)}>
                      <SelectTrigger {...controlProps} onBlur={field.onBlur} className="w-full bg-background">
                        <SelectValue placeholder="Pilih metode" />
                      </SelectTrigger>
                      <SelectContent>
                        {MANUAL_PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {paymentMethodLabel(m)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />

                <FormField
                  control={form.control}
                  name="paidAt"
                  label="Tanggal bayar"
                  required
                  id="manual-invoice-paid-at"
                  description="Isi tanggal uangnya diterima jika sudah masuk sebelum hari ini."
                  render={({ field, controlProps }) => (
                    <DatePicker
                      {...controlProps}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      max={getTodayInTimezone("Asia/Jakarta")}
                      required
                    />
                  )}
                />

                <FormField
                  control={form.control}
                  name="reference"
                  label="Referensi"
                  id="manual-invoice-reference"
                  description="Nomor transfer, ID transaksi, dll."
                  render={({ field, controlProps }) => (
                    <Input {...field} {...controlProps} value={field.value ?? ""} placeholder="Opsional" maxLength={200} />
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  label="Catatan"
                  id="manual-invoice-notes"
                  render={({ field, controlProps }) => (
                    <Input {...field} {...controlProps} value={field.value ?? ""} placeholder="Opsional" maxLength={2000} />
                  )}
                />

                <p className="text-sm text-muted-foreground">
                  Jumlah dibayar:{" "}
                  <span className="font-currency font-semibold tabular-nums text-foreground">
                    {formatRupiah(total)}
                  </span>
                  , sama dengan total tagihan.
                </p>
              </div>
            )}
          </>
        )}
      </form>
    </ResponsiveFormDialog>
  );
}
