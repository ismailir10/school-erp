import { z } from "zod";

// Cuti siswa (enrollment leave), docs/cycles/2026-10-29-student-enrollment-leave.md.
// The body NEVER carries studentId or tenantId: the student comes from the
// enrollment (and must match the route id), the tenant from the session.

const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const monthSchema = (label: string) =>
  z
    .string({ error: `${label} wajib diisi` })
    .regex(YEAR_MONTH_RE, `${label} tidak valid. Pilih bulan dan tahun.`);

export const createEnrollmentLeaveSchema = z
  .object({
    enrollmentId: z
      .string({ error: "Pendaftaran kelas wajib dipilih" })
      .trim()
      .min(1, "Pendaftaran kelas wajib dipilih"),
    startMonth: monthSchema("Bulan mulai"),
    endMonth: monthSchema("Bulan akhir"),
    reason: z
      .string({ error: "Alasan wajib diisi" })
      .trim()
      .min(3, "Alasan minimal 3 karakter")
      .max(200, "Alasan maksimal 200 karakter"),
  })
  .superRefine((data, ctx) => {
    // YYYY-MM compares correctly as plain text.
    if (YEAR_MONTH_RE.test(data.startMonth) && YEAR_MONTH_RE.test(data.endMonth) && data.endMonth < data.startMonth) {
      ctx.addIssue({
        code: "custom",
        message: "Bulan akhir tidak boleh sebelum bulan mulai",
        path: ["endMonth"],
      });
    }
  });

export type CreateEnrollmentLeaveInput = z.infer<typeof createEnrollmentLeaveSchema>;

// Cancel is PUT { status: "INACTIVE" }: a leave is created or cancelled, never
// edited, and never reactivated.
export const cancelEnrollmentLeaveSchema = z.object({
  status: z.literal("INACTIVE", { error: "Status harus INACTIVE" }),
});

export type CancelEnrollmentLeaveInput = z.infer<typeof cancelEnrollmentLeaveSchema>;
