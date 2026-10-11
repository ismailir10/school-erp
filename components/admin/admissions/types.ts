/**
 * Shared row + reference-data shapes for the admissions module, split out of
 * `app/admin/admissions/page.tsx` (T5, cycle 2026-09-27-admin-finish-standard).
 * No behaviour change — moved verbatim.
 */

export type Admission = {
  id: string;
  childName: string;
  childAge: string | null; // legacy free-text; auto-derived from dateOfBirth on new rows
  dateOfBirth: string | null; // YYYY-MM-DD — source of truth for age display
  childGender: string | null;
  parentName: string;
  parentPhone: string | null;
  parentWhatsapp: string | null;
  parentEmail: string | null;
  parentEducation: string | null;
  parentOccupation: string | null;
  parentIncome: string | null;
  parentRelationship: string | null;
  programId: string | null;
  campusPreference: string | null;
  source: string;
  status: string;
  notes: string | null;
  followUpDate: string | null;
  studentId: string | null;
  createdAt: string;
  program: { name: string } | null;
  detectedParent: {
    id: string;
    name: string;
    guardians: Array<{ student: { name: string } }>;
  } | null;
};

export type Program = { id: string; name: string };
