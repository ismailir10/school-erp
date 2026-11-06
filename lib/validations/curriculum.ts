import { z } from "zod";
import { getYmdInTimezone } from "@/lib/attendance/timezone";

/**
 * Curriculum validators — C1/T4.
 *
 * All dates are Jakarta-tz YYYY-MM-DD strings on the wire; the API layer
 * converts them to UTC-midnight DateTime via `parseJakartaYmd` before any
 * Prisma write so downstream queries are timezone-coherent. Display copy
 * is Indonesian per `.claude/standards/voice.md`.
 *
 * No DB import. Pure shape + math.
 */

const JAKARTA_TZ = "Asia/Jakarta";

const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;

const ymdSchema = z
  .string()
  .regex(ymdRegex, "Format tanggal harus YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && getYmdInTimezone(d, "UTC") === s;
  }, "Tanggal tidak valid");

const semesterShape = z.object({
  academicYearId: z.string().min(1, "Tahun ajaran wajib dipilih"),
  number: z.union([z.literal(1), z.literal(2)]),
  startDate: ymdSchema,
  endDate: ymdSchema,
});

export const semesterCreateSchema = semesterShape.refine(
  (v) => v.startDate < v.endDate,
  { message: "Tanggal mulai harus sebelum tanggal selesai", path: ["endDate"] },
);

// Client form schema (T3, 2026-09-27 admin-forms-rhf cycle). The Tambah/Ubah
// Semester dialog's "Nomor semester" Select holds its RHF value as the
// string "1"/"2" (native Select value shape) — the API's `number` field is
// the literal `1 | 2`, so this coerces the string form before it reaches
// `semesterShape`'s union. `academicYearId` stays required in both create
// and edit: the dialog disables (never omits) that Select on edit and keeps
// the row's existing value, so it is always present in the submitted body.
export const semesterFormSchema = semesterShape
  .extend({
    number: z
      .union([z.literal(1), z.literal(2), z.literal("1"), z.literal("2")], {
        message: "Nomor semester wajib dipilih",
      })
      .transform((v) => Number(v) as 1 | 2),
  })
  .refine((v) => v.startDate < v.endDate, {
    message: "Tanggal mulai harus sebelum tanggal selesai",
    path: ["endDate"],
  });

