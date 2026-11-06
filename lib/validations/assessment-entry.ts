import { z } from "zod";

/**
 * AssessmentEntry validators — C4/T2.
 *
 * Wire shape: dates are Jakarta-tz YYYY-MM-DD strings; the API layer
 * converts them via `parseJakartaYmd` from `lib/validations/curriculum.ts`
 * before any Prisma write. `weekId` is resolved server-side from `date` +
 * tenant via `getCurrentWeek` — never accepted from the client.
 *
 * The discriminator on `source` is enforced via `superRefine`:
 * - HOMEROOM entries reject `center`
 * - CENTER entries require `center`
 *
 * No DB import. Pure shape + math.
 */

const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;

const ymdSchema = z
  .string()
  .regex(ymdRegex, "Format tanggal harus YYYY-MM-DD");

export const assessmentSourceSchema = z.enum(["HOMEROOM", "CENTER"]);

export const learningCenterSchema = z.enum([
  "WORSHIP",
  "NATURAL_MATERIALS",
  "ART",
  "COOKING",
  "ROLE_PLAY",
  "BLOCKS",
  "PREPARATION",
  "AREA",
]);

export const achievementLevelSchema = z.enum([
  "CONSISTENT",
  "EMERGING",
  "NEEDS_REINFORCEMENT",
]);

const baseEntryShape = z.object({
  studentId: z.string().min(1, "Siswa wajib dipilih"),
  indicatorId: z.string().min(1, "IKTP wajib dipilih"),
  date: ymdSchema,
  source: assessmentSourceSchema,
  center: learningCenterSchema.optional(),
  activity: z.string().min(1).max(200).optional(),
  level: achievementLevelSchema,
  note: z.string().max(500).optional(),
});

function applySourceCenterRule(
  value: { source: "HOMEROOM" | "CENTER"; center?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.source === "HOMEROOM" && value.center !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Penilaian Pekanan tidak boleh menyebut sentra",
      path: ["center"],
    });
  }
  if (value.source === "CENTER" && value.center === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Penilaian Sentra wajib menyebut sentra",
      path: ["center"],
    });
  }
}

export const assessmentEntryCreateSchema = baseEntryShape.superRefine(
  applySourceCenterRule,
);

export const MAX_BULK_ENTRIES = 50;

export const assessmentEntryBulkCreateSchema = z.object({
  entries: z
    .array(baseEntryShape.superRefine(applySourceCenterRule))
    .min(1, "Setidaknya satu penilaian wajib dikirim")
    .max(MAX_BULK_ENTRIES, `Maksimum ${MAX_BULK_ENTRIES} penilaian per request`),
});

export const assessmentEntryUpdateSchema = z.object({
  level: achievementLevelSchema.optional(),
  note: z.string().max(500).nullable().optional(),
  activity: z.string().min(1).max(200).nullable().optional(),
});

/**
 * Admin Category-C override — C7a/T2.
 *
 * Used by the upcoming `PATCH /api/admin/assessment-entries/[id]/void`
 * route (ships C7b). The route handler sets voidedAt = now, voidedById
 * = session.employeeId, and persists voidReason as written here. Reason
 * is trimmed and capped to keep audit text scannable.
 */
export const assessmentEntryVoidSchema = z.object({
  voidReason: z
    .string()
    .trim()
    .min(3, "Alasan minimal 3 karakter")
    .max(500, "Alasan maksimal 500 karakter"),
});

/**
 * Sentra (center) session schema — C5/T1.
 *
 * One sentra teacher fills one session per (sentra × date × ageGroup):
 * shared `sentraId` + `activity` text, plus a list of per-(student, indicator)
 * level + note rows. The route handler upserts each row with
 * `source: "CENTER"` against the C4 AssessmentEntry table.
 *
 * Empty `entries` is allowed (route returns a no-op). Cap at 80 = ~20
 * students × 4 indicators per session, the design's stated max.
 */
export const MAX_CENTER_SESSION_ENTRIES = 80;

export const assessmentEntryCenterSessionSchema = z
  .object({
    sentraId: z.string().min(1, "Sentra wajib dipilih"),
    date: ymdSchema,
    // Required when there are entries; allowed empty when entries=[] so the
    // route's no-op audit branch can record "sentra teacher reviewed but
    // didn't tap" without the validator forcing a placeholder string. The
    // superRefine below enforces the conditional rule.
    activity: z.string().max(200).default(""),
    entries: z
      .array(
        z.object({
          studentId: z.string().min(1, "Siswa wajib dipilih"),
          indicatorId: z.string().min(1, "IKTP wajib dipilih"),
          level: achievementLevelSchema,
          note: z.string().max(500).optional(),
        }),
      )
      .max(
        MAX_CENTER_SESSION_ENTRIES,
        `Maksimum ${MAX_CENTER_SESSION_ENTRIES} penilaian per sesi`,
      ),
  })
  .superRefine((value, ctx) => {
    if (value.entries.length > 0 && value.activity.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Kegiatan wajib diisi saat menyimpan penilaian",
        path: ["activity"],
      });
    }
  });

export type AssessmentEntryCreateInput = z.infer<
  typeof assessmentEntryCreateSchema
>;
export type AssessmentEntryBulkCreateInput = z.infer<
  typeof assessmentEntryBulkCreateSchema
>;
export type AssessmentEntryUpdateInput = z.infer<
  typeof assessmentEntryUpdateSchema
>;
export type AssessmentEntryCenterSessionInput = z.infer<
  typeof assessmentEntryCenterSessionSchema
>;
export type AssessmentEntryVoidInput = z.infer<typeof assessmentEntryVoidSchema>;
