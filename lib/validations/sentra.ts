import { z } from "zod";

// Zod schemas for the admin Sentra surface (sentra list, putaran, grid).

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal mulai tidak valid")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Tanggal mulai tidak valid");

const sentraName = z
  .string()
  .trim()
  .min(1, "Nama sentra wajib diisi")
  .max(40, "Nama sentra maksimal 40 karakter");

const teacherIds = z
  .array(z.string().min(1))
  .max(10, "Maksimal 10 guru sentra");

const sortOrder = z.number().int().min(0).max(1000);

export const sentraCreateSchema = z.object({
  campusId: z.string().min(1, "Kampus wajib dipilih"),
  name: sentraName,
  teacherIds,
  sortOrder: sortOrder.optional(),
});

export const sentraUpdateSchema = z.object({
  name: sentraName.optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  sortOrder: sortOrder.optional(),
  teacherIds: teacherIds.optional(),
});

const rotationName = z
  .string()
  .trim()
  .min(1, "Nama putaran wajib diisi")
  .max(60, "Nama putaran maksimal 60 karakter");

const cycleDays = z
  .number()
  .int("Jumlah hari harus bilangan bulat")
  .min(1, "Jumlah hari minimal 1")
  .max(40, "Jumlah hari maksimal 40");

const classSectionIds = z
  .array(z.string().min(1))
  .min(1, "Pilih minimal satu kelas")
  .max(20, "Maksimal 20 kelas");

export const rotationCreateSchema = z.object({
  campusId: z.string().min(1, "Kampus wajib dipilih"),
  academicYearId: z.string().min(1, "Tahun ajaran wajib dipilih"),
  name: rotationName,
  startDate: ymd,
  cycleDays,
  classSectionIds,
});

export const rotationUpdateSchema = z.object({
  name: rotationName.optional(),
  startDate: ymd.optional(),
  cycleDays: cycleDays.optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  classSectionIds: classSectionIds.optional(),
});

export const rotationSlotsSchema = z.object({
  slots: z
    .array(
      z.object({
        dayIndex: z.number().int().min(0),
        classSectionId: z.string().min(1),
        sentraId: z.string().min(1).nullable(),
      }),
    )
    .max(40 * 20, "Terlalu banyak sel"),
});

export type SentraCreateInput = z.infer<typeof sentraCreateSchema>;
export type SentraUpdateInput = z.infer<typeof sentraUpdateSchema>;
export type RotationCreateInput = z.infer<typeof rotationCreateSchema>;
export type RotationUpdateInput = z.infer<typeof rotationUpdateSchema>;
export type RotationSlotsInput = z.infer<typeof rotationSlotsSchema>;
