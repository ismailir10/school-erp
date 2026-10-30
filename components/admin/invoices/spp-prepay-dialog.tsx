"use client";

import { MESSAGES } from "@/lib/feedback";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useFieldArray, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { CircleAlert, ExternalLink, Plus, TriangleAlert, X } from "lucide-react";

import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { RupiahInput } from "@/components/ui/rupiah-input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { StudentPicker, type Student } from "@/components/admin/student-picker";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import { parsePeriodMonth } from "@/lib/finance/period-label";
import { formatDateTime, formatMonthLabel, formatRupiah } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { invoiceStatusLabel } from "@/lib/constants/invoice-status";
import {
  OTHER_FEES_MAX_LINES,
  OTHER_FEES_MONTH_LABEL_MESSAGE,
  SPP_PREPAY_METHODS,
  SPP_PREPAY_RANGE_ORDER_MESSAGE,
  sppPrepayFormSchema,
  sppPrepayPartsFromForm,
  type SppPrepayFormInput,
} from "@/lib/validations/spp-prepay";

// ------------------------------------------------------------------
// Types (the preview route's response, see app/api/invoices/spp-prepay/preview)
// ------------------------------------------------------------------

type PlanAction = "CREATE" | "SETTLE" | "SKIP_PAID";

type PreviewRow = {
  year: number;
  month: number;
  periodLabel: string;
  dueDate: string;
  action: PlanAction;
  amount: number;
  invoiceIds: string[];
  hadLink: boolean;
  linkExpiresAt: string | null;
  beforeFirstBilling: boolean;
};

/** The one invoice a caution points at (PlanInvoiceRef from lib/finance/spp-prepay-plan.ts). */
type PreviewInvoiceRef = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  status: string;
  totalDue: number;
  monthlyAmount: number;
};

type PreviewIssue = {
  code: string;
  blocking: boolean;
  message: string;
  year?: number;
  month?: number;
  invoiceId?: string;
  invoice?: PreviewInvoiceRef;
};

type OneTimeComponent = { id: string; label: string; sortOrder: number; prefillAmount: number | null };

type SppAvailability = {
  available: boolean;
  reason: { code: string; message: string } | null;
  defaultRange: { from: string; to: string } | null;
};

type PreviewOtherFees = {
  label: string;
  lines: { feeComponentId: string; label: string; amount: number }[];
  total: number;
};

type Preview = {
  student: { id: string; name: string };
  academicYear: { id: string; name: string; from: string; to: string } | null;
  range: { from: string; to: string } | null;
  program: string | null;
  spp: SppAvailability;
  oneTimeComponents: OneTimeComponent[];
  rows: PreviewRow[];
  sppTotal: number;
  otherFees: PreviewOtherFees | null;
  /** Grand total: SPP rows + the one-time invoice. */
  total: number;
  issues: PreviewIssue[];
  blocked: boolean;
  fingerprint: string;
};

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: Preview }
  | { status: "error"; message: string }
  // The server refused the parts and the messages sit on the form fields.
  | { status: "fieldErrors" };

/** The `from` / `to` / `otherFees` a preview or confirm request carries. */
type Parts = ReturnType<typeof sppPrepayPartsFromForm>;

type ConfirmResponse = {
  replayed: boolean;
  created?: number;
  settled?: number;
  skipped?: number;
  total?: number;
  otherFees?: { invoiceId: string; invoiceNumber: string; total: number } | null;
};

// ------------------------------------------------------------------
// Copy + helpers
// ------------------------------------------------------------------

const ACTION_LABELS: Record<PlanAction, string> = {
  CREATE: "Buat & lunasi",
  SETTLE: "Lunasi tagihan yang ada",
  SKIP_PAID: "Sudah lunas, dilewati",
};

const METHOD_LABELS: Record<(typeof SPP_PREPAY_METHODS)[number], string> = {
  CASH: "Tunai",
  BANK_TRANSFER: "Transfer Bank",
  OTHER: "Lainnya",
};

const NOTHING_CHOSEN_HINT = "Pilih bulan SPP atau tambahkan biaya lainnya.";
const OTHER_FEES_INCOMPLETE_HINT =
  "Lengkapi komponen, jumlah, dan Periode pada biaya lainnya untuk melihat rincian.";
