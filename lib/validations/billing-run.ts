import { z } from "zod";
import { MAX_FEE_AMOUNT } from "@/lib/validations/fee-structure";

// Billing Run wizard (bulk invoice wizard arc, Cycle B1 —
// docs/cycles/2026-08-14-billing-run-wizard.md). A `BillingRun` is a
// persisted draft between scope selection (step 1) and commit (step 3).
// Conventions follow `lib/validations/student-fee-adjustment.ts`.

// Same YYYY-MM-DD convention as `generatePlanSchema`/`generateBatchSchema`
// in lib/validations/invoice.ts.
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal jatuh tempo harus YYYY-MM-DD");

// Step 1 (Scope). `classSectionIds` and `includeStudentIds` together define
// the in-scope student set; `excludeStudentIds` removes from that set. A
// payload with both `classSectionIds` and `includeStudentIds` empty would
// silently scope to nobody — or, if a caller instead reads "empty scope" as
// "everyone" somewhere downstream, silently bill the entire tenant. Neither
// reading is safe, so an explicit non-empty scope is required up front.
export const createBillingRunSchema = z
  .object({
    periodLabel: z.string().min(1, "Periode wajib diisi"),
    dueDate: dateSchema,
    academicYearId: z.string().min(1, "Tahun ajaran wajib dipilih"),
    classSectionIds: z.array(z.string().min(1)).default([]),
    includeStudentIds: z.array(z.string().min(1)).default([]),
    excludeStudentIds: z.array(z.string().min(1)).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.classSectionIds.length === 0 && data.includeStudentIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pilih minimal satu kelas atau siswa untuk ditagih",
        path: ["classSectionIds"],
      });
    }
  });

// Step 2 (Review). Exclude / re-include a single row — this cycle only,
// per the Cycle B1 spec (no other row mutation is exposed yet).
export const updateBillingRunRowSchema = z.object({
  status: z.enum(["PENDING", "EXCLUDED"]),
});

// Step 3 (Commit). One chunk of row ids per call — capped at 25 to match
// the existing bulk-generate batch chunk cap (`generateBatchSchema` in
// lib/validations/invoice.ts).
export const commitBillingRunSchema = z.object({
  rowIds: z
    .array(z.string().min(1))
    .min(1, "Pilih minimal satu baris untuk dikomit")
    .max(25, "Maksimal 25 baris per batch"),
});

// Cancel a draft — a status flip, no DELETE (per the T5 route spec).
export const cancelBillingRunSchema = z.object({
  status: z.literal("CANCELLED"),
});

// Cycle B2 (docs/cycles/2026-08-14-billing-run-wizard-b2.md, Task T1) —
// editable step 2: add a line, edit a line, rebuild the draft.

// Whole rupiah only (Assumption 7) — no cents to enter. Shared by the
// create-line `amount` and the update-line `finalAmount`; the latter is
// additionally allowed to go negative (a MANUAL discount line), so the sign
// constraint is layered on top per schema rather than baked in here.
//
// Bounded to ±MAX_FEE_AMOUNT (Rp 10 miliar): the line columns are
// numeric(15,2), and a larger value used to reach Postgres and come back as a
// bare 500 "Gagal menyimpan perubahan baris" (FINX-2).
const integerAmountSchema = z
  .number("Jumlah harus berupa angka")
  .int("Jumlah harus berupa bilangan bulat (Rupiah)")
  .max(MAX_FEE_AMOUNT, "Nominal maksimal Rp 10.000.000.000")
  .min(-MAX_FEE_AMOUNT, "Nominal minimal -Rp 10.000.000.000");

// Step 2 (Review, editable). Add a line to a row — either pulled from the
// FeeComponentDef catalog or an ad-hoc discount (Assumption 3: the discount
// still hangs off a lazily-created system component server-side, but the
// client never picks one for DISCOUNT mode). `amount` is always a
// non-negative magnitude in both modes — CATALOG amounts price a component,
// DISCOUNT amounts are the size of the credit; the route applies the sign
// (Cycle A's "type carries the sign, value is a positive magnitude"
// convention, mirrored from `student-fee-adjustment.ts`).
export const createBillingRunLineSchema = z
  .object({
    mode: z.enum(["CATALOG", "DISCOUNT"]),
    feeComponentId: z.string().trim().min(1).optional(),
    label: z.string().trim().min(1, "Label wajib diisi"),
    amount: integerAmountSchema.nonnegative("Jumlah tidak boleh negatif"),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "CATALOG" && !data.feeComponentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Komponen biaya wajib dipilih",
        path: ["feeComponentId"],
      });
    }
    if (data.mode === "DISCOUNT" && data.feeComponentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Komponen biaya tidak berlaku untuk potongan manual",
        path: ["feeComponentId"],
      });
    }
  });

// Step 2 (Review, editable). Edit an existing line's final (parent-visible)
// amount — never the fee-structure `amount` snapshot (Assumption 1). A
// BASE/ADJUSTMENT/EDITED line cannot go negative (enforced downstream in
// lib/finance/billing-run-lines.ts, which knows the line's `source` and this
// schema does not); a MANUAL line may. `note` is nullable-and-optional so a
// note can be explicitly cleared — Cycle A hit this exact bug with
// validFrom/validTo (docs/cycles/2026-08-13-keringanan-fee-adjustments.md
// T4) and the fix was `.nullable().optional()`, not `.optional()` alone.
export const updateBillingRunLineSchema = z.object({
  finalAmount: integerAmountSchema,
  label: z.string().trim().min(1, "Label wajib diisi").optional(),
  note: z.string().trim().max(500, "Maks 500 karakter").nullable().optional(),
});

// Step 3 (Commit). Explicit confirmation payload for a rebuild — an empty
// POST body must never trigger one, because a rebuild discards every manual
// edit on the draft (Assumption 6).
export const rebuildBillingRunSchema = z.object({
  confirm: z.literal(true),
});

export type CreateBillingRunInput = z.infer<typeof createBillingRunSchema>;
export type UpdateBillingRunRowInput = z.infer<typeof updateBillingRunRowSchema>;
export type CommitBillingRunInput = z.infer<typeof commitBillingRunSchema>;
export type CancelBillingRunInput = z.infer<typeof cancelBillingRunSchema>;
export type CreateBillingRunLineInput = z.infer<typeof createBillingRunLineSchema>;
export type UpdateBillingRunLineInput = z.infer<typeof updateBillingRunLineSchema>;
export type RebuildBillingRunInput = z.infer<typeof rebuildBillingRunSchema>;
