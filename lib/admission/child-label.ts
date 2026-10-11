/** Placeholder shown wherever a lead has no child name yet (the column stores "" in that case). */
export const ADMISSION_CHILD_PLACEHOLDER = "Belum diisi";

/** Display label for a lead's child name; an empty/blank name reads "Belum diisi". */
export function admissionChildLabel(name: string | null | undefined): string {
  return name?.trim() || ADMISSION_CHILD_PLACEHOLDER;
}
