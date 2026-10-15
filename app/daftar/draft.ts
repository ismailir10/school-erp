// Helpers for the /daftar client: the short confirmation reference (PAR-15)
// and the sessionStorage draft that survives a refresh (PUBX-1).

// v2: the form is one short page now. The v1 draft (3 steps, required child
// data) is a different shape; it is left alone and never read.
export const DRAFT_KEY = "daftar-draft-v2";
const LEGACY_DRAFT_KEY = "daftar-draft-v1";

/** "cmuxyzlit0019dk7d5rxpvmdr" -> "#RXPVMDR" — last 6 chars, upper-cased. */
export function formatAdmissionRef(id: string): string {
  return `#${id.slice(-6).toUpperCase()}`;
}

export type DraftForm = {
  parentName: string;
  parentRelationship: "" | "AYAH" | "IBU" | "WALI";
  parentPhone: string;
  parentEmail: string;
  childName: string;
  dateOfBirth: string;
  childGender: "" | "L" | "P";
  programId: string;
  notes: string;
};

export type Draft = { form: DraftForm };

/** Reads a stored draft; anything missing/corrupt/unavailable yields null. */
export function loadDraft(empty: DraftForm): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { form?: Record<string, unknown> };
    if (!parsed || typeof parsed !== "object" || !parsed.form || typeof parsed.form !== "object") {
      return null;
    }
    const form = { ...empty };
    for (const key of Object.keys(empty) as (keyof DraftForm)[]) {
      const value = parsed.form[key];
      if (typeof value === "string") (form as Record<string, string>)[key] = value;
    }
    if (form.childGender !== "L" && form.childGender !== "P") form.childGender = "";
    if (!["AYAH", "IBU", "WALI"].includes(form.parentRelationship)) form.parentRelationship = "";
    return { form };
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft): void {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage blocked or full — the form just won't survive a refresh.
  }
}

export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
    window.sessionStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // ignore
  }
}
