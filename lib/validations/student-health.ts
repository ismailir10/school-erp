import { z } from "zod";

export const HEALTH_LIMITS: Record<string, { max: number; integer?: boolean; label: string }> = {
  weightKg: { max: 200, label: "Berat badan" },
  heightCm: { max: 250, label: "Tinggi badan" },
  headCircumferenceCm: { max: 100, label: "Lingkar kepala" },
  siblingsKandung: { max: 50, integer: true, label: "Jumlah saudara kandung" },
  siblingsTiri: { max: 50, integer: true, label: "Jumlah saudara tiri" },
  siblingsAngkat: { max: 50, integer: true, label: "Jumlah saudara angkat" },
  siblingsTotal: { max: 50, integer: true, label: "Jumlah saudara" },
  childOrder: { max: 50, integer: true, label: "Anak ke-" },
};
export const studentHealthMetadataSchema = z.record(z.string(), z.unknown()).superRefine((data, ctx) => {
  for (const [key, rule] of Object.entries(HEALTH_LIMITS)) {
    const value = data[key];
    if (value === undefined || value === null || value === "") continue;
    const number = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(number) || number < 0 || number > rule.max || (rule.integer && !Number.isInteger(number))) {
      ctx.addIssue({ code: "custom", path: [key], message: `${rule.label} harus ${rule.integer ? "bilangan bulat " : ""}antara 0 dan ${rule.max}.` });
    }
  }
});
