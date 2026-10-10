import { z } from "zod";

const note = z.string().trim().max(300, "Catatan maksimal 300 karakter").optional();

/**
 * PATCH /api/enrollments/[id]/fee — what staff can do to an UNPAID fee.
 *
 *  DISCOUNT   set the percent off the snapshotted base fee (0 clears it). A
 *             percent above 0 needs a reason, because it is money the school
 *             gives up and someone will ask why. 100 waives the fee.
 *  MARK_PAID  the parent paid outside the gateway (cash, bank transfer).
 *  WAIVE      no fee is due.
 */
export const enrollmentFeeActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("DISCOUNT"),
      discountPercent: z
        .number({ error: "Diskon harus berupa angka" })
        .int("Diskon harus berupa angka bulat")
        .min(0, "Diskon tidak boleh negatif")
        .max(100, "Diskon maksimal 100%"),
      reason: z.string().trim().max(200, "Alasan maksimal 200 karakter").optional(),
    })
    .refine((v) => v.discountPercent === 0 || Boolean(v.reason), {
      path: ["reason"],
      message: "Isi alasan diskon",
    }),
  z.object({
    action: z.literal("MARK_PAID"),
    method: z.enum(["CASH", "BANK_TRANSFER"], { error: "Pilih cara pembayaran" }),
    note,
  }),
  z.object({ action: z.literal("WAIVE"), note }),
]);

export type EnrollmentFeeAction = z.infer<typeof enrollmentFeeActionSchema>;

/**
 * Form schemas for the two dialogs on the application detail page. The wire
 * schema above is the source of truth; these only differ in taking what the
 * inputs hold (a percent typed as text) and pointing every issue at a field
 * the dialog actually shows.
 */
export const feeDiscountFormSchema = z
  .object({
    discountPercent: z
      .string()
      .trim()
      .min(1, "Diskon wajib diisi")
      .regex(/^\d{1,3}$/, "Isi angka bulat antara 0 dan 100")
      .refine((v) => Number(v) <= 100, "Diskon maksimal 100%"),
    reason: z.string().trim().max(200, "Alasan maksimal 200 karakter"),
  })
  .refine((v) => Number(v.discountPercent) === 0 || v.reason.length > 0, {
    path: ["reason"],
    message: "Isi alasan diskon",
  });

export const feeMarkPaidFormSchema = z.object({
  method: z.enum(["CASH", "BANK_TRANSFER"], { error: "Pilih cara pembayaran" }),
  note: z.string().trim().max(300, "Catatan maksimal 300 karakter"),
});
