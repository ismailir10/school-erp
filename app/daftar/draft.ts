// Helpers for the /daftar client: the short confirmation reference (PAR-15)
// and the sessionStorage draft that survives a refresh (PUBX-1).

export const DRAFT_KEY = "daftar-draft-v1";

/** "cmuxyzlit0019dk7d5rxpvmdr" -> "#RXPVMDR" — last 6 chars, upper-cased. */
export function formatAdmissionRef(id: string): string {
  return `#${id.slice(-6).toUpperCase()}`;
}

export type DraftForm = {
  childName: string;
  dateOfBirth: string;
  childGender: "" | "L" | "P";
  parentName: string;
  parentPhone: string;
  parentWhatsapp: string;
  parentEmail: string;
  programId: string;
  notes: string;
};

export type Draft = { step: 1 | 2 | 3; form: DraftForm };

/** Reads a stored draft; anything missing/corrupt/unavailable yields null. */
export function loadDraft(empty: DraftForm): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { step?: unknown; form?: Record<string, unknown> };
    if (!parsed || typeof parsed !== "object" || !parsed.form) return null;
    const form = { ...empty };
    for (const key of Object.keys(empty) as (keyof DraftForm)[]) {
      const value = parsed.form[key];
      if (typeof value === "string") (form as Record<string, string>)[key] = value;
    }
    if (form.childGender !== "L" && form.childGender !== "P") form.childGender = "";
    const step = parsed.step === 2 || parsed.step === 3 ? parsed.step : 1;
    return { step, form };
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
  } catch {
    // ignore
  }
}
