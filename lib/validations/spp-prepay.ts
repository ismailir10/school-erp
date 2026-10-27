import { z } from "zod";
import { calendarDate, isRealCalendarDate } from "./bounds";
import { labelText, longText } from "./text";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

/**
 * "Catat SPP di muka" (docs/cycles/2026-10-27-paid-invoice-spp-prepay.md).
 * `POST /api/invoices/spp-prepay/preview` takes `sppPrepayPreviewSchema`,
 * `POST /api/invoices/spp-prepay` takes `sppPrepayConfirmSchema`, and the
 * dialog's step 1 validates with `sppPrepayFormSchema`.
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

export const sppPrepayPreviewSchema = z.object({
  studentId: z.string().min(1, "Pilih siswa terlebih dahulu"),
  /** Absent = the academic year's first month. */
  from: yearMonth().optional(),
  /** Absent = the academic year's last month. */
  to: yearMonth().optional(),
});

export const sppPrepayConfirmSchema = z.object({
  studentId: z.string().min(1, "Pilih siswa terlebih dahulu"),
  from: yearMonth(),
  to: yearMonth(),
  method: methodSchema(),
  paidAt: paidAtSchema(),
  reference: labelText().optional().nullable(),
  notes: longText().optional().nullable(),
  idempotencyKey: z.string().uuid(),
  /** The `fingerprint` the preview returned; a mismatch means the data changed since. */
  fingerprint: z.string().min(1),
});

export type SppPrepayPreviewInput = z.infer<typeof sppPrepayPreviewSchema>;
export type SppPrepayConfirmInput = z.infer<typeof sppPrepayConfirmSchema>;

export const SPP_PREPAY_RANGE_ORDER_MESSAGE = "Bulan akhir tidak boleh sebelum bulan awal";

// Client form schema for the dialog's step 1. A cleared picker reads as missing
// ("wajib diisi") rather than as a malformed value.
export const sppPrepayFormSchema = z
  .object({
    studentId: z.string().min(1, "Pilih siswa terlebih dahulu"),
    from: z.string().min(1, "Bulan awal wajib diisi").pipe(yearMonth()),
    to: z.string().min(1, "Bulan akhir wajib diisi").pipe(yearMonth()),
    method: methodSchema(),
    paidAt: z.string().min(1, "Tanggal bayar wajib diisi").pipe(paidAtSchema()),
    reference: labelText().optional().nullable(),
    notes: longText().optional().nullable(),
  })
  .refine((v) => !YEAR_MONTH.test(v.from) || !YEAR_MONTH.test(v.to) || v.from <= v.to, {
    message: SPP_PREPAY_RANGE_ORDER_MESSAGE,
    path: ["to"],
  });

export type SppPrepayFormInput = z.infer<typeof sppPrepayFormSchema>;
