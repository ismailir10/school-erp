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
