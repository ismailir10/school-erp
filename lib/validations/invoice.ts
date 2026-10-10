import { z } from "zod";
import { calendarDate, isRealCalendarDate, rupiahAmount, rupiahAmountCoerced } from "./bounds";
import { labelText, longText } from "./text";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

// Due dates: real calendar date (no 2026-02-30), 2000-01-01 … 2100-12-31.
const DUE_DATE_MESSAGES = {
  format: "Format tanggal jatuh tempo harus YYYY-MM-DD",
  invalid: "Tanggal jatuh tempo tidak valid",
  range: "Tanggal jatuh tempo di luar rentang yang wajar",
};
const dueDateSchema = () => calendarDate(DUE_DATE_MESSAGES);

export const generatePlanSchema = z.object({
  periodLabel: labelText({ required: "Periode wajib diisi", max: 64 }),
  dueDate: dueDateSchema(),
  academicYearId: z.string().min(1),
});

export const generateBatchSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1).max(25),
  periodLabel: labelText({ required: "Periode wajib diisi", max: 64 }),
  dueDate: dueDateSchema(),
  academicYearId: z.string().min(1),
});

// Payment date ("Tanggal bayar"): a real calendar date, never later than today
// on the school's (Asia/Jakarta) calendar. Back-dating is allowed — the admin
// may be entering a transfer from last week. The route stores it at 00:00 WIB.
const PAID_AT_MESSAGES = {
  format: "Format tanggal bayar harus YYYY-MM-DD",
  invalid: "Tanggal bayar tidak valid",
  range: "Tanggal bayar di luar rentang yang wajar",
};
export const PAID_AT_FUTURE_MESSAGE = "Tanggal bayar tidak boleh di masa depan.";
const paidAtSchema = () =>
  calendarDate(PAID_AT_MESSAGES).refine(
    // Lexicographic compare is correct for zero-padded ISO dates. A malformed
    // string already failed above; this only judges well-formed ones.
    (d) => !isRealCalendarDate(d) || d <= getTodayInTimezone("Asia/Jakarta"),
    PAID_AT_FUTURE_MESSAGE,
  );

export const recordPaymentSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  // coerce: the record-payment dialog posts its form state verbatim, so
  // `amount` arrives as the <Input>'s string value.
  amount: rupiahAmountCoerced(),
  // Full Payment.method vocabulary (enum-conformance test pins it to the Prisma
  // comment). The route additionally refuses the gateway rails XENDIT/DOKU for a
  // manual record (FIN-23) — kept out of the schema so the form schema can keep
  // `.extend()`-ing this one.
  method: z.enum(["CASH", "BANK_TRANSFER", "XENDIT", "DOKU", "OTHER"]).default("CASH"),
  reference: labelText().optional().nullable(),
  notes: longText().optional().nullable(),
  // Absent = today (the route keeps `now`). The form always sends it.
  paidAt: paidAtSchema().optional(),
});

export const adjustInvoiceLineSchema = z.object({
  adjustmentAmount: z.number(),
  adjustmentNote: longText({ required: "Catatan penyesuaian wajib diisi" }),
});

