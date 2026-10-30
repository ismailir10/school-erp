import { z } from "zod";
import { calendarDate, isRealCalendarDate, rupiahAmount } from "./bounds";
import { DUPLICATE_LINES_MESSAGE } from "./invoice";
import { labelText, longText } from "./text";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { parsePeriodMonth } from "@/lib/finance/period-label";

/**
 * "Catat pembayaran di muka" (docs/cycles/2026-10-27-paid-invoice-spp-prepay.md;
 * one-time fees added by docs/cycles/2026-10-30-prepay-other-fees.md).
 * `POST /api/invoices/spp-prepay/preview` takes `sppPrepayPreviewSchema`,
 * `POST /api/invoices/spp-prepay` takes `sppPrepayConfirmSchema`, and the
 * dialog's step 1 validates with `sppPrepayFormSchema`.
 *
 * Two optional parts: SPP months (`from` + `to`; absent = "Tanpa SPP") and
 * one-time fees (`otherFees`). A preview may carry neither (a "student only"
 * call returns the component list and whether SPP is available); a confirm
 * needs at least one.
 */

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_MONTH_MESSAGE = "Format bulan harus YYYY-MM";

const yearMonth = () => z.string().regex(YEAR_MONTH, YEAR_MONTH_MESSAGE);

// Same rule as `recordPaymentSchema.paidAt` in ./invoice (a real calendar date,
// never later than today in Asia/Jakarta). Copied rather than imported because
// that helper is private to its file.
const PAID_AT_MESSAGES = {
  format: "Format tanggal bayar harus YYYY-MM-DD",
  invalid: "Tanggal bayar tidak valid",
  range: "Tanggal bayar di luar rentang yang wajar",
};
const PAID_AT_FUTURE_MESSAGE = "Tanggal bayar tidak boleh di masa depan.";
const paidAtSchema = () =>
  calendarDate(PAID_AT_MESSAGES).refine(
    (d) => !isRealCalendarDate(d) || d <= getTodayInTimezone("Asia/Jakarta"),
    PAID_AT_FUTURE_MESSAGE,
  );

/** Manual rails only: the gateway rails (XENDIT / DOKU) are written by the webhook, never hand-recorded. */
export const SPP_PREPAY_METHODS = ["CASH", "BANK_TRANSFER", "OTHER"] as const;
const METHOD_MESSAGE = "Pilih Tunai, Transfer Bank, atau Lainnya.";
const methodSchema = () => z.enum(SPP_PREPAY_METHODS, { error: METHOD_MESSAGE });

// ── one-time fees ("Biaya lainnya") ────────────────────────────────────────

/** Most lines one prepay invoice carries. */
export const OTHER_FEES_MAX_LINES = 20;

export const OTHER_FEES_LABEL_REQUIRED_MESSAGE = "Periode wajib diisi";
/**
 * The Billing Run skips a student that already has an invoice with the same
 * month label, so a one-time invoice named after a month would hide that month's SPP.
 */
export const OTHER_FEES_MONTH_LABEL_MESSAGE =
  'Gunakan label yang menjelaskan biaya, mis. "Biaya Sekolah Tahap 1 TA 2027/2028", bukan nama bulan.';
export const OTHER_FEES_LINES_REQUIRED_MESSAGE = "Tambahkan minimal satu biaya";
const LINE_COMPONENT_MESSAGE = "Pilih komponen biaya pada setiap baris";
const LINE_AMOUNT_MESSAGE = "Jumlah pada setiap baris harus lebih dari 0";
/** Neither SPP nor one-time fees chosen. Reported on the pseudo-field `parts`. */
export const PREPAY_NOTHING_CHOSEN_MESSAGE =
  "Pilih SPP atau isi biaya lainnya. Belum ada yang dicatat.";
const RANGE_PAIR_MESSAGE = "Isi bulan awal dan bulan akhir, atau pilih Tanpa SPP";