const PREVIEW_FIELD_ERRORS_HINT = "Periksa isian yang ditandai.";
const LABEL_HELPER =
  'Beri nama biayanya, mis. "Biaya Sekolah Tahap 1 TA 2027/2028". Jangan hanya nama bulan.';

/** Typing in the one-time part waits this long before asking the server again. */
const PREVIEW_DEBOUNCE_MS = 350;

const partsKey = (parts: Parts) => JSON.stringify(parts);

function buildInitialForm() {
  return {
    studentId: "",
    withSpp: true,
    from: "",
    to: "",
    otherFees: { label: "", lines: [] as { feeComponentId: string; amount: number | null }[] },
    method: "CASH" as (typeof SPP_PREPAY_METHODS)[number],
    paidAt: getTodayInTimezone("Asia/Jakarta"),
    reference: "",
    notes: "",
  };
}

function hasPath(values: unknown, path: string): boolean {
  let cursor: unknown = values;
  for (const key of path.split(".")) {
    if (cursor === null || typeof cursor !== "object" || !(key in cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return true;
}

/** Every "YYYY-MM" from `from` to `to`, inclusive, with its Indonesian label. */
function monthOptions(from: string, to: string): { value: string; label: string }[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return [];
  const out: { value: string; label: string }[] = [];
  let y = fy;
  let m = fm;
  // A school year is 12 months; the cap only guards against a malformed response.
  while ((y < ty || (y === ty && m <= tm)) && out.length < 36) {
    out.push({ value: `${y}-${String(m).padStart(2, "0")}`, label: formatMonthLabel(y, m) });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Under a caution that points at one invoice: what it is, and a way to open it without leaving the dialog. */
function IssueInvoice({ invoice }: { invoice: PreviewInvoiceRef }) {
  return (
    <div className="mt-1 flex flex-col items-start gap-x-3 gap-y-0.5 sm:flex-row sm:flex-wrap sm:items-center">
      <p className="text-small text-muted-foreground">
        {invoice.invoiceNumber} · {invoice.periodLabel} · {invoiceStatusLabel(invoice.status)} ·{" "}
        {formatRupiah(invoice.totalDue)}
        {invoice.monthlyAmount > 0 ? ` (SPP di dalamnya ${formatRupiah(invoice.monthlyAmount)})` : ""}
      </p>
      <Link
        href={`/admin/invoices/${invoice.id}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Buka tagihan ${invoice.invoiceNumber} di tab baru`}
        className="inline-flex items-center gap-1 text-small text-primary-text underline underline-offset-3 hover:no-underline [@media(pointer:coarse)]:min-h-11"
      >
        Buka tagihan
        <ExternalLink aria-hidden="true" className="size-3.5" />
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------
// Dialog
// ------------------------------------------------------------------

type SppPrepayDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful record so the list can refresh. */
  onRecorded?: () => void;
};

export function SppPrepayDialog({ open, onOpenChange, onRecorded }: SppPrepayDialogProps) {
  const formId = useId();
  const sppRadioTextId = useId();
  const noSppRadioTextId = useId();
  const sppReasonId = useId();
  const form = useZodForm(sppPrepayFormSchema, { defaultValues: buildInitialForm() });
  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: "otherFees.lines" });
  // `useWatch` hands back fresh values on every change (see manual-invoice-dialog.tsx).
  const watched = useWatch({ control: form.control });
  const studentId = watched.studentId ?? "";
  const withSpp = watched.withSpp ?? true;
  const from = watched.from ?? "";
  const to = watched.to ?? "";
  const otherFeesValue = watched.otherFees;
  const lines = otherFeesValue?.lines ?? [];

  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  // What the last good preview named. They bound the selects and the line editor and
  // stay put while the next preview loads.
  const [academicYear, setAcademicYear] = useState<Preview["academicYear"]>(null);
  const [spp, setSpp] = useState<SppAvailability | null>(null);
  const [components, setComponents] = useState<OneTimeComponent[]>([]);
  // The student whose first (no-parts) preview has landed: until then the sections stay disabled.
  const [loadedStudentId, setLoadedStudentId] = useState<string | null>(null);
  // The parts the shown preview was computed for. The confirm sends exactly these.
  const [previewParts, setPreviewParts] = useState<Parts>({});

  // Out-of-order guard: only the latest preview request may write state.
  const previewSeq = useRef(0);
  // The key of the parts last asked for, so the form-driven effect asks only when something changed.
  const requestedKey = useRef(partsKey({}));
  // One key per dialog open, so a double click or retry replays instead of duplicating.
  // Renewed when the dialog closes and after a success.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const currentParts = sppPrepayPartsFromForm({
    withSpp,
    from,
    to,
    otherFees: {
      label: otherFeesValue?.label ?? "",
      lines: lines.map((l) => ({ feeComponentId: l?.feeComponentId ?? "", amount: l?.amount ?? null })),
    },
  });
  const currentKey = partsKey(currentParts);
  // The server refuses a one-time label that names one month (it would hide that month's SPP in the Billing Run).
  // Say so on the field straight away instead of sending a preview that is bound to fail.
  const otherLabelTrimmed = (otherFeesValue?.label ?? "").trim();
  const labelIsMonth = lines.length > 0 && otherLabelTrimmed !== "" && parsePeriodMonth(otherLabelTrimmed) !== null;
  const previewBlockedByLabel = labelIsMonth && !!currentParts.otherFees;
  const rangeInverted = withSpp && !!from && !!to && from > to;

  /**
   * Ask the server for a preview. `initial` is the first look at a student: it asks
   * with no parts (to learn the components and whether SPP is available), then fills
   * the form's defaults (the academic-year range, or "Tanpa SPP") and asks again for them.
   */
  async function runPreview(forStudentId: string, parts: Parts, initial = false) {
    const seq = ++previewSeq.current;
    setPreview({ status: "loading" });
    const post = (body: Parts) =>
      sendJson<Preview>(
        "/api/invoices/spp-prepay/preview",
        { method: "POST", body: { studentId: forStudentId, ...body } },
        MESSAGES.loadFailed("Pratinjau pembayaran"),
      );
    const remember = (data: Preview) => {
      setAcademicYear(data.academicYear ?? null);
      setSpp(data.spp ?? null);
      setComponents(data.oneTimeComponents ?? []);
    };
    try {
      let effective = parts;
      requestedKey.current = partsKey(parts);
      let data = await post(parts);
      if (seq !== previewSeq.current) return;
      remember(data);
      if (initial) {
        const range = data.spp?.available ? data.spp.defaultRange : null;
        form.setValue("withSpp", !!range);
        form.setValue("from", range?.from ?? "");
        form.setValue("to", range?.to ?? "");
        effective = sppPrepayPartsFromForm(form.getValues());
        requestedKey.current = partsKey(effective);
        if (range) {
          data = await post(effective);
          if (seq !== previewSeq.current) return;
          remember(data);
        }
        setLoadedStudentId(forStudentId);
      }
      setPreviewParts(effective);
      setPreview({ status: "ready", data });
    } catch (err) {
      if (seq !== previewSeq.current) return;
      if (err instanceof ApiError && err.status === 400 && applyPreviewFieldErrors(err)) {
        setPreview({ status: "fieldErrors" });
        return;
      }
      setPreview({ status: "error", message: userMessage(err, MESSAGES.loadFailed("Pratinjau pembayaran")) });
    }
  }

  /** Put a 400's field errors on the matching form fields (no toast: the preview is not a submit). True when any landed. */
  function applyPreviewFieldErrors(err: ApiError): boolean {
    const values = form.getValues();
    let mapped = 0;
    for (const { field: rawField, message } of err.fieldErrors) {
      const field = rawField.replace(/\[(\d+)\]/g, ".$1");
      if (!field || !hasPath(values, field)) continue;
      form.setError(field as Parameters<typeof form.setError>[0], { type: "server", message });
      mapped++;
    }
    return mapped > 0;
  }

  function clearPreview() {
    previewSeq.current += 1;
    setPreview({ status: "idle" });
  }

  function handleStudentSelect(student: Student | null, onChange: (v: string) => void) {
    setSelectedStudent(student);
    onChange(student?.id ?? "");
    form.setValue("withSpp", true);
    form.setValue("from", "");
    form.setValue("to", "");
    form.setValue("otherFees.label", "");
    replace([]);
    form.clearErrors(["from", "to", "otherFees"]);
    setAcademicYear(null);
    setSpp(null);
    setComponents([]);
    setLoadedStudentId(null);
    setPreviewParts({});
    if (!student) {
      clearPreview();
      return;
    }
    void runPreview(student.id, {}, true);
  }

  function handleSppChoice(value: string) {
    const chosen = value === "spp";
    form.setValue("withSpp", chosen);
    if (!chosen) form.clearErrors(["from", "to"]);
  }

  function handleRangeChange(which: "from" | "to", value: string, onChange: (v: string) => void) {
    onChange(value);
    const nextFrom = which === "from" ? value : form.getValues("from");
    const nextTo = which === "to" ? value : form.getValues("to");
    if (nextFrom && nextTo && nextFrom > nextTo) {
      // Never ask the server for an inverted range; say so on the field instead.
      form.setError("to", { type: "validate", message: SPP_PREPAY_RANGE_ORDER_MESSAGE });
      return;
    }
    form.clearErrors(["from", "to"]);
  }

  function handleComponentPick(index: number, id: string, onChange: (v: string) => void) {
    onChange(id);
    const picked = components.find((c) => c.id === id);
    // The amount follows the component's fee-table price (an ordinary value, editable); none = empty.
    form.setValue(`otherFees.lines.${index}.amount`, picked?.prefillAmount ?? null);
    form.clearErrors(`otherFees.lines.${index}`);
    form.clearErrors("otherFees.lines");
  }

  // Anything the admin changes after the first look (range, lines, label) re-asks the server
  // once they stop typing. Selecting a student runs its own first look (`runPreview(..., true)`).
  useEffect(() => {
    if (!open || !studentId || loadedStudentId !== studentId || rangeInverted) return;
    if (currentKey === requestedKey.current || previewBlockedByLabel) return;
    const timer = setTimeout(() => void runPreview(studentId, JSON.parse(currentKey) as Parts), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `runPreview` only reads refs and stable setters; the key already carries the parts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, studentId, loadedStudentId, rangeInverted, currentKey, previewBlockedByLabel]);

  // Mirror the server's label rule on the Periode field as the admin types; drop the message once the label is fine.
  useEffect(() => {
    if (labelIsMonth) {
      form.setError("otherFees.label", { type: "validate", message: OTHER_FEES_MONTH_LABEL_MESSAGE });
      return;
    }
    const current = form.formState.errors.otherFees?.label;
    if (current && (current.type === "validate" || current.type === "server")) {
      form.clearErrors("otherFees.label");
    }
    // `form` is stable; the label is the only input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelIsMonth, otherLabelTrimmed]);

  // Reset whenever the dialog flips closed so the next open starts fresh and
  // gets a new idempotency key.
  useEffect(() => {
    if (!open) {
      previewSeq.current += 1;
      requestedKey.current = partsKey({});
      form.reset(buildInitialForm());
      setIdempotencyKey(crypto.randomUUID());
      setSelectedStudent(null);
      setPreview({ status: "idle" });
      setAcademicYear(null);
      setSpp(null);
      setComponents([]);
      setLoadedStudentId(null);
      setPreviewParts({});
    }
  }, [open, form]);

  const ready = loadedStudentId !== null && loadedStudentId === studentId;
  const loading = preview.status === "loading";
  const shown = preview.status === "ready" && !rangeInverted ? preview.data : null;
  // The shown numbers belong to other parts than the form now holds (still typing, or a request in flight).
  const stale = !!shown && partsKey(previewParts) !== currentKey;
  const blockingIssues = shown?.issues.filter((i) => i.blocking) ?? [];
  const warningIssues = shown?.issues.filter((i) => !i.blocking) ?? [];
  const isBlocked = !!shown && (shown.blocked || blockingIssues.length > 0);
  const canConfirm = !!shown && !stale && !isBlocked && shown.total > 0;

  const nothingChosen = !withSpp && lines.length === 0;
  const otherFeesIncomplete = lines.length > 0 && !previewParts.otherFees && !previewParts.from;
  const sppRows = shown?.rows ?? [];
  const otherInvoice = shown?.otherFees ?? null;

  const linkRows = sppRows.filter((r) => r.action === "SETTLE" && r.hadLink);
  const latestLinkExpiry = linkRows
    .map((r) => r.linkExpiresAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);

  const months = academicYear && spp?.available ? monthOptions(academicYear.from, academicYear.to) : [];
  const today = getTodayInTimezone("Asia/Jakarta");
  const sppUnavailable = ready && spp !== null && !spp.available;

  const usedComponentIds = new Set(lines.map((l) => l?.feeComponentId).filter(Boolean));
  const canAddLine =
    ready &&
    lines.length < OTHER_FEES_MAX_LINES &&
    components.some((c) => !usedComponentIds.has(c.id));

  // Array-level errors (duplicate component, too many lines) sit under the editor. React Hook Form nests a
  // whole-array resolver error under `.root` when per-line controllers are registered (see manual-invoice-dialog.tsx).
  const linesError = form.formState.errors.otherFees?.lines as
    | { root?: { message?: string }; message?: string }
    | undefined;
  const linesMessage = linesError?.root?.message ?? linesError?.message;

  async function submit(values: SppPrepayFormInput) {
    if (!shown || !canConfirm) return;
    try {
      const res = await sendJson<ConfirmResponse>(
        "/api/invoices/spp-prepay",
        {
          method: "POST",
          body: {
            studentId: values.studentId,
            // Exactly what the latest preview was computed for: the server checks the fingerprint against these.
            ...previewParts,
            method: values.method,
            paidAt: values.paidAt,
            ...(values.reference ? { reference: values.reference } : {}),
            ...(values.notes ? { notes: values.notes } : {}),
            idempotencyKey,
            fingerprint: shown.fingerprint,
          },
        },
        "Gagal mencatat pembayaran di muka",
      );

      setIdempotencyKey(crypto.randomUUID());
      onOpenChange(false);
      if (res?.replayed) {
        toast.success("Pembayaran di muka ini sudah tercatat sebelumnya");
      } else {
        const recorded: string[] = [];
        if (previewParts.from) {
          recorded.push(`SPP ${res?.created ?? 0} tagihan dibuat, ${res?.settled ?? 0} dilunasi`);
        }
        if (previewParts.otherFees) {
          recorded.push(
            res?.otherFees
              ? `biaya lainnya tagihan ${res.otherFees.invoiceNumber} lunas`
              : "biaya lainnya 1 tagihan lunas",
          );
        }
        toast.success(`Pembayaran di muka tercatat: ${recorded.join("; ")}`);
      }
      onRecorded?.();
    } catch (err) {
      applyServerErrors(form, err, "Gagal mencatat pembayaran di muka");
      // 409 = the numbers moved under us (PREVIEW_STALE) or there is nothing left to
      // record: show the fresh preview so the admin confirms what is true now. The
      // idempotency key is kept; the server writes nothing on a refused request.
      if (err instanceof ApiError && err.status === 409) {
        void runPreview(values.studentId, previewParts);
      }
    }
  }

  const submitLabel = canConfirm ? `Catat ${formatRupiah(shown.total)} lunas` : "Catat lunas";

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Catat Pembayaran di Muka"
      description="Catat pembayaran yang sudah diterima: SPP beberapa bulan dan biaya sekolah lainnya. Tagihan langsung Lunas, tanpa link pembayaran dan tanpa email."
      size="xl"
      footer={
        <FormDialogFooter
          formId={formId}
          pending={form.formState.isSubmitting}
          disabled={!canConfirm || loading}
          onCancel={() => onOpenChange(false)}
          submitLabel={submitLabel}
          pendingLabel="Mencatat..."
        />
      }
    >
      <form id={formId} onSubmit={(e) => void form.handleSubmit(submit)(e)} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />

        <FormField
          control={form.control}
          name="studentId"
          label="Siswa"
          required
          id="spp-prepay-student"
          description="Hanya siswa aktif yang ditampilkan."
          render={({ field, controlProps }) => (
            <StudentPicker
              id="spp-prepay-student"
              aria-invalid={controlProps["aria-invalid"]}
              selected={selectedStudent}
              onSelect={(s) => handleStudentSelect(s, field.onChange)}
            />
          )}
        />

        {/* SPP part: a month range, or none. */}
        <FieldSet className="gap-2">
          <FieldLegend variant="label">SPP</FieldLegend>
          <RadioGroup
            value={withSpp ? "spp" : "none"}
            onValueChange={(v) => handleSppChoice(String(v))}
            aria-label="SPP"
            className="gap-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem
                value="spp"
                id="spp-prepay-with-spp"
                aria-labelledby={sppRadioTextId}
                aria-describedby={sppUnavailable ? sppReasonId : undefined}
                disabled={!ready || !spp?.available}
              />
              <FieldLabel htmlFor="spp-prepay-with-spp" id={sppRadioTextId} className="font-normal">
                Catat SPP beberapa bulan
              </FieldLabel>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem
                value="none"
                id="spp-prepay-no-spp"
                aria-labelledby={noSppRadioTextId}
                disabled={!ready}
              />
              <FieldLabel htmlFor="spp-prepay-no-spp" id={noSppRadioTextId} className="font-normal">
                Tanpa SPP
              </FieldLabel>
            </div>
          </RadioGroup>

          {sppUnavailable && spp?.reason && (
            <p id={sppReasonId} className="text-sm text-muted-foreground">
              {spp.reason.message}
              {spp.reason.code === "NO_PROGRAM" && (
                <>
                  {" "}
                  Atur kelasnya di{" "}
                  <Link href="/admin/students" className="underline underline-offset-3">
                    halaman Siswa
                  </Link>
                  .
                </>
              )}
            </p>
          )}

          {withSpp && (
            <div className="grid grid-cols-1 gap-field sm:grid-cols-2">
              <FormField
                control={form.control}
                name="from"
                label="Dari bulan"
                required={withSpp}
                id="spp-prepay-from"
                render={({ field, controlProps }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => v != null && handleRangeChange("from", v as string, field.onChange)}
                    disabled={!withSpp || months.length === 0}
                  >
                    <SelectTrigger {...controlProps} onBlur={field.onBlur} className="w-full min-w-0 bg-background">
                      <SelectValue className="min-w-0 truncate" placeholder="Pilih siswa dulu" />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FormField
                control={form.control}
                name="to"
                label="Sampai bulan"
                required={withSpp}
                id="spp-prepay-to"
                render={({ field, controlProps }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => v != null && handleRangeChange("to", v as string, field.onChange)}
                    disabled={!withSpp || months.length === 0}
                  >
                    <SelectTrigger {...controlProps} onBlur={field.onBlur} className="w-full min-w-0 bg-background">
                      <SelectValue className="min-w-0 truncate" placeholder="Pilih siswa dulu" />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          )}
        </FieldSet>

        {/* One-time part: uang pangkal, sarana, seragam, "biaya sekolah tahap 1", ... */}
        <FieldSet className="gap-2">
          <FieldLegend variant="label">Biaya lainnya</FieldLegend>
          <FieldDescription>
            Uang pangkal, sarana, seragam, dan biaya sekali bayar lainnya. Jumlah terisi dari tarif program dan bisa
            diubah.
          </FieldDescription>
          <div className="flex flex-col gap-2 rounded-lg border-2 border-dashed border-muted-foreground/20 bg-muted/60 p-3">
            {fields.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {ready && components.length === 0
                  ? "Belum ada komponen biaya sekali bayar yang aktif."
                  : "Belum ada biaya lainnya."}
              </p>
            )}
            {fields.map((lineField, index) => {
              const ownId = lines[index]?.feeComponentId ?? "";
              const options = components.filter((c) => c.id === ownId || !usedComponentIds.has(c.id));
              return (
                <div
                  key={lineField.id}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 md:grid-cols-[minmax(0,1fr)_160px_auto]"
                >
                  <FormField
                    control={form.control}
                    name={`otherFees.lines.${index}.feeComponentId`}
                    label={`Komponen biaya ${index + 1}`}
                    required
                    id={`spp-prepay-component-${index}`}
                    className="col-span-2 min-w-0 md:col-span-1"
                    render={({ field, controlProps }) => (
                      <Select
                        value={field.value}
                        onValueChange={(v) => v != null && handleComponentPick(index, v as string, field.onChange)}
                      >
                        <SelectTrigger {...controlProps} onBlur={field.onBlur} className="w-full min-w-0 bg-background">
                          <SelectValue className="min-w-0 truncate" placeholder="Pilih komponen" />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((c) => (
                            <SelectItem
                              key={c.id}
                              value={c.id}
                              className="[&>div]:min-w-0 [&>div]:shrink [&>div]:whitespace-normal [&>div]:wrap-break-word"
                            >
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`otherFees.lines.${index}.amount`}
                    label={`Jumlah ${index + 1}`}
                    required
                    id={`spp-prepay-amount-${index}`}
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
                    aria-label={`Hapus biaya ${index + 1}`}
                  >
                    <X size={14} />
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              disabled={!canAddLine}
              onClick={() => append({ feeComponentId: "", amount: null })}
            >
              <Plus size={14} className="mr-1.5" /> Tambah biaya
            </Button>
          </div>
          {linesMessage && <FieldError>{linesMessage}</FieldError>}

          {lines.length > 0 && (
            <FormField
              control={form.control}
              name="otherFees.label"
              label="Periode"
              required
              id="spp-prepay-label"
              description={LABEL_HELPER}
              render={({ field, controlProps }) => (
                <Input
                  {...field}
                  {...controlProps}
                  placeholder="Biaya Sekolah Tahap 1 TA 2027/2028"
                  maxLength={64}
                />
              )}
            />
          )}
        </FieldSet>

        <div className="grid grid-cols-1 gap-field sm:grid-cols-2">
          <FormField
            control={form.control}
            name="method"
            label="Metode"
            required
            id="spp-prepay-method"
            render={({ field, controlProps }) => (
              <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                <SelectTrigger {...controlProps} onBlur={field.onBlur} className="w-full min-w-0 bg-background">
                  <SelectValue className="min-w-0 truncate" placeholder="Pilih metode" />
                </SelectTrigger>
                <SelectContent>
                  {SPP_PREPAY_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHOD_LABELS[m]}
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
            id="spp-prepay-paid-at"
            render={({ field, controlProps }) => (
              <DatePicker
                {...controlProps}
                value={field.value}
                onChange={field.onChange}
                max={today}
                required
              />
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-field sm:grid-cols-2">
          <FormField
            control={form.control}
            name="reference"
            label="Referensi"
            id="spp-prepay-reference"
            description="Opsional, mis. nomor kuitansi."
            render={({ field, controlProps }) => (
              <Input
                {...field}
                {...controlProps}
                value={field.value ?? ""}
                maxLength={64}
              />
            )}
          />
          <FormField
            control={form.control}
            name="notes"
            label="Catatan"
            id="spp-prepay-notes"
            description="Opsional."
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value={field.value ?? ""} />
            )}
          />
        </div>

        {/* Step 2: the preview. Polite live region so a screen reader hears it settle. */}
        <section
          aria-label="Pratinjau pembayaran"
          aria-live="polite"
          aria-busy={loading || stale}
          className="space-y-3 border-t-2 border-border pt-4"
        >
          {preview.status === "idle" && (
            <p className="text-sm text-muted-foreground">
              Pilih siswa untuk melihat rincian pembayaran sebelum dicatat.
            </p>
          )}

          {loading && (
            <div className="space-y-2" data-testid="spp-prepay-loading">
              <span className="sr-only">Memuat pratinjau pembayaran...</span>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}

          {preview.status === "fieldErrors" && (
            <p className="text-sm text-muted-foreground">{PREVIEW_FIELD_ERRORS_HINT}</p>
          )}

          {preview.status === "error" && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>Pratinjau belum dapat dimuat</AlertTitle>
              <AlertDescription>
                <p>{preview.message}</p>
                {studentId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => void runPreview(studentId, currentParts, !ready)}
                  >
                    Muat ulang pratinjau
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {shown && (
            <>
              {blockingIssues.length > 0 && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertTitle>Belum bisa dicatat</AlertTitle>
                  <AlertDescription>
                    {blockingIssues.map((issue, i) => (
                      <p key={`${issue.code}-${i}`}>{issue.message}</p>
                    ))}
                  </AlertDescription>
                </Alert>
              )}

              {(sppRows.length > 0 || otherInvoice) && (
                <Table>
                  <TableCaption className="sr-only">
                    Rincian pembayaran di muka {shown.student.name}
                    {previewParts.from ? `, SPP ${previewParts.from} sampai ${previewParts.to}` : ""}
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tagihan</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                      <TableHead>Tindakan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sppRows.map((row) => (
                      <TableRow key={`${row.year}-${row.month}`}>
                        <TableCell className="whitespace-normal">
                          <span>{row.periodLabel}</span>
                          {row.beforeFirstBilling && (
                            <p className="text-xs text-muted-foreground">
                              Belum pernah ditagih di sistem ini
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-currency tabular-nums">
                          {row.action === "SKIP_PAID" ? "—" : formatRupiah(row.amount)}
                        </TableCell>
                        <TableCell
                          className={
                            row.action === "SKIP_PAID" ? "whitespace-nowrap text-muted-foreground" : "whitespace-nowrap"
                          }
                        >
                          {ACTION_LABELS[row.action]}
                        </TableCell>
                      </TableRow>
                    ))}
                    {otherInvoice && (
                      <TableRow>
                        <TableCell className="whitespace-normal">
                          <span className="font-medium">{otherInvoice.label}</span>
                          <p className="text-xs text-muted-foreground">
                            {otherInvoice.lines.map((l, i) => (
                              <span key={l.feeComponentId}>
                                {i > 0 && " · "}
                                <span className="whitespace-nowrap">
                                  {l.label} {formatRupiah(l.amount)}
                                </span>
                              </span>
                            ))}
                          </p>
                        </TableCell>
                        <TableCell className="text-right font-currency tabular-nums">
                          {formatRupiah(otherInvoice.total)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{ACTION_LABELS.CREATE}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="text-right font-currency font-bold tabular-nums">
                        {formatRupiah(shown.total)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              )}

              {warningIssues.length > 0 && (
                <Alert role="status">
                  <TriangleAlert aria-hidden="true" className="text-warning" />
                  <AlertTitle>Perlu diperiksa</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {warningIssues.map((issue, i) => (
                        <li key={`${issue.code}-${i}`}>
                          {issue.message}
                          {issue.invoice && <IssueInvoice invoice={issue.invoice} />}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {linkRows.length > 0 && (
                <Alert role="status">
                  <TriangleAlert aria-hidden="true" className="text-warning" />
                  <AlertTitle>Link pembayaran lama dihapus</AlertTitle>
                  <AlertDescription>
                    <p>
                      {linkRows.length} tagihan yang dilunasi masih punya link pembayaran lama
                      {latestLinkExpiry
                        ? `, aktif sampai ${formatDateTime(latestLinkExpiry)} WIB`
                        : ""}
                      . Minta wali tidak membayar VA dari email.
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              {nothingChosen && <p className="text-sm text-muted-foreground">{NOTHING_CHOSEN_HINT}</p>}

              {!nothingChosen && otherFeesIncomplete && (
                <p className="text-sm text-muted-foreground">{OTHER_FEES_INCOMPLETE_HINT}</p>
              )}

              {!isBlocked && shown.total <= 0 && !nothingChosen && !otherFeesIncomplete && (
                <p className="text-sm text-muted-foreground">
                  Semua bulan dalam rentang ini sudah lunas, jadi tidak ada yang perlu dicatat. Ubah
                  rentang bulan jika perlu.
                </p>
              )}
            </>
          )}
        </section>
      </form>
    </ResponsiveFormDialog>
  );
}
