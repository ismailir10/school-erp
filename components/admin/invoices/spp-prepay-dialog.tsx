"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CircleAlert, TriangleAlert } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { StudentPicker, type Student } from "@/components/admin/student-picker";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import { formatDateTime, formatMonthLabel, formatRupiah } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import {
  SPP_PREPAY_METHODS,
  SPP_PREPAY_RANGE_ORDER_MESSAGE,
  sppPrepayFormSchema,
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

type PreviewIssue = {
  code: string;
  blocking: boolean;
  message: string;
  year?: number;
  month?: number;
  invoiceId?: string;
};

type Preview = {
  student: { id: string; name: string };
  academicYear: { id: string; name: string; from: string; to: string };
  range: { from: string; to: string };
  program: string | null;
  rows: PreviewRow[];
  total: number;
  issues: PreviewIssue[];
  blocked: boolean;
  fingerprint: string;
};

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: Preview }
  | { status: "error"; message: string };

type ConfirmResponse = {
  replayed: boolean;
  created?: number;
  settled?: number;
  skipped?: number;
  total?: number;
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

function buildInitialForm() {
  return {
    studentId: "",
    from: "",
    to: "",
    method: "CASH" as (typeof SPP_PREPAY_METHODS)[number],
    paidAt: getTodayInTimezone("Asia/Jakarta"),
    reference: "",
    notes: "",
  };
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
  const form = useZodForm(sppPrepayFormSchema, { defaultValues: buildInitialForm() });

  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  // The academic year the last good preview named; it bounds the month selects
  // and stays put while the next preview loads.
  const [academicYear, setAcademicYear] = useState<Preview["academicYear"] | null>(null);

  // Out-of-order guard: only the latest preview request may write state.
  const previewSeq = useRef(0);
  // One key per dialog open, so a double click or retry replays instead of duplicating.
  // Renewed when the dialog closes and after a success.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function runPreview(studentId: string, from?: string, to?: string) {
    const seq = ++previewSeq.current;
    setPreview({ status: "loading" });
    try {
      const data = await sendJson<Preview>(
        "/api/invoices/spp-prepay/preview",
        { method: "POST", body: { studentId, ...(from && to ? { from, to } : {}) } },
        "Gagal memuat pratinjau SPP",
      );
      if (seq !== previewSeq.current) return;
      setPreview({ status: "ready", data });
      setAcademicYear(data.academicYear ?? null);
      if (!from || !to) {
        // First look at a student: the default range is the whole academic year.
        const range = data.range ?? data.academicYear;
        if (range?.from && range?.to) {
          form.setValue("from", range.from);
          form.setValue("to", range.to);
        }
      }
    } catch (err) {
      if (seq !== previewSeq.current) return;
      setPreview({ status: "error", message: userMessage(err, "Gagal memuat pratinjau SPP") });
    }
  }

  function clearPreview() {
    previewSeq.current += 1;
    setPreview({ status: "idle" });
  }

  function handleStudentSelect(student: Student | null, onChange: (v: string) => void) {
    setSelectedStudent(student);
    onChange(student?.id ?? "");
    form.setValue("from", "");
    form.setValue("to", "");
    form.clearErrors(["from", "to"]);
    setAcademicYear(null);
    if (!student) {
      clearPreview();
      return;
    }
    void runPreview(student.id);
  }

  function handleRangeChange(which: "from" | "to", value: string, onChange: (v: string) => void) {
    onChange(value);
    const studentId = form.getValues("studentId");
    const from = which === "from" ? value : form.getValues("from");
    const to = which === "to" ? value : form.getValues("to");
    if (!studentId || !from || !to) return;
    if (from > to) {
      // Never ask the server for an inverted range; say so on the field instead.
      clearPreview();
      form.setError("to", { type: "validate", message: SPP_PREPAY_RANGE_ORDER_MESSAGE });
      return;
    }
    form.clearErrors(["from", "to"]);
    void runPreview(studentId, from, to);
  }

  // Reset whenever the dialog flips closed so the next open starts fresh and
  // gets a new idempotency key.
  useEffect(() => {
    if (!open) {
      previewSeq.current += 1;
      form.reset(buildInitialForm());
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIdempotencyKey(crypto.randomUUID());
      setSelectedStudent(null);
      setPreview({ status: "idle" });
      setAcademicYear(null);
    }
  }, [open, form]);

  const data = preview.status === "ready" ? preview.data : null;
  const blockingIssues = data?.issues.filter((i) => i.blocking) ?? [];
  const warningIssues = data?.issues.filter((i) => !i.blocking) ?? [];
  const isBlocked = !!data && (data.blocked || blockingIssues.length > 0);
  const hasNoProgram = !!data && data.issues.some((i) => i.code === "NO_PROGRAM");
  const canConfirm = !!data && !isBlocked && data.total > 0;

  const linkRows = data?.rows.filter((r) => r.action === "SETTLE" && r.hadLink) ?? [];
  const latestLinkExpiry = linkRows
    .map((r) => r.linkExpiresAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);

  const months = academicYear ? monthOptions(academicYear.from, academicYear.to) : [];
  const today = getTodayInTimezone("Asia/Jakarta");

  async function submit(values: SppPrepayFormInput) {
    if (!data || !canConfirm) return;
    try {
      const res = await sendJson<ConfirmResponse>(
        "/api/invoices/spp-prepay",
        {
          method: "POST",
          body: {
            studentId: values.studentId,
            // Verbatim from the latest preview: the server checks the fingerprint against these.
            from: data.range.from,
            to: data.range.to,
            method: values.method,
            paidAt: values.paidAt,
            ...(values.reference ? { reference: values.reference } : {}),
            ...(values.notes ? { notes: values.notes } : {}),
            idempotencyKey,
            fingerprint: data.fingerprint,
          },
        },
        "Gagal mencatat SPP di muka",
      );

      setIdempotencyKey(crypto.randomUUID());
      onOpenChange(false);
      if (res?.replayed) {
        toast.success("SPP di muka ini sudah tercatat sebelumnya");
      } else {
        toast.success(
          `SPP di muka tercatat: ${res?.created ?? 0} tagihan dibuat, ${res?.settled ?? 0} dilunasi`,
        );
      }
      onRecorded?.();
    } catch (err) {
      applyServerErrors(form, err, "Gagal mencatat SPP di muka");
      // 409 = the numbers moved under us (PREVIEW_STALE) or there is nothing left to
      // record: show the fresh preview so the admin confirms what is true now. The
      // idempotency key is kept; the server writes nothing on a refused request.
      if (err instanceof ApiError && err.status === 409) {
        void runPreview(values.studentId, values.from, values.to);
      }
    }
  }

  const submitLabel = data && data.total > 0 ? `Catat ${formatRupiah(data.total)} lunas` : "Catat lunas";

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Catat SPP di Muka"
      description="Catat SPP beberapa bulan sekaligus yang sudah dibayar wali. Tagihan langsung Lunas, tanpa link pembayaran dan tanpa email."
      size="xl"
      footer={
        <FormDialogFooter
          formId={formId}
          pending={form.formState.isSubmitting}
          disabled={!canConfirm || preview.status === "loading"}
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

        <div className="grid grid-cols-1 gap-field sm:grid-cols-2">
          <FormField
            control={form.control}
            name="from"
            label="Dari bulan"
            required
            id="spp-prepay-from"
            render={({ field, controlProps }) => (
              <Select
                value={field.value}
                onValueChange={(v) => v != null && handleRangeChange("from", v as string, field.onChange)}
                disabled={months.length === 0}
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
            required
            id="spp-prepay-to"
            render={({ field, controlProps }) => (
              <Select
                value={field.value}
                onValueChange={(v) => v != null && handleRangeChange("to", v as string, field.onChange)}
                disabled={months.length === 0}
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

        <FormField
          control={form.control}
          name="reference"
          label="Referensi"
          id="spp-prepay-reference"
          description="Opsional, misalnya nomor kuitansi atau bukti transfer."
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
          render={({ field, controlProps }) => (
            <Textarea {...field} {...controlProps} value={field.value ?? ""} rows={2} />
          )}
        />

        {/* Step 2: the preview. Polite live region so a screen reader hears it settle. */}
        <section
          aria-label="Pratinjau SPP"
          aria-live="polite"
          aria-busy={preview.status === "loading"}
          className="space-y-3 border-t-2 border-border pt-4"
        >
          {preview.status === "idle" && (
            <p className="text-sm text-muted-foreground">
              Pilih siswa untuk melihat rincian SPP per bulan sebelum dicatat.
            </p>
          )}

          {preview.status === "loading" && (
            <div className="space-y-2" data-testid="spp-prepay-loading">
              <span className="sr-only">Memuat pratinjau SPP...</span>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}

          {preview.status === "error" && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>Pratinjau belum dapat dimuat</AlertTitle>
              <AlertDescription>
                <p>{preview.message}</p>
                {form.getValues("studentId") && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => {
                      const { studentId, from, to } = form.getValues();
                      void runPreview(studentId, from || undefined, to || undefined);
                    }}
                  >
                    Muat ulang pratinjau
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {data && (
            <>
              {blockingIssues.length > 0 && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertTitle>SPP belum bisa dicatat</AlertTitle>
                  <AlertDescription>
                    {blockingIssues.map((issue, i) => (
                      <p key={`${issue.code}-${i}`}>{issue.message}</p>
                    ))}
                    {hasNoProgram && (
                      <p>
                        Daftarkan siswa ke kelas lebih dulu di{" "}
                        <Link href="/admin/students" className="underline underline-offset-3">
                          halaman Siswa
                        </Link>
                        .
                      </p>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {warningIssues.length > 0 && (
                <Alert role="status">
                  <TriangleAlert aria-hidden="true" className="text-warning" />
                  <AlertTitle>Perlu diperiksa</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {warningIssues.map((issue, i) => (
                        <li key={`${issue.code}-${i}`}>{issue.message}</li>
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

              {data.rows.length > 0 && (
                <Table>
                  <TableCaption className="sr-only">
                    Rincian SPP {data.student.name} per bulan, {data.range.from} sampai {data.range.to}
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bulan</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                      <TableHead>Tindakan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((row) => (
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
                            row.action === "SKIP_PAID" ? "whitespace-normal text-muted-foreground" : "whitespace-normal"
                          }
                        >
                          {ACTION_LABELS[row.action]}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="text-right font-currency font-bold tabular-nums">
                        {formatRupiah(data.total)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              )}

              {!isBlocked && data.total <= 0 && (
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
