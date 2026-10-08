import { z } from "zod";
import { componentCodeSchema } from "./component-code";

/**
 * SalaryComponentDef.category — canonical enum. The payroll engine filters
 * lines on these exact values; the pre-2026-05-14 regression (FIND-006)
 * accepted any string so a typo like "EARNING" silently disappeared from
 * payroll calc. Tightening at the API boundary catches it server-side.
 */
export const salaryCategorySchema = z.enum(["INCOME", "DEDUCTION"], {
  message: "Kategori tidak valid",
});
// F-15 (cycle 2026-09-27-admin-finish-standard): POST used to accept only
// FIXED | ATTENDANCE_BASED even though the engine (lib/payroll/engine.ts),
// PUT and seed data all use PCT_OF_BASE — a bug, not a scope boundary.
// Widened here; the routes enforce the `gaji_pokok` sortOrder ordering rule
// (F-15) so a PCT_OF_BASE component can never be miscalculated against 0.
export const salaryCalcTypeSchema = z.enum(["FIXED", "PCT_OF_BASE", "ATTENDANCE_BASED"], {
  message: "Tipe kalkulasi tidak valid",
});

export const createSalaryComponentSchema = z.object({
  code: componentCodeSchema,
  label: z.string().trim().min(1, "Label wajib diisi"),
  category: salaryCategorySchema,
  calcType: salaryCalcTypeSchema,
  isProRated: z.boolean().optional(),
  sortOrder: z.number().int("Urutan harus bilangan bulat").nonnegative("Urutan tidak boleh negatif").optional(),
});

export type CreateSalaryComponentInput = z.infer<typeof createSalaryComponentSchema>;

// Admin create/edit dialog form. Reused for both — `code` is hidden once
// editing, seeded from the existing row via `reset` so it stays valid.
// `calcType` no longer needs its own override: `createSalaryComponentSchema`
// already accepts PCT_OF_BASE (see `salaryCalcTypeSchema` above). `sortOrder`
// is still overridden because it arrives as a string from the number input.
export const salaryComponentFormSchema = createSalaryComponentSchema.extend({
  sortOrder: z.coerce
    .number({ message: "Urutan harus berupa angka" })
    .int("Urutan harus bilangan bulat")
    .nonnegative("Urutan tidak boleh negatif")
    .optional(),
});

// PUT /api/salary-components/[id] — every editable field is optional so the
// existing `{ isEnabled }`-only toggle body keeps working (the route builds
// its update `data` from whichever keys parsed non-undefined). A full edit
// submission from the dialog sends every field; `code` is not editable and
// is not part of this schema (an extra `code` key on the wire is ignored by
// `validateBody`, which only reads the fields it declares).
export const updateSalaryComponentSchema = z.object({
  label: z.string().trim().min(1, "Label wajib diisi").optional(),
  category: salaryCategorySchema.optional(),
  calcType: salaryCalcTypeSchema.optional(),
  isProRated: z.boolean().optional(),
  sortOrder: z.number().int("Urutan harus bilangan bulat").nonnegative("Urutan tidak boleh negatif").optional(),
  isEnabled: z.boolean().optional(),
});

export type UpdateSalaryComponentInput = z.infer<typeof updateSalaryComponentSchema>;

// PayrollRun.periodStart / periodEnd are stored as String (YYYY-MM-DD) per
// prisma schema — validate as ISO date-only strings, not coerced Date objects.
const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD");

