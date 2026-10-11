/**
 * The seven steps of the parent's pendaftaran form, in order. One list for the
 * form's stepper (`app/pendaftaran/[token]/form-logic.ts`) and for the "Bayar
 * dulu" screen, which tells the parent what is waiting for them after paying.
 * Kept here, with no React and no Prisma, so server and client can both import it.
 */
export const ENROLLMENT_FORM_STEPS = [
  "Data Anak",
  "Data Ayah",
  "Data Ibu",
  "Program",
  "Berkas",
  "Persetujuan",
  "Tinjau",
] as const;
