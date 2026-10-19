/**
 * Pure one-liners for the student dossier's five groups. Each is shown only
 * while its group is collapsed, so a closed group still answers "what is in
 * there". Kept out of the page so the wording is testable without rendering.
 *
 * Rule for every function here: a part whose data has not arrived is omitted
 * (or shown as "Memuat…" / "—" where that is the whole answer), never a made-up
 * zero.
 */
import { formatDateShort, formatRupiah } from "@/lib/format";
import type { StudentInvoiceSummary } from "@/lib/finance/student-invoice-summary";

const join = (parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(" · ");

const GENDER_LABEL: Record<string, string> = { L: "Laki-laki", P: "Perempuan" };

export function profilSummary({
  nis,
  gender,
  allergy,
}: {
  nis: string | null;
  gender: string | null;
  allergy: string | null | undefined;
}): string {
  return join([
    nis?.trim() ? `NIS ${nis.trim()}` : "NIS belum diisi",
    gender ? GENDER_LABEL[gender] : null,
    allergy?.trim() ? `Alergi ${allergy.trim()}` : null,
  ]);
}

export function keluargaSummary({
  guardianCount,
  siblingCount,
  docsPresent,
  docsTotal,
}: {
  guardianCount: number;
  siblingCount: number;
  docsPresent: number;
  docsTotal: number;
}): string {
  return join([
    guardianCount > 0 ? `${guardianCount} wali` : "Belum ada wali",
    siblingCount > 0 ? `${siblingCount} saudara` : null,
    docsTotal > 0 ? `Berkas ${docsPresent}/${docsTotal}` : null,
  ]);
}

export function kelasSummary({
  className,
  attendance,
  raport,
}: {
  className: string | null;
  /** Null until the overview has loaded (or when it failed). */
  attendance: { present: number; total: number } | null;
  /** Null until the overview has loaded (or when it failed). */
  raport: { published: number; total: number } | null;
}): string {
  return join([
    className?.trim() ? className.trim() : "Belum terdaftar di kelas",
    attendance && attendance.total > 0 ? `Hadir ${attendance.present}/${attendance.total}` : null,
    raport && raport.total > 0 ? `Raport ${raport.published}/${raport.total} terbit` : null,
  ]);
}

export function keuanganSummary({
  loading,
  error,
  summary,
  keringananCount,
}: {
  loading: boolean;
  error: boolean;
  summary: Pick<StudentInvoiceSummary, "invoiceCount" | "outstanding">;
  /** Known only once the lazy Keringanan row has been opened. */
  keringananCount: number | null;
}): string {
  if (loading) return "Memuat…";
  if (error) return "—";
  const money =
    summary.outstanding > 0
      ? `${formatRupiah(summary.outstanding)} belum dibayar`
      : summary.invoiceCount > 0
        ? "Semua tagihan lunas"
        : "Belum ada tagihan";
  return join([money, keringananCount != null && keringananCount > 0 ? `${keringananCount} keringanan` : null]);
}

/**
 * `application` is null for a child entered by hand, undefined while the
 * overview is still loading (or failed): then the metadata's own pointer to the
 * formulir is the only thing known, and with neither there is nothing honest to
 * say yet.
 */
export function catatanSummary({
  application,
  fromFormulir,
}: {
  application: { submittedAt: string | null } | null | undefined;
  fromFormulir: boolean;
}): string | undefined {
  if (application === undefined) return fromFormulir ? "Formulir" : undefined;
  if (application === null) return "Input manual";
  return application.submittedAt ? `Formulir ${formatDateShort(application.submittedAt)}` : "Formulir belum dikirim";
}