/** Inclusive calendar-day count of a YYYY-MM-DD period (end >= start). */
export function calendarDaysInPeriod(periodStart: string, periodEnd: string): number {
  const start = new Date(`${periodStart}T00:00:00Z`).getTime();
  const end = new Date(`${periodEnd}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

/** HRX-3: the one message for a Hari Kerja Aktual outside 1..days-in-period. */
export function actualWorkDaysRangeMessage(maxDays: number): string {
  return `Hari kerja aktual harus antara 1 dan ${maxDays} hari.`;
}

// HRX-3: the lower bound is here; the upper bound needs the run's period, so
// the PUT route (and the edit form's refine below) check it against
// `calendarDaysInPeriod`.
export const updatePayrollRunSchema = z
  .object({
    periodStart: isoDateString.optional(),
    periodEnd: isoDateString.optional(),
    actualWorkDays: z
      .number()
      .int("Hari kerja aktual harus bilangan bulat")
      .min(1, "Hari kerja aktual minimal 1 hari")
      .optional(),
  })
  .refine(
    (v) =>
      v.periodStart !== undefined ||
      v.periodEnd !== undefined ||
      v.actualWorkDays !== undefined,
    { message: "Minimal satu field harus diisi" }
  )
  .refine(
    (v) =>
      v.periodStart === undefined ||
      v.periodEnd === undefined ||
      v.periodStart <= v.periodEnd,
    { message: "Tanggal mulai periode harus sebelum atau sama dengan tanggal selesai", path: ["periodStart"] }
  );

export type UpdatePayrollRunInput = z.infer<typeof updatePayrollRunSchema>;

// Hard cap on payroll period length. A school payroll spans at most one
// month — values beyond that are almost always typos and would cause the
// engine to scan O(employees * days) attendance rows for nothing.
const MAX_PERIOD_DAYS = 45;

export const generatePayrollSchema = z
  .object({
    periodStart: isoDateString,
    periodEnd: isoDateString,
  })
  .refine((v) => v.periodStart <= v.periodEnd, {
    message: "Tanggal mulai periode harus sebelum atau sama dengan tanggal selesai",
    path: ["periodStart"],
  })
  .refine(
    (v) => {
      const start = new Date(`${v.periodStart}T00:00:00Z`);
      const end = new Date(`${v.periodEnd}T00:00:00Z`);
      const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
      return days > 0 && days <= MAX_PERIOD_DAYS;
    },
    {
      message: `Rentang periode harus 1–${MAX_PERIOD_DAYS} hari`,
      path: ["periodEnd"],
    }
  );

export type GeneratePayrollInput = z.infer<typeof generatePayrollSchema>;

// PUT /api/payroll/[id]/items/[itemId]/lines/[lineId] — manual line adjustment.
// Mirrors adjustInvoiceLineSchema; amount 0 clears a previous adjustment.
//
// HRX-4/FINX-2: whole rupiah within ±1 miljar — a fractional amount breaks the
// BSI integer export and 1e15 overflowed the Decimal column (500). The "line may
// not go negative" rule needs the line's base amount, so the route owns it.
export const MAX_PAYROLL_ADJUSTMENT = 1_000_000_000;
const adjustmentAmountField = z
  .number()
  .finite("Jumlah penyesuaian tidak valid")
  .int("Penyesuaian harus bilangan bulat (tanpa desimal)")
  .min(-MAX_PAYROLL_ADJUSTMENT, "Penyesuaian maksimal Rp 1.000.000.000")
  .max(MAX_PAYROLL_ADJUSTMENT, "Penyesuaian maksimal Rp 1.000.000.000");

export const adjustPayrollLineSchema = z.object({
  adjustmentAmount: adjustmentAmountField,
  adjustmentNote: z.string().trim().min(1, "Catatan penyesuaian wajib diisi"),
});

export type AdjustPayrollLineInput = z.infer<typeof adjustPayrollLineSchema>;

// Admin dialog form for the line adjustment above — the same rule, except
// `adjustmentAmount` arrives as a string from <Input type="number"> (an
// empty box means "no adjustment", matching the route's prior
// `parseFloat(adjAmount) || 0` — z.coerce.number() already turns "" into 0,
// so no separate blank case is needed here).
export const adjustPayrollLineFormSchema = adjustPayrollLineSchema.extend({
  adjustmentAmount: z.coerce
    .number({ message: "Jumlah penyesuaian harus berupa angka" })
    .finite("Jumlah penyesuaian tidak valid")
    .int("Penyesuaian harus bilangan bulat (tanpa desimal)")
    .min(-MAX_PAYROLL_ADJUSTMENT, "Penyesuaian maksimal Rp 1.000.000.000")
    .max(MAX_PAYROLL_ADJUSTMENT, "Penyesuaian maksimal Rp 1.000.000.000"),
});

// PUT /api/payroll/[id]/items/[itemId]/variables — had no schema at all
// (route read `body.overtimeHours ?? 0` etc. with no type check, and every
// field is optional — the route is called with a partial body in practice,
// e.g. the atomic-rebuild test posts only `{ overtimeHours }`). These
// counts are optional-with-default-0 in the UI (no asterisk, no minimum
// ever enforced), so a missing/blank field collapsing to 0 here is the
// *intended* behavior, matching the pre-migration `parseFloat(...) || 0`
// per-keystroke coercion and the route's own `?? 0` exactly — not the
// "required field silently defaults" trap. Decimal(5,2) bounds
// overtimeHours at the database column.
function payrollVariableField(fieldLabel: string, { integer }: { integer: boolean }) {
  const base = integer
    ? z.coerce.number({ message: `${fieldLabel} harus berupa angka` }).int(`${fieldLabel} harus bilangan bulat`)
    : z.coerce.number({ message: `${fieldLabel} harus berupa angka` }).finite(`${fieldLabel} harus berupa angka`);
  // HRX-4: the exact ceiling is the run's days-in-period (checked in the
  // variables route); MAX_PERIOD_DAYS keeps absurd values out of the Int column.
  return z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? 0 : v),
    base
      .nonnegative(`${fieldLabel} tidak boleh negatif`)
      .max(MAX_PERIOD_DAYS, `${fieldLabel} maksimal ${MAX_PERIOD_DAYS} hari`),
  );
}

export const payrollVariablesSchema = z.object({
  overtimeHours: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? 0 : v),
    z.coerce
      .number({ message: "Jam lembur harus berupa angka" })
      .finite("Jam lembur harus berupa angka")
      .nonnegative("Jam lembur tidak boleh negatif")
      .max(999.99, "Jam lembur maksimal 999.99"),
  ),
  outdoorDays: payrollVariableField("Hari outdoor", { integer: true }),
  holidayWorkedDays: payrollVariableField("Hari libur kerja", { integer: true }),
  dcDays: payrollVariableField("Hari DC", { integer: true }),
});

export type PayrollVariablesInput = z.infer<typeof payrollVariablesSchema>;

// Client form schema for the payroll/[id] period-edit card (T6, 2026-09-27
// admin-finish-standard cycle). The edit card always shows and always sends
// all three fields (never a partial patch), so this narrows
// `updatePayrollRunSchema`'s optionality to "always present": that alone
// satisfies its "minimal satu field harus diisi" object-level refine (never
// re-declared here — with every field required it can never fire), and lets
// the periodStart<=periodEnd cross-check keep the same field path
// (`periodStart`) the wire schema already uses. `actualWorkDays` used to
// reach the route as `parseInt(...) || 0`, silently turning a cleared input
// into a valid 0 — preprocessing blank to `undefined` first makes it fail
// with "wajib diisi" instead (mirrors `classFormSchema.capacity`).
export const payrollEditFormSchema = z
  .object({
    periodStart: isoDateString,
    periodEnd: isoDateString,
    actualWorkDays: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.coerce
        .number({ message: "Hari kerja aktual wajib diisi" })
        .int("Hari kerja aktual harus bilangan bulat")
        .min(1, "Hari kerja aktual minimal 1 hari"),
    ),
  })
  .refine((v) => v.periodStart <= v.periodEnd, {
    message: "Tanggal mulai periode harus sebelum atau sama dengan tanggal selesai",
    path: ["periodStart"],
  })
  .superRefine((v, ctx) => {
    if (v.periodStart > v.periodEnd) return; // reported by the refine above
    const maxDays = calendarDaysInPeriod(v.periodStart, v.periodEnd);
    if (v.actualWorkDays > maxDays) {
      ctx.addIssue({
        code: "custom",
        message: actualWorkDaysRangeMessage(maxDays),
        path: ["actualWorkDays"],
      });
    }
  });

export type PayrollEditFormInput = z.infer<typeof payrollEditFormSchema>;
