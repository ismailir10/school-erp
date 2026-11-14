import { z } from "zod";

/**
 * Holiday validators — Task 4 reconcile-triggers hardening.
 *
 * Holiday POST/PUT bodies feed `date` into `reconcileSectionsForHoliday`, so
 * the wire shape is validated before any DB write. `date` is a Jakarta-tz
 * YYYY-MM-DD string; the API layer passes it straight through to the fan-out.
 * Display copy is Indonesian per `.claude/standards/voice.md`.
 *
 * No DB import. Pure shape.
 */

const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;

export const holidaySchema = z.object({
  date: z
    .string()
    .min(1, "Tanggal wajib diisi")
    .regex(ymdRegex, "Format tanggal harus YYYY-MM-DD")
    .refine((date) => {
      const parsed = new Date(`${date}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
    }, "Tanggal tidak valid"),
  name: z
    .string()
    .trim()
    .min(1, "Nama hari libur wajib diisi")
    .max(120, "Nama hari libur maksimal 120 karakter"),
  type: z.string().trim().min(1, "Jenis hari libur wajib diisi"),
  isHalfDay: z.boolean().optional(),
});

export type HolidayInput = z.infer<typeof holidaySchema>;