export const semesterUpdateSchema = z
  .object({
    number: z.union([z.literal(1), z.literal(2)]).optional(),
    startDate: ymdSchema.optional(),
    endDate: ymdSchema.optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .refine(
    (v) => !(v.startDate && v.endDate) || v.startDate < v.endDate,
    {
      message: "Tanggal mulai harus sebelum tanggal selesai",
      path: ["endDate"],
    },
  );

export const themeCreateSchema = z.object({
  semesterId: z.string().min(1),
  name: z.string().min(1, "Nama tema wajib diisi").max(120),
  order: z.number().int().min(0),
  /** A / B, or null/absent = shared "Semua kelompok". */
  ageGroup: z.enum(["A", "B"]).nullable().optional(),
});

export const themeUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  ageGroup: z.enum(["A", "B"]).nullable().optional(),
  order: z.number().int().min(0).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const subThemeCreateSchema = z.object({
  themeId: z.string().min(1),
  name: z.string().min(1, "Nama subtema wajib diisi").max(120),
  order: z.number().int().min(0),
});

export const subThemeUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  order: z.number().int().min(0).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

const weekShape = z.object({
  subThemeId: z.string().min(1),
  number: z.number().int().min(1, "Nomor pekan harus ≥ 1"),
  startDate: ymdSchema,
  endDate: ymdSchema,
});

export const weekCreateSchema = weekShape.refine(
  (v) => v.startDate < v.endDate,
  { message: "Tanggal mulai harus sebelum tanggal selesai", path: ["endDate"] },
);

export const weekUpdateSchema = z
  .object({
    number: z.number().int().min(1).optional(),
    startDate: ymdSchema.optional(),
    endDate: ymdSchema.optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .refine(
    (v) => !(v.startDate && v.endDate) || v.startDate < v.endDate,
    {
      message: "Tanggal mulai harus sebelum tanggal selesai",
      path: ["endDate"],
    },
  );

export type SemesterCreateInput = z.infer<typeof semesterCreateSchema>;
export type SemesterUpdateInput = z.infer<typeof semesterUpdateSchema>;
export type SemesterFormInput = z.input<typeof semesterFormSchema>;
export type ThemeCreateInput = z.infer<typeof themeCreateSchema>;
export type ThemeUpdateInput = z.infer<typeof themeUpdateSchema>;
export type SubThemeCreateInput = z.infer<typeof subThemeCreateSchema>;
export type SubThemeUpdateInput = z.infer<typeof subThemeUpdateSchema>;
export type WeekCreateInput = z.infer<typeof weekCreateSchema>;
export type WeekUpdateInput = z.infer<typeof weekUpdateSchema>;

/**
 * PROMES import validators — C2/T4.
 *
 * Two halves:
 *   1. `promesImportRequestSchema` — multipart-form-derived request
 *      shape carrying `semesterId` + `ageGroup`. The xlsx itself is a
 *      File on the multipart payload, validated separately at the route
 *      layer (size cap + content-type guard) before parsing begins.
 *   2. `objectiveCreateSchema` + `indicatorCreateSchema` — row-level
 *      shape every parsed PROMES row passes through before the
 *      `prisma.$transaction` opens. A Zod-fail rolls back the whole
 *      import with the failing row coordinates surfaced in the 400
 *      response payload, so the admin can spot which TP / IKTP needs
 *      authoring fixup before retry.
 *
 * Element + AgeGroup string unions mirror the Prisma enums declared
 * in C1. Kept inline here (not imported from the Prisma client) so
 * `lib/validations/**` stays free of any generated-client dependency
 * per repo convention.
 */
export const ageGroupSchema = z.enum(["A", "B"]);

export const curriculumElementSchema = z.enum([
  "RELIGIOUS_MORAL",
  "IDENTITY",
  "STEAM",
  "MOTOR_SKILLS",
  "ART",
]);

export const promesImportRequestSchema = z.object({
  semesterId: z.string().min(1, "Semester wajib dipilih"),
  ageGroup: ageGroupSchema,
});

export const objectiveCreateSchema = z.object({
  semesterId: z.string().min(1),
  ageGroup: ageGroupSchema,
  element: curriculumElementSchema,
  number: z
    .number()
    .int()
    .min(1, "Nomor tujuan pembelajaran harus ≥ 1")
    .max(999, "Nomor tujuan pembelajaran tidak realistis"),
  competencyText: z
    .string()
    .trim()
    .min(1, "Capaian perkembangan diri wajib diisi")
    .max(2000, "Capaian perkembangan diri terlalu panjang"),
  content: z
    .string()
    .trim()
    .min(1, "Tujuan pembelajaran wajib diisi")
    .max(2000, "Tujuan pembelajaran terlalu panjang"),
});

export const indicatorCreateSchema = z.object({
  // `objectiveId` is resolved server-side after the LearningObjective
  // createMany completes — the parser-derived input shape carries the
  // parent coordinates instead so the route layer can stitch the ids.
  semesterId: z.string().min(1),
  ageGroup: ageGroupSchema,
  element: curriculumElementSchema,
  objectiveNumber: z.number().int().min(1),
  content: z
    .string()
    .trim()
    .min(1, "Indikator (IKTP) wajib diisi")
    .max(2000, "Indikator (IKTP) terlalu panjang"),
  order: z
    .number()
    .int()
    .min(1, "Urutan indikator harus ≥ 1")
    .max(9999, "Urutan indikator tidak realistis"),
});

/**
 * Admin CRUD validators — C3.
 *
 * Identity fields (`semesterId`, `ageGroup`, `element`, `number` on
 * LearningObjective; `objectiveId` on AchievementIndicator) are intentionally
 * omitted: those are the primary handles for cross-referencing rows and
 * editing them silently breaks PROMES re-import diffing + walas-side
 * theme-filtered indicator lookups. Move semantics = deactivate + recreate
 * under the target parent.
 */
export const objectiveUpdateSchema = z.object({
  competencyText: z
    .string()
    .trim()
    .min(1, "Capaian perkembangan diri wajib diisi")
    .max(2000, "Capaian perkembangan diri terlalu panjang")
    .optional(),
  content: z
    .string()
    .trim()
    .min(1, "Tujuan pembelajaran wajib diisi")
    .max(2000, "Tujuan pembelajaran terlalu panjang")
    .optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const indicatorAdminCreateSchema = z.object({
  objectiveId: z.string().min(1, "Tujuan pembelajaran wajib dipilih"),
  content: z
    .string()
    .trim()
    .min(1, "Indikator (IKTP) wajib diisi")
    .max(2000, "Indikator (IKTP) terlalu panjang"),
  order: z
    .number()
    .int()
    .min(1, "Urutan indikator harus ≥ 1")
    .max(9999, "Urutan indikator tidak realistis"),
});

export const indicatorUpdateSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Indikator (IKTP) wajib diisi")
    .max(2000, "Indikator (IKTP) terlalu panjang")
    .optional(),
  order: z
    .number()
    .int()
    .min(1, "Urutan indikator harus ≥ 1")
    .max(9999, "Urutan indikator tidak realistis")
    .optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const indicatorThemeLinkToggleSchema = z.object({
  indicatorId: z.string().min(1, "Indikator wajib dipilih"),
  themeId: z.string().min(1, "Tema wajib dipilih"),
  linked: z.boolean(),
});

export type AgeGroupInput = z.infer<typeof ageGroupSchema>;
export type CurriculumElementInput = z.infer<typeof curriculumElementSchema>;
export type PromesImportRequestInput = z.infer<
  typeof promesImportRequestSchema
>;
export type ObjectiveCreateInput = z.infer<typeof objectiveCreateSchema>;
export type IndicatorCreateInput = z.infer<typeof indicatorCreateSchema>;
export type ObjectiveUpdateInput = z.infer<typeof objectiveUpdateSchema>;
export type IndicatorAdminCreateInput = z.infer<
  typeof indicatorAdminCreateSchema
>;
export type IndicatorUpdateInput = z.infer<typeof indicatorUpdateSchema>;
export type IndicatorThemeLinkToggleInput = z.infer<
  typeof indicatorThemeLinkToggleSchema
>;

// ---------------------------------------------------------------------------
// Admin dialog form schemas (T6, 2026-09-27 admin-finish-standard cycle) —
// derived from the *Update/*Create schemas above so the objectives page's
// three dialogs validate with react-hook-form. Each dialog only shows a
// subset of an already-optional wire field and always fills it, so the form
// schema makes it required with the SAME Indonesian message the wire schema
// carries, instead of leaving it silently optional.
// ---------------------------------------------------------------------------

// Edit TP (Tujuan Pembelajaran) dialog — competencyText + content are the
// only two fields shown, both always filled (`objectiveUpdateSchema`'s own
// optionality exists for partial callers this dialog never is).
export const objectiveEditFormSchema = objectiveUpdateSchema.extend({
  competencyText: z
    .string()
    .trim()
    .min(1, "Capaian perkembangan diri wajib diisi")
    .max(2000, "Capaian perkembangan diri terlalu panjang"),
  content: z
    .string()
    .trim()
    .min(1, "Tujuan pembelajaran wajib diisi")
    .max(2000, "Tujuan pembelajaran terlalu panjang"),
});

// Tambah IKTP dialog — `objectiveId` is a page-level prop, not a rendered
// field, so it's omitted here and spliced into the POST body at submit time
// (mirrors `classFormSchema.omit({ academicYearId: true })`).
export const indicatorAddFormSchema = indicatorAdminCreateSchema
  .omit({ objectiveId: true })
  .extend({
    // `order` is coerced from the <Input type="number">'s string value. The
    // field carries a `required` asterisk, so a blank input must fail with
    // "wajib diisi", not silently collapse to some fallback — mirrors
    // `classFormSchema.capacity` (lib/validations/class.ts).
    order: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.coerce
        .number({ message: "Urutan wajib diisi" })
        .int("Urutan harus bilangan bulat")
        .min(1, "Urutan indikator harus ≥ 1")
        .max(9999, "Urutan indikator tidak realistis"),
    ),
  });

// Edit IKTP dialog — content + order both shown, both always filled.
export const indicatorEditFormSchema = indicatorUpdateSchema.extend({
  content: z
    .string()
    .trim()
    .min(1, "Indikator (IKTP) wajib diisi")
    .max(2000, "Indikator (IKTP) terlalu panjang"),
  order: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce
      .number({ message: "Urutan wajib diisi" })
      .int("Urutan harus bilangan bulat")
      .min(1, "Urutan indikator harus ≥ 1")
      .max(9999, "Urutan indikator tidak realistis"),
  ),
});

export type ObjectiveEditFormInput = z.infer<typeof objectiveEditFormSchema>;
export type IndicatorAddFormInput = z.infer<typeof indicatorAddFormSchema>;
export type IndicatorEditFormInput = z.infer<typeof indicatorEditFormSchema>;

/** Response shape for the preview endpoint (no DB writes). */
export interface PromesPreviewPayload {
  semesterId: string;
  ageGroup: AgeGroupInput;
  inferredAgeGroup: AgeGroupInput | null;
  filename: string;
  byElement: Partial<
    Record<
      CurriculumElementInput,
      Array<{
        number: number;
        competencyText: string;
        content: string;
        indicators: Array<{
          order: number;
          content: string;
          themeNames: string[];
        }>;
      }>
    >
  >;
  counts: {
    objectives: number;
    indicators: number;
  };
  /**
   * IKTP×Tema resolution for the theme-marker columns (cols E+) in the
   * workbook, resolved against the target Semester's `Theme` rows.
   *
   * `matched` counts (indicator × theme) pairs that WOULD be written on
   * commit; `unmatched` lists theme-column names with no `Theme` row in
   * this semester. Unmatched names are non-blocking — the import proceeds
   * and links only the matched themes — but they are the difference
   * between a walas seeing indicators in Penilaian Pekanan and seeing an
   * empty list, so the preview surfaces them prominently.
   */
  themeLinks: {
    matched: number;
    unmatched: string[];
  };
  /**
   * Per-row conflict report. Each entry identifies an existing
   * LearningObjective row that would collide on the
   * (tenantId, semesterId, ageGroup, element, number) unique key.
   *
   * Conflicts are split into two buckets so the admin UI can offer
   * skip-or-reactivate on stale (INACTIVE) rows separately from
   * blocking-only on live (ACTIVE) rows. Preview returns 409 only when
   * `active.length > 0`; commit honours `conflictPolicy` (block / skip /
   * reactivate, default `block`).
   *
   * `ageGroup` is carried explicitly per row — the LearningObjective
   * unique key is (tenantId, semesterId, ageGroup, element, number),
   * so two objectives can share (element, number) if they differ by
   * ageGroup. The admin UI must surface which ageGroup the existing
   * row belongs to so a "TK A re-import" colliding with "TK B" prior
   * data reads correctly.
   */
  conflicts: {
    active: Array<{
      ageGroup: AgeGroupInput;
      element: CurriculumElementInput;
      number: number;
      existingContent: string;
    }>;
    inactive: Array<{
      ageGroup: AgeGroupInput;
      element: CurriculumElementInput;
      number: number;
      existingContent: string;
      existingId: string;
    }>;
  };
}

export type PromesConflictPolicy = "block" | "skip" | "reactivate";

/** Response shape for the commit endpoint. */
export interface PromesCommitPayload {
  semesterId: string;
  ageGroup: AgeGroupInput;
  filename: string;
  conflictPolicy: PromesConflictPolicy;
  counts: {
    objectives: number;
    indicators: number;
  };
  /** Rows actually written or reactivated, broken down by action. */
  applied: {
    created: number;
    reactivated: number;
    skipped: number;
    indicators: number;
    /** IKTP×Tema link rows written (skipDuplicates — re-import is a no-op). */
    themeLinks: number;
    /** Theme-column names with no matching Theme row in this semester. */
    themeLinksUnmatched: string[];
  };
}

/**
 * Parse a Jakarta-tz YYYY-MM-DD string into a UTC-midnight Date. Use this in
 * the API layer when persisting validated dates to the curriculum tables so
 * the schema's TIMESTAMP columns line up with Jakarta calendar days.
 *
 * Pre-validate the input via `ymdSchema` before calling — this helper
 * trusts the format.
 */
export function parseJakartaYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

/**
 * Convert a UTC-midnight DateTime back to Jakarta-tz YYYY-MM-DD for the
 * client. The schema stores TIMESTAMPs that represent Jakarta-day midnight
 * shifted into UTC; for display the API should format via this helper so
 * the wire always carries the same Ymd shape the validators accept.
 */
export function formatJakartaYmd(d: Date): string {
  return getYmdInTimezone(d, JAKARTA_TZ);
}

export type WeekDateRange = {
  id: string;
  startDate: Date | string;
  endDate: Date | string;
  status?: string | null;
};

type CandidateRange = {
  id?: string;
  startDate: Date | string;
  endDate: Date | string;
};

function toYmd(value: Date | string): string {
  // Storage contract: curriculum dates are persisted as UTC-midnight DateTime
  // (see parseJakartaYmd). Reading the UTC YMD off a Prisma-returned Date is
  // therefore the inverse of the write path. Using Jakarta here would shift
  // any future non-UTC-midnight value by +7h and mis-classify the day.
  if (value instanceof Date) return getYmdInTimezone(value, "UTC");
  return value;
}

/**
 * Return the first active Week from `existing` whose date range overlaps
 * `candidate`. Touching boundaries (existing.end === candidate.start) are
 * NOT treated as overlap — Mon–Fri week A can be followed immediately by
 * Mon–Fri week B without conflict.
 *
 * Pass already-filtered `existing` (same parent SubTheme, status ACTIVE).
 * If `candidate.id` is provided, the row with that id is excluded — this
 * makes the helper safe to use on PUT updates.
 *
 * Returns `null` when there is no conflict.
 */
export function findWeekOverlap(
  existing: WeekDateRange[],
  candidate: CandidateRange,
): WeekDateRange | null {
  const cStart = toYmd(candidate.startDate);
  const cEnd = toYmd(candidate.endDate);
  for (const w of existing) {
    if (candidate.id && w.id === candidate.id) continue;
    // Strict allow-list: only rows explicitly tagged ACTIVE participate in
    // the overlap walk. null / undefined / unknown status values are treated
    // as INACTIVE — fail-closed, so a forgotten T5 filter cannot silently
    // promote a tombstoned row into the conflict set.
    if (w.status !== "ACTIVE") continue;
    const wStart = toYmd(w.startDate);
    const wEnd = toYmd(w.endDate);
    // Half-open overlap: ranges [wStart, wEnd) and [cStart, cEnd). Touching
    // boundaries do not collide. Pure lexicographic compare is safe because
    // both sides are zero-padded YYYY-MM-DD.
    if (wStart < cEnd && cStart < wEnd) return w;
  }
  return null;
}