// Same label bound as a manual invoice's Periode (`manualInvoiceBaseSchema` in ./invoice).
const otherFeesLabelSchema = () =>
  labelText({ required: OTHER_FEES_LABEL_REQUIRED_MESSAGE, max: 64 }).refine(
    (v) => parsePeriodMonth(v) === null,
    OTHER_FEES_MONTH_LABEL_MESSAGE,
  );

// Same amount rule as a manual invoice line: whole rupiah, Rp 1 to Rp 1.000.000.000.
const otherFeesLineSchema = z.object({
  feeComponentId: z.string().min(1, LINE_COMPONENT_MESSAGE),
  amount: rupiahAmount({ min: LINE_AMOUNT_MESSAGE }),
});

// The same component twice is refused, like a manual invoice (D7 of 2026-10-30 points the admin
// at "Catat Pembayaran" for a second instalment): a duplicate line is far more likely a slip.
function rejectDuplicateLines(lines: { feeComponentId: string }[], ctx: z.RefinementCtx, path: (string | number)[]) {
  if (new Set(lines.map((l) => l.feeComponentId)).size !== lines.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: DUPLICATE_LINES_MESSAGE, path });
  }
}

export const otherFeesSchema = z
  .object({
    label: otherFeesLabelSchema(),
    lines: z
      .array(otherFeesLineSchema)
      .min(1, OTHER_FEES_LINES_REQUIRED_MESSAGE)
      .max(OTHER_FEES_MAX_LINES, `Maksimal ${OTHER_FEES_MAX_LINES} biaya`),
  })
  .superRefine((v, ctx) => rejectDuplicateLines(v.lines, ctx, ["lines"]));

export type OtherFeesPayload = z.infer<typeof otherFeesSchema>;

/** SPP is chosen by giving both months, "Tanpa SPP" by giving neither; one alone is a mistake. */
function requireBothOrNeitherMonth(v: { from?: string | null; to?: string | null }, ctx: z.RefinementCtx) {
  if (v.from && !v.to) ctx.addIssue({ code: z.ZodIssueCode.custom, message: RANGE_PAIR_MESSAGE, path: ["to"] });
  if (v.to && !v.from) ctx.addIssue({ code: z.ZodIssueCode.custom, message: RANGE_PAIR_MESSAGE, path: ["from"] });
}

export const sppPrepayPreviewSchema = z
  .object({
    studentId: z.string().min(1, "Pilih siswa terlebih dahulu"),
    /** With `to`: the SPP months to plan. Neither: no SPP part. */
    from: yearMonth().nullish(),
    to: yearMonth().nullish(),
    /** The one-time fees to plan. Absent: no one-time part. */
    otherFees: otherFeesSchema.nullish(),
  })
  .superRefine(requireBothOrNeitherMonth);

export const sppPrepayConfirmSchema = z
  .object({
    studentId: z.string().min(1, "Pilih siswa terlebih dahulu"),
    from: yearMonth().nullish(),
    to: yearMonth().nullish(),
    otherFees: otherFeesSchema.nullish(),
    method: methodSchema(),
    paidAt: paidAtSchema(),
    reference: labelText().optional().nullable(),
    notes: longText().optional().nullable(),
    idempotencyKey: z.string().uuid(),
    /** The `fingerprint` the preview returned; a mismatch means the data changed since. */
    fingerprint: z.string().min(1),
  })
  .superRefine((v, ctx) => {
    requireBothOrNeitherMonth(v, ctx);
    if (!v.from && !v.to && !v.otherFees) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: PREPAY_NOTHING_CHOSEN_MESSAGE, path: ["parts"] });
    }
  });

export type SppPrepayPreviewInput = z.infer<typeof sppPrepayPreviewSchema>;
export type SppPrepayConfirmInput = z.infer<typeof sppPrepayConfirmSchema>;

export const SPP_PREPAY_RANGE_ORDER_MESSAGE = "Bulan akhir tidak boleh sebelum bulan awal";

