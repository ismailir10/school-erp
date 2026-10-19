/**
 * Pure one-liners for the wali dossier: collapsed-section summaries, rail
 * hints and the "Perlu perhatian" document wording. Kept out of the page so
 * the wording is testable without rendering.
 */
import { formatRupiah } from "@/lib/format";
import type { ParentDetail } from "./types";

/** Distinct class names in the order the children appear; unplaced children are skipped. */
export function childClassNames(guardians: ParentDetail["guardians"]): string[] {
  const seen = new Set<string>();
  for (const g of guardians) {
    const name = g.student.className?.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

export function childrenSummary(guardians: ParentDetail["guardians"]): string {
  if (guardians.length === 0) return "Belum ada anak terdaftar";
  const classes = childClassNames(guardians);
  const head = `${guardians.length} anak`;
  return classes.length > 0 ? `${head} · ${classes.join(", ")}` : head;
}

export function invoicesSummary(summary: ParentDetail["invoiceSummary"]): string {
  if (summary.invoiceCount === 0) return "Belum ada tagihan";
  if (summary.outstanding > 0) {
    return `${formatRupiah(summary.outstanding)} belum dibayar · ${summary.unpaidCount} dari ${summary.invoiceCount} tagihan`;
  }
  return "Tidak ada tunggakan";
}

/** Names the key contact fields still empty, so a closed Data Wali still says what is missing. */
export function profileSummary(parent: Pick<ParentDetail, "phone" | "email" | "address">): string {
  const missing: string[] = [];
  if (!parent.phone?.trim()) missing.push("Telepon belum diisi");
  if (!parent.email?.trim()) missing.push("Email belum diisi");
  if (!parent.address?.trim()) missing.push("Alamat belum diisi");
  return missing.length > 0 ? missing.join(" · ") : "Lengkap";
}

export function documentsSummary(parent: Pick<ParentDetail, "hasKtp" | "hasKk">): string {
  return `KTP ${parent.hasKtp ? "ada" : "belum ada"} · KK ${parent.hasKk ? "ada" : "belum ada"}`;
}

/** "KTP belum diunggah" / "KK belum diunggah" / "KTP dan KK belum diunggah"; null when both are on file. */
export function missingDocumentsText(parent: Pick<ParentDetail, "hasKtp" | "hasKk">): string | null {
  if (!parent.hasKtp && !parent.hasKk) return "KTP dan KK belum diunggah";
  if (!parent.hasKtp) return "KTP belum diunggah";
  if (!parent.hasKk) return "KK belum diunggah";
  return null;
}
