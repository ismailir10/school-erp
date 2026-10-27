import { z } from "zod";

// Zod schemas for the consolidated /admin/classes surface. A "Class" in this
// API is a single per-year row (Prisma `ClassSection`). The cross-year
// `ClassTrack` is silent plumbing: POST find-or-creates it from
// (tenantId, campusId, programId, name) on the caller's behalf.

export const SLOT_TEMPLATES = ["FULL_DAY", "MORNING_AND_AFTERNOON"] as const;

// Kelompok usia (A = 4-5 yo / B = 5-6 yo). Mirrors Prisma enum `AgeGroup`.
// Promoted 2026-05-20 from the legacy `deriveAgeGroup` name-heuristic to an
// explicit required field — drives walas-weekly + sentra cohort + perkembangan.
export const ageGroupSchema = z.enum(["A", "B"]);

const namePiece = z
  .string()
  .trim()
  .min(1, "Nama kelas wajib diisi")
  .max(120, "Nama kelas terlalu panjang");

const capacityPiece = z
  .number()
  .int("Kapasitas harus bilangan bulat")
  .min(1, "Kapasitas minimal 1")
  .max(200, "Kapasitas maksimal 200");

export const classCreateSchema = z.object({
  campusId: z.string().min(1, "Kampus wajib dipilih"),
  programId: z.string().min(1, "Program wajib dipilih"),
  academicYearId: z.string().min(1, "Tahun ajaran wajib dipilih"),
  name: namePiece,
  capacity: capacityPiece,
  slotTemplate: z.enum(SLOT_TEMPLATES).default("FULL_DAY"),
  ageGroup: ageGroupSchema,
});

export const classUpdateSchema = z.object({
  name: namePiece.optional(),
  // Moves the class to another program (and so to that program's fee
  // structure). Guarded server-side: ACTIVE program of the same tenant, and
  // refused once the class's students hold invoices this year.
  programId: z.string().min(1, "Program wajib dipilih").optional(),
  capacity: capacityPiece.optional(),
  slotTemplate: z.enum(SLOT_TEMPLATES).optional(),
  ageGroup: ageGroupSchema.optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const enrollmentAddSchema = z.object({
  studentId: z.string().min(1, "Siswa wajib dipilih"),
});

export const teachingAssignmentAddSchema = z.object({
  employeeId: z.string().min(1, "Guru wajib dipilih"),
  role: z.enum(["HOMEROOM", "ASSISTANT"]).default("HOMEROOM"),
});

// Client form schema for the Tambah/Ubah Kelas dialog (T3, 2026-09-27
// admin-forms-rhf cycle). The dialog has no Tahun Ajaran field of its own —
// `academicYearId` comes from the list page's year switcher and is spliced
// into the POST body at submit time — so the form omits it entirely rather
// than carrying a divergent copy of `classCreateSchema`.
export const classFormSchema = classCreateSchema.omit({ academicYearId: true }).extend({
  // `capacity` is coerced from the <Input type="number">'s string value.
  // `z.coerce.number()` alone turns an emptied input ("") into `0`
  // (`Number("") === 0`), which would silently fail as "Kapasitas minimal 1"
  // instead of naming the real problem — so empty/null first collapses to
  // `undefined`, which fails the base type check with a proper "wajib
  // diisi" message (mirrors `lib/validations/campus.ts`'s
  // `optionalCoercedNumber`). Explicitly typed preprocess input (`string |
  // number`) — bare `z.coerce.number()` lets TS default the input type to
  // `unknown`, which then fails to satisfy `<Input value>`'s prop type.
  capacity: z.preprocess(
    (v: string | number | undefined) => (v === "" ? undefined : v),
    z.coerce
      .number({ message: "Kapasitas wajib diisi" })
      .int("Kapasitas harus bilangan bulat")
      .min(1, "Kapasitas minimal 1")
      .max(200, "Kapasitas maksimal 200"),
  ),
  // Custom message so an unfilled Select doesn't surface zod's default
  // English "Invalid option" text — matches the previous inline
  // `if (!form.ageGroup) toast.error("Kelompok usia wajib dipilih")` check.
  ageGroup: z.enum(["A", "B"], { message: "Kelompok usia wajib dipilih" }),
});

// Client form schema for the class-detail "Ubah Kelas" dialog (T2, 2026-09-27
// admin-finish-standard cycle). That dialog only edits name/capacity/
// slotTemplate — no campus/program/ageGroup fields — so it picks the same
// three keys off `classFormSchema` rather than redefining the capacity
// blank-handling preprocessor a second time.
export const classEditFormSchema = classFormSchema.pick({
  name: true,
  capacity: true,
  slotTemplate: true,
});

export type ClassCreateInput = z.infer<typeof classCreateSchema>;
export type ClassUpdateInput = z.infer<typeof classUpdateSchema>;
export type ClassFormInput = z.infer<typeof classFormSchema>;
export type ClassEditFormInput = z.infer<typeof classEditFormSchema>;
export type EnrollmentAddInput = z.infer<typeof enrollmentAddSchema>;
export type TeachingAssignmentAddInput = z.infer<
  typeof teachingAssignmentAddSchema
>;
