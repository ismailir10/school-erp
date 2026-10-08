import { z } from "zod";
import { partialWithoutDefaults } from "./zod-helpers";
import { cleanText, labelText, nameText } from "./text";

// F-10 (cycle 2026-05-13 staging-sweep-majors-cycle1): Bank and Rekening must
// be either both set or both empty. The sweep found Ismail Teacher Test had
// `bank="Bank BSI"` and `bankAccountNo=NULL`, which would emit an invalid
// row to the BSI bulk-export CSV at payroll time. Treat empty/whitespace
// strings as "not set" so a stray space doesn't pass the check.
function isFilled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function refineBankAccountPair<T extends { bankName?: string | null; bankAccountNo?: string | null }>(
  data: T,
  ctx: z.RefinementCtx,
): void {
  const bank = isFilled(data.bankName);
  const acct = isFilled(data.bankAccountNo);
  if (bank && !acct) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bankAccountNo"],
      message: "No. Rekening wajib diisi jika bank dipilih",
    });
  }
  if (acct && !bank) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bankName"],
      message: "Bank wajib dipilih jika No. Rekening diisi",
    });
  }
}

// Base shape — kept unrefined so we can derive a partial below without
// fighting zod's ZodEffects unwrapping.
const employeeBaseObject = z.object({
  nama: nameText({ required: "Nama wajib diisi" }),
  formalName: nameText().optional().nullable(),
  email: z.string().min(1, "Email wajib diisi").email("Email tidak valid").max(254, "Maksimal 254 karakter."),
  noHp: cleanText({ max: 30, singleLine: true }).optional().nullable(),
  jabatan: labelText({ required: "Jabatan wajib diisi" }),
  campusId: z.string().min(1, "Kampus wajib dipilih"),
  hireDate: z.string().min(1, "Tanggal masuk wajib diisi"),
  bankName: labelText({ max: 100 }).optional().nullable(),
  bankAccountNo: cleanText({ max: 50, singleLine: true }).optional().nullable(),
  bpjsEnrolled: z.boolean().default(false),
  // CRUD correctness audit R1: starting leave balances were not settable from
  // any form — the Employee row always took the schema defaults (12 / 14).
  // Mid-year hires and carry-over policies need an explicit starting value.
  // Optional + coerced so an empty HTML number input omits the key (Prisma
  // applies the @default on create; PUT leaves the column untouched) rather
  // than writing 0.
  // Preprocess so an empty/blank HTML number input ("" / null) short-circuits
  // to undefined — without it z.coerce.number("") would land 0 and overwrite
  // the default/existing balance. Same pattern as guardian.childOrder.
  leaveBalanceAnnual: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().min(0).max(365).optional(),
  ),
  leaveBalanceSick: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().min(0).max(365).optional(),
  ),
  // F-26: caller-supplied role for the auto-created `User` row. Previously
  // hard-coded to `TEACHER`, which prevented HR from creating non-teaching
  // staff (admin/finance/etc.) through the employee form. Only TEACHER and
  // SCHOOL_ADMIN are accepted here — GUARDIAN is the parent role and is not
  // an employee. SUPER_ADMIN is intentionally excluded; promoting an
  // employee to SUPER_ADMIN must go through a deliberate admin-side flow.
  role: z.enum(["TEACHER", "SCHOOL_ADMIN"]).default("TEACHER"),
});

export const createEmployeeSchema = employeeBaseObject.superRefine(refineBankAccountPair);

// F-13 fix: `status` is intentionally NOT extended onto the partial schema.
// PUT /api/employees/[id] must not accept `status` writes — that path was the
// bug enabling silent re-activation by sending `{status:"ACTIVE"}`. Status
// transitions go through the dedicated POST /deactivate and /restore
// endpoints which carry permission checks, audit logging, and rate limits.
// Zod's default `.strip()` mode drops unknown keys silently, so a stray
// `status` field on a PUT body is ignored rather than rejected.
//
// Bank pair refinement also applies to partial updates: a PATCH that sets
// bankName without bankAccountNo (or vice-versa) is rejected the same way.
// Partial-only updates that touch neither field are unaffected.
//
// `partialWithoutDefaults`, not `.partial()`: Zod 4 keeps `.default()` inside a
// partial, so `bpjsEnrolled` would parse to `false` on a body that omitted it
// and the PUT handler would silently un-enrol the employee (DRV-1 / HR-7).
export const updateEmployeeSchema = partialWithoutDefaults(employeeBaseObject)
  .superRefine(refineBankAccountPair);

export const employeeStatusReasonSchema = z.object({
  reason: cleanText({ max: 500 }).optional(),
});

// Client form schema for the employees/[id] Profil/Kepegawaian/Saldo Cuti
// edit card (T6, 2026-09-27 admin-finish-standard cycle). The card always
// shows and always sends every field below in one PUT (never a partial
// patch), so:
//  - `role` is a create-only field the edit card never renders — omitted
//    entirely, since its `.default("TEACHER")` would otherwise sneak a
//    `role` key into the wire body that PUT /api/employees/[id] has never
//    accepted (F-13).
//  - `nama`/`email`/`jabatan`/`campusId` carry a `required` asterisk in the
//    UI, so they're narrowed from `updateEmployeeSchema`'s optionality back
//    to required, with the SAME message `employeeBaseObject` already uses.
//  - `hireDate` isn't asterisked, but a present-but-blank value already fails
//    the wire schema's own `min(1, …)` (a blank DatePicker used to reach the
//    server as `""` and 400 there) — requiring it here just moves that same
//    rejection earlier, onto the field, instead of letting a cleared value
//    collapse into "omit the key, keep the existing date".
// Bank-pair reuses `refineBankAccountPair` verbatim — same rule, same paths.
export const employeeEditFormSchema = partialWithoutDefaults(employeeBaseObject)
  .omit({ role: true })
  .extend({
    nama: nameText({ required: "Nama wajib diisi" }),
    email: z.string().trim().min(1, "Email wajib diisi").email("Email tidak valid").max(254, "Maksimal 254 karakter."),
    jabatan: labelText({ required: "Jabatan wajib diisi" }),
    campusId: z.string().min(1, "Kampus wajib dipilih"),
    hireDate: z.string().trim().min(1, "Tanggal masuk wajib diisi"),
  })
  .superRefine(refineBankAccountPair);

export type EmployeeEditFormInput = z.infer<typeof employeeEditFormSchema>;
