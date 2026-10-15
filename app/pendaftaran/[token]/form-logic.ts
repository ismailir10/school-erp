/**
 * Pure helpers for the public enrollment form: contact-format checks that reuse
 * the server's submit schema, the resume-step calculation, and the mapping from
 * a server 422 field path to "which step, which parent".
 *
 * No React in here so each rule is unit-testable on its own.
 */
import { parentSchema, isSideWaived } from "@/lib/enrollment/submit-validation";
import { ENROLLMENT_FORM_STEPS } from "@/lib/enrollment/steps";
import { missingUploads, type DocumentKey, type PublicDocuments } from "@/lib/enrollment/documents";

export const STEPS = ENROLLMENT_FORM_STEPS;
export const STEP_CONSENT = 5;

// ── Contact fields (phone / email) ──────────────────────────────────────────

export type ContactKey = "phone" | "email" | "employerPhone";
export type ParentSide = "ayah" | "ibu";
/**
 * R2-P-10: which single parent / wali fills the form alone ("" = both parents).
 * The OTHER side is waived: no name, contact checks, consent name or signature.
 */
export type OnlyParent = "" | ParentSide;
export const isWaived = (only: OnlyParent, side: ParentSide): boolean => isSideWaived(only, side);
/** `data-field` value of a contact input, e.g. `ayah.phone`. */
export type ContactFieldKey = `${ParentSide}.${ContactKey}`;

// Validity comes from the server's own schema, so the form can never accept
// something the final submit would reject. Only the wording is ours.
const parentShape = parentSchema.shape;

const CONTACT_MESSAGES: Record<ContactKey, string> = {
  phone: "Nomor HP belum benar. Gunakan angka saja, contoh 0812 3456 7890.",
  email: "Alamat email belum benar. Contoh: nama@email.com.",
  employerPhone: "Telepon kantor belum benar. Gunakan angka saja, contoh 021 8877 402.",
};

/** Error message for one contact value, or null when it is empty or valid. */
export function contactError(key: ContactKey, value: string): string | null {
  return parentShape[key].safeParse(value).success ? null : CONTACT_MESSAGES[key];
}

export type ContactIssue = { key: ContactFieldKey; message: string };

type ParentContacts = { phone: string; email: string; employerPhone: string };

/** Every contact field on a parent step that fails, in on-screen order. */
export function parentContactIssues(side: ParentSide, p: ParentContacts): ContactIssue[] {
  const out: ContactIssue[] = [];
  for (const key of ["phone", "email", "employerPhone"] as const) {
    const message = contactError(key, p[key]);
    if (message) out.push({ key: `${side}.${key}`, message });
  }
  return out;
}

// ── Resume ──────────────────────────────────────────────────────────────────

export type ResumeInput = {
  student: { childName: string; childGender: string; birthPlace: string; dateOfBirth: string; agama: string; kewarganegaraan: string };
  ayah: { name: string } & ParentContacts;
  ibu: { name: string } & ParentContacts;
  programId: string;
  documents: PublicDocuments;
  requiredDocuments: readonly DocumentKey[];
  consent: {
    agreed: boolean;
    ayahName: string;
    ibuName: string;
    ayahSigned: boolean;
    ibuSigned: boolean;
    /** Omitted = both parents. */
    onlyParent?: OnlyParent;
  };
};

/**
 * The step a returning parent should land on: the first one that still lacks
 * required data (or holds a phone/email the server would reject). A draft that
 * is complete everywhere opens on Tinjau; an empty one on Data Anak.
 *
 * The draft stores no step index, so this is derived from the data itself.
 */
export function resumeStep(d: ResumeInput): number {
  const s = d.student;
  if (!s.childName.trim() || !s.childGender || !s.birthPlace.trim() || !s.dateOfBirth || !s.agama || !s.kewarganegaraan) return 0;
  const only = d.consent.onlyParent ?? "";
  if (!isWaived(only, "ayah") && (!d.ayah.name.trim() || parentContactIssues("ayah", d.ayah).length > 0)) return 1;
  if (!isWaived(only, "ibu") && (!d.ibu.name.trim() || parentContactIssues("ibu", d.ibu).length > 0)) return 2;
  if (!d.programId) return 3;
  if (missingUploads(d.documents, d.requiredDocuments).length > 0) return 4;
  const c = d.consent;
  if (!c.agreed) return STEP_CONSENT;
  if (!isWaived(only, "ayah") && (!c.ayahName.trim() || !c.ayahSigned)) return STEP_CONSENT;
  if (!isWaived(only, "ibu") && (!c.ibuName.trim() || !c.ibuSigned)) return STEP_CONSENT;
  return STEPS.length - 1;
}

// ── Server 422 field paths ──────────────────────────────────────────────────

/** "Langkah 2 · Data Ayah" */
export function stepLabel(step: number): string {
  return `Langkah ${step + 1} · ${STEPS[step]}`;
}

export type ServerIssue = {
  step: number;
  /** "Langkah 2 · Data Ayah — Nomor telepon tidak valid" */
  text: string;
  /** Contact input to flag once the parent is back on that step, when there is one. */
  field?: ContactFieldKey;
};

const PATH_STEP: Record<string, number> = {
  studentData: 0,
  ayahData: 1,
  ibuData: 2,
  programId: 3,
  documents: 4,
  consentData: STEP_CONSENT,
};

/**
 * Turns one entry of the 422 `fields` map (`"ayahData.phone": "Nomor telepon
 * tidak valid"`) into a message that names the step. Paths that map to no step
 * (`_root`, unknown keys) come back with `step: null` and the message untouched.
 */
export function describeServerIssue(path: string, message: string): ServerIssue | { step: null; text: string } {
  const [root, leaf] = path.split(".");
  const step = PATH_STEP[root];
  if (step === undefined) return { step: null, text: message };
  const side = root === "ayahData" ? "ayah" : root === "ibuData" ? "ibu" : null;
  const field =
    side && (leaf === "phone" || leaf === "email" || leaf === "employerPhone") ? (`${side}.${leaf}` as ContactFieldKey) : undefined;
  return { step, text: `${stepLabel(step)} — ${message}`, ...(field ? { field } : {}) };
}
