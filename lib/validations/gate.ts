import { z } from "zod";
import { pickedUpByRelationEnum } from "@/lib/validations/student-attendance";

/**
 * Gerbang (gate) mode — one tap per child. `undo_*` reverses the last tap
 * (product principle: undo over "are you sure").
 */
export const gateActionEnum = z.enum([
  "arrive",
  "pickup",
  "undo_arrive",
  "undo_pickup",
]);

export const gateActionSchema = z
  .object({
    studentId: z.string().min(1, "Siswa wajib dipilih"),
    action: gateActionEnum,
    campusId: z.string().min(1).optional(),
    relation: pickedUpByRelationEnum.optional(),
    name: z.string().trim().max(120).optional().nullable(),
  })
  .refine(
    (v) =>
      v.action !== "pickup" ||
      v.relation !== "OTHER" ||
      (!!v.name && v.name.trim().length > 0),
    {
      message: "Nama penjemput wajib diisi bila hubungan dipilih Lainnya",
      path: ["name"],
    },
  );

export type GateActionInput = z.infer<typeof gateActionSchema>;