export const updateInvoiceSchema = z.object({
  status: z
    .enum(["DRAFT", "PENDING_PAYMENT_LINK", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"])
    .optional(),
});

export const retryPaymentLinksSchema = z.object({
  invoiceIds: z.array(z.string().min(1)).max(25).optional(),
});

// POST /api/xendit/create-session body shape. Accepts the singular
// `invoiceId` form (single-invoice "Buat Link Pembayaran" action) alongside
// the bulk `invoiceIds` form (admin multi-select "Kirim Tagihan"), capped at
// 25 to match every sibling bulk route (`retryPaymentLinksSchema`,
// `generateBatchSchema`).
export const createPaymentSessionSchema = z.object({
  invoiceId: z.string().min(1).optional(),
  invoiceIds: z.array(z.string().min(1)).max(25).optional(),
});

// Base shape shared by the API schema and the admin manual-invoice form's
// client-side schema (`manualInvoiceFormSchema` below) — kept as a plain
// ZodObject (no `.refine`/`.superRefine` yet) so both can `.extend()` the
// `lines` field with their own line-item shape without duplicating
// studentId/periodLabel/dueDate. Required-field messages are Indonesian and
// human ("wajib diisi"/"dipilih"), not the zod default — `.min(1, …)` before
// `.regex(...)` so an empty dueDate reads as missing, not malformed.
const manualInvoiceBaseSchema = z.object({
  studentId: z.string().min(1, "Pilih siswa terlebih dahulu"),
  periodLabel: labelText({ required: "Periode wajib diisi", max: 64 }),
  // `.min(1, …)` first so an empty dueDate reads as missing, not malformed.
  dueDate: z
    .string()
    .min(1, "Tanggal jatuh tempo wajib diisi")
    .pipe(dueDateSchema()),
  lines: z
    .array(
      z.object({
        feeComponentId: z.string().min(1, "Pilih komponen biaya pada setiap baris"),
        amount: rupiahAmount({ min: "Jumlah pada setiap baris harus lebih dari 0" }),
      })
    )
    .min(1, "Tambahkan minimal satu komponen"),
});

/** Message for the array-level "same component twice" rule (also read by the dialog to clear it). */
export const DUPLICATE_LINES_MESSAGE = "Komponen biaya tidak boleh duplikat";

function rejectDuplicateFeeComponents(
  data: { lines: { feeComponentId: string }[] },
  ctx: z.RefinementCtx
) {
  if (new Set(data.lines.map((l) => l.feeComponentId)).size !== data.lines.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: DUPLICATE_LINES_MESSAGE,
      path: ["lines"],
    });
  }
}

export const createManualInvoiceSchema = manualInvoiceBaseSchema.superRefine(
  rejectDuplicateFeeComponents
);

// Client-only form schema for `ManualInvoiceDialog`. Differs from the API
// schema in exactly one way: a not-yet-filled `amount` (RupiahInput's empty
// state) arrives as `null`, not `0` or an absent key — `z.number().positive()`
// would reject `null` with zod's generic "invalid type" message, so this
// nullable + type-narrowing refine gives it the same Indonesian message the
// API schema uses for a zero/negative amount, while still requiring a plain
// `number` (never `null`) on the parsed output the submit handler sends.
const manualInvoiceFormLineSchema = z.object({
  feeComponentId: z.string().min(1, "Pilih komponen biaya pada setiap baris"),
  amount: rupiahAmount({ min: "Jumlah pada setiap baris harus lebih dari 0" })
    .nullable()
    .refine((v): v is number => v !== null, {
      message: "Jumlah pada setiap baris harus lebih dari 0",
    }),
});

export const manualInvoiceFormSchema = manualInvoiceBaseSchema
  .extend({
    lines: z.array(manualInvoiceFormLineSchema).min(1, "Tambahkan minimal satu komponen"),
  })
  .superRefine(rejectDuplicateFeeComponents);

// Client form schema for the invoices/[id] "Catat Pembayaran" dialog (T6,
// 2026-09-27 admin-finish-standard cycle). Differs from `recordPaymentSchema`
// in exactly one way: `amount` comes from `RupiahInput`, whose empty state is
// `null` (not `0` or an absent key) — same shape as
// `manualInvoiceFormLineSchema.amount` above. A blank amount must read as
// "wajib diisi", not the wire schema's "Jumlah harus lebih dari 0" (which
// still fires for an explicit 0 or a negative value).
export const invoicePaymentFormSchema = recordPaymentSchema.extend({
  // The form always carries a date (default today); a cleared picker reads as
  // missing rather than "Format tanggal bayar harus YYYY-MM-DD".
  paidAt: z.string().min(1, "Tanggal bayar wajib diisi").pipe(paidAtSchema()),
  amount: rupiahAmount({ min: "Jumlah harus lebih dari 0" })
    .nullable()
    .refine((v): v is number => v !== null, {
      message: "Jumlah pembayaran wajib diisi",
    }),
});

export type InvoicePaymentFormInput = z.infer<typeof invoicePaymentFormSchema>;

// Reversal of a MANUAL payment. The reason is mandatory: it is the only
// record of why money that was booked as received was taken back.
export const reversePaymentSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Alasan wajib diisi (minimal 5 karakter)")
    .max(300, "Alasan maksimal 300 karakter"),
});

export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;