// Client form schema for the dialog's step 1. A cleared picker reads as missing
// ("wajib diisi") rather than as a malformed value. `withSpp` false = "Tanpa SPP":
// the months are then ignored. `otherFees.lines` may be empty (no one-time part);
// the label matters only once there is a line. An unfilled amount is `null`
// (RupiahInput's empty state).
const sppPrepayFormLineSchema = z.object({
  feeComponentId: z.string(),
  amount: z.number().nullable(),
});

export const sppPrepayFormSchema = z
  .object({
    studentId: z.string().min(1, "Pilih siswa terlebih dahulu"),
    withSpp: z.boolean(),
    from: z.string(),
    to: z.string(),
    otherFees: z.object({
      label: z.string(),
      lines: z.array(sppPrepayFormLineSchema).max(OTHER_FEES_MAX_LINES, `Maksimal ${OTHER_FEES_MAX_LINES} biaya`),
    }),
    method: methodSchema(),
    paidAt: z.string().min(1, "Tanggal bayar wajib diisi").pipe(paidAtSchema()),
    reference: labelText().optional().nullable(),
    notes: longText().optional().nullable(),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    if (v.withSpp) {
      if (!v.from) issue("Bulan awal wajib diisi", ["from"]);
      else if (!YEAR_MONTH.test(v.from)) issue(YEAR_MONTH_MESSAGE, ["from"]);
      if (!v.to) issue("Bulan akhir wajib diisi", ["to"]);
      else if (!YEAR_MONTH.test(v.to)) issue(YEAR_MONTH_MESSAGE, ["to"]);
      if (YEAR_MONTH.test(v.from) && YEAR_MONTH.test(v.to) && v.from > v.to) {
        issue(SPP_PREPAY_RANGE_ORDER_MESSAGE, ["to"]);
      }
    }

    const { label, lines } = v.otherFees;
    if (lines.length > 0) {
      const parsed = otherFeesLabelSchema().safeParse(label);
      if (!parsed.success) {
        for (const e of parsed.error.issues) issue(e.message, ["otherFees", "label"]);
      }
      lines.forEach((line, i) => {
        if (!line.feeComponentId) issue(LINE_COMPONENT_MESSAGE, ["otherFees", "lines", i, "feeComponentId"]);
        const amount = rupiahAmount({ min: LINE_AMOUNT_MESSAGE }).safeParse(line.amount);
        if (line.amount === null) issue(LINE_AMOUNT_MESSAGE, ["otherFees", "lines", i, "amount"]);
        else if (!amount.success) {
          for (const e of amount.error.issues) issue(e.message, ["otherFees", "lines", i, "amount"]);
        }
      });
      rejectDuplicateLines(
        lines.filter((l) => l.feeComponentId),
        ctx,
        ["otherFees", "lines"],
      );
    }

    if (!v.withSpp && lines.length === 0) issue(PREPAY_NOTHING_CHOSEN_MESSAGE, ["parts"]);
  });

export type SppPrepayFormInput = z.infer<typeof sppPrepayFormSchema>;

/**
 * The `from` / `to` / `otherFees` part of a preview or confirm request for the
 * form's current values. Safe on a half-filled form (the preview is called as
 * the admin types): lines without a component or a positive amount are left
 * out, and `otherFees` is omitted until there is a label and a complete line.
 */
export function sppPrepayPartsFromForm(
  values: Pick<SppPrepayFormInput, "withSpp" | "from" | "to" | "otherFees">,
): { from?: string; to?: string; otherFees?: OtherFeesPayload } {
  const lines = values.otherFees.lines.flatMap((l) =>
    l.feeComponentId && l.amount !== null && l.amount > 0 ? [{ feeComponentId: l.feeComponentId, amount: l.amount }] : [],
  );
  const label = values.otherFees.label.trim();
  return {
    ...(values.withSpp && values.from && values.to ? { from: values.from, to: values.to } : {}),
    ...(label && lines.length > 0 ? { otherFees: { label, lines } } : {}),
  };
}
