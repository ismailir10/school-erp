/**
 * Shared row + reference-data shapes for the unified Pendaftaran list
 * (`GET /api/admissions`, cycle 2026-10-11-pendaftaran-simplify).
 *
 * One row = one lead. The server derives where the family stands (`stage`), what
 * they owe (`payment`) and which formulir belongs to the lead (`application`),
 * so the screen never reads the lead's own `status` to decide anything.
 */

/** Where a family stands, derived server-side from the lead, its formulir and the student link. */
export type AdmissionStage =
  | "BARU"
  | "FORMULIR_DIKIRIM"
  | "FORMULIR_MASUK"
  | "DITERIMA"
  | "SISWA"
  | "DITOLAK"
  | "BATAL";

/** NONE = no pendaftaran fee row (no formulir yet, a formulir not yet submitted, or a free program). */
export type AdmissionPayment = "UNPAID" | "PAID" | "WAIVED" | "NONE";

/** The lead's formulir (EnrollmentApplication), when one was sent. */
export type AdmissionApplication = {
  id: string;
  status: string;
  programName: string | null;
  /** The name written on the formulir ("" when blank); the list prefers it when the lead has none. */
  childName: string;
  studentId: string | null;
  submittedAt: string | null;
  /** null = no fee row. `canRemind`: a WhatsApp number exists and the fee is still unpaid. */
  fee: null | {
    status: "UNPAID" | "PAID" | "WAIVED";
    amount: number;
    canRemind: boolean;
  };
};

export type Admission = {
  id: string;
  childName: string; // "" when the child is not named yet
  childAge: string | null; // legacy free-text; auto-derived from dateOfBirth on new rows
  dateOfBirth: string | null; // YYYY-MM-DD — source of truth for age display
  childGender: string | null;
  parentName: string;
  parentPhone: string | null;
  parentWhatsapp: string | null;
  parentEmail: string | null;
  parentRelationship: string | null;
  programId: string | null;
  source: string;
  /** The lead's own status (INQUIRY / CANCELLED, or a legacy value). Display and logic use `stage`. */
  status: string;
  notes: string | null;
  studentId: string | null;
  createdAt: string;
  program: { name: string } | null;
  detectedParent: {
    id: string;
    name: string;
    guardians: Array<{ student: { name: string } }>;
  } | null;
  stage: AdmissionStage;
  payment: AdmissionPayment;
  application: AdmissionApplication | null;
};

/** Counts for the whole school; filters on the list do not change them. */
export type AdmissionStats = {
  total: number;
  baru: number;
  formulirDikirim: number;
  /** Every lead with an open unpaid fee: exactly what the `payment=unpaid` filter lists. */
  belumBayar: number;
  formulirMasuk: number;
  diterima: number;
  siswa: number;
};

export type Program = { id: string; name: string };
