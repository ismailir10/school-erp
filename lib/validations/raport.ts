import { z } from "zod";

/**
 * Validation schemas for the admin raport MVP (C8).
 * User-facing copy is Indonesian; field identifiers are English.
 */

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus berformat YYYY-MM-DD");

export const achievementLevelSchema = z.enum([
  "CONSISTENT",
  "EMERGING",
  "NEEDS_REINFORCEMENT",
]);

/** Level-bearing narrative sections (the 5 bucketed sections). */
export const bucketedSectionSchema = z.enum([
  "INTRODUCTION",
  "RELIGIOUS_MORAL",
  "IDENTITY",
  "STEAM",
  "PERFORMANCE_SHOWCASE",
]);

/** All raport sections (bucketed + closing) — narratives may be set on any. */
export const reportSectionSchema = z.enum([
  "INTRODUCTION",
  "RELIGIOUS_MORAL",
  "IDENTITY",
  "STEAM",
  "PERFORMANCE_SHOWCASE",
  "CLOSING",
  "FOLLOW_UP_PLAN",
  "HOME_ACTIVITIES",
]);

// ── Term ─────────────────────────────────────────────────────

export const termCreateSchema = z
  .object({
    semesterId: z.string().min(1, "Semester wajib diisi"),
    number: z.union([z.literal(1), z.literal(2)]),
    startDate: ymd,
    endDate: ymd,
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
    path: ["endDate"],
  });

export const termUpdateSchema = z
  .object({
    number: z.union([z.literal(1), z.literal(2)]).optional(),
    startDate: ymd.optional(),
    endDate: ymd.optional(),
  })
  .refine(
    (v) =>
      v.startDate === undefined ||
      v.endDate === undefined ||
      v.endDate >= v.startDate,
    { message: "Tanggal selesai tidak boleh sebelum tanggal mulai", path: ["endDate"] },
  );

// ── Report card entry upsert ─────────────────────────────────

const dayCount = z
  .number({ message: "Harus berupa angka" })
  .int("Harus bilangan bulat")
  .min(0, "Tidak boleh negatif")
  .max(366, "Maksimal 366 hari");

// Attendance counts — shared by the PUT schema and the admin editor so both
// reject the same impossible values (ACAD-1: sickDays=99 with 4 school days
// was accepted and published to parents). Each of Sakit / Izin / Alpa must fit
// inside Hari sekolah, and so must their sum.
const attendanceShape = {
  permittedAbsenceDays: dayCount,
  sickDays: dayCount,
  unexcusedAbsenceDays: dayCount,
  totalSchoolDays: dayCount,
};

type AttendanceCounts = { [K in keyof typeof attendanceShape]: number };

const ATTENDANCE_LABELS = {
  sickDays: "Sakit",
  permittedAbsenceDays: "Izin",
  unexcusedAbsenceDays: "Alpa",
} as const;

function refineAttendanceCounts(v: AttendanceCounts, ctx: z.RefinementCtx) {
  let anyOver = false;
  for (const key of Object.keys(ATTENDANCE_LABELS) as (keyof typeof ATTENDANCE_LABELS)[]) {
    if (v[key] > v.totalSchoolDays) {
      anyOver = true;
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `${ATTENDANCE_LABELS[key]} (${v[key]}) tidak boleh melebihi hari sekolah (${v.totalSchoolDays})`,
      });
    }
  }
  const sum = v.sickDays + v.permittedAbsenceDays + v.unexcusedAbsenceDays;
  if (!anyOver && sum > v.totalSchoolDays) {
    ctx.addIssue({
      code: "custom",
      path: ["totalSchoolDays"],
      message: `Jumlah sakit, izin, dan alpa (${sum}) melebihi hari sekolah (${v.totalSchoolDays})`,
    });
  }
}

// Height / weight — shared by the PUT schema and the admin editor (ADM-14).
// Indonesian messages (these surfaced as raw English zod text). Nullable and
// optional: a raport can be saved and published with both blank.
const measurementShape = {
  heightCm: z
    .number({ message: "Harus berupa angka" })
    .positive("Harus lebih dari 0")
    .max(250, "Tinggi maksimal 250 cm")
    .optional()
    .nullable(),
  weightKg: z
    .number({ message: "Harus berupa angka" })
    .positive("Harus lebih dari 0")
    .max(200, "Berat maksimal 200 kg")
    .optional()
    .nullable(),
};

/** Measurements on their own — what the admin editor validates before saving. */
export const raportMeasurementSchema = z.object(measurementShape);

/** Attendance block on its own — what the admin editor validates before saving. */
export const raportAttendanceSchema = z.object(attendanceShape).superRefine(refineAttendanceCounts);

export const raportUpsertSchema = z
  .object({
    // Partial maps keyed by section (zod v4 `record` with an enum key is
    // exhaustive — `partialRecord` allows a subset). Bucketed sections carry a
    // level; any section may carry a narrative. Closing sections never carry a level.
    sectionLevels: z.partialRecord(bucketedSectionSchema, achievementLevelSchema),
    sectionNarratives: z.partialRecord(reportSectionSchema, z.string().max(10_000)),

    ...attendanceShape,

    parentMeetingAttendance: z
      .record(z.string().max(50), z.string().max(200).nullable())
      .optional()
      .nullable(),
    memorizationNotes: z.string().max(10_000).optional().nullable(),
    homeroomTeacherId: z.string().optional().nullable(),

    ...measurementShape,
  })
  .superRefine(refineAttendanceCounts);

export type RaportUpsertInput = z.infer<typeof raportUpsertSchema>;
