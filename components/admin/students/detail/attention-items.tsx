import type { AttentionItem } from "@/components/admin/attention-strip";
import { formatRupiah } from "@/lib/format";
import type { StudentInvoiceSummary } from "@/lib/finance/student-invoice-summary";
import {
  SECTION_AKADEMIK,
  SECTION_DATA_ANAK,
  SECTION_DOKUMEN,
  SECTION_KELUARGA,
  SECTION_KEUANGAN,
  SECTION_PENDAFTARAN,
} from "./sections";

/**
 * A berkas the student is missing, and where it can be fixed: a section of this
 * page (`section`) or another page (`href`, the wali's, which owns KTP upload).
 */
export type MissingDoc = { label: string; section?: string; href?: string };

export const DOC_TARGET_FOTO = { section: SECTION_DATA_ANAK } as const;
export const DOC_TARGET_KK = { section: SECTION_DOKUMEN } as const;
export const DOC_TARGET_PENDAFTARAN = { section: SECTION_PENDAFTARAN } as const;
export const guardianDocumentsHref = (parentId: string) => `/admin/guardians/${parentId}#documents`;

/**
 * "Perlu perhatian" for a student: only what applies, in the order an admin
 * acts on it — money owed, no class, no wali (utama), missing berkas, raport
 * still draft. Every row has one button that does the thing: open a dialog or
 * jump to (and open) the section that fixes it.
 *
 * Pure: the page passes what it already has plus two callbacks, so each
 * condition is testable without rendering the page.
 */
export function buildStudentAttentionItems({
  studentName,
  canEdit,
  isActive,
  isPlaced,
  invoices,
  activeGuardianCount,
  hasPrimaryGuardian,
  missingDocs,
  raportDraft,
  onJump,
  onEnroll,
}: {
  studentName: string;
  canEdit: boolean;
  isActive: boolean;
  /** Has a current (non-archived) class, school or day care. */
  isPlaced: boolean;
  /** Money is shown only once the invoice fetch has landed: never a made-up 0. */
  invoices: { loading: boolean; error: boolean; summary: StudentInvoiceSummary };
  activeGuardianCount: number;
  hasPrimaryGuardian: boolean;
  /** In the order an admin fixes them; the button lands on the first one. */
  missingDocs: MissingDoc[];
  /** Null until the overview has loaded (or when it failed). */
  raportDraft: number | null;
  onJump: (sectionId: string) => void;
  onEnroll: () => void;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { loading, error, summary } = invoices;

  if (!loading && !error && summary.outstanding > 0) {
    items.push({
      id: "owed",
      message: (
        <>
          <strong className="font-currency font-semibold">{formatRupiah(summary.outstanding)}</strong> belum dibayar
          {" · "}
          {summary.unpaidCount} tagihan{summary.overdueCount > 0 ? `, ${summary.overdueCount} lewat tempo` : ""}
        </>
      ),
      action: { label: "Lihat tagihan", onClick: () => onJump(SECTION_KEUANGAN), testId: "attention-owed" },
    });
  }

  if (isActive && !isPlaced) {
    items.push({
      id: "no-class",
      message: "Belum terdaftar di kelas",
      // The header carries the same words; a longer name tells them apart.
      action: canEdit
        ? {
            label: "Daftarkan ke Kelas",
            ariaLabel: `Daftarkan ke Kelas untuk ${studentName}`,
            onClick: onEnroll,
            testId: "attention-enroll",
          }
        : undefined,
    });
  }

  if (activeGuardianCount === 0 || !hasPrimaryGuardian) {
    items.push({
      id: "no-guardian",
      message: activeGuardianCount === 0 ? "Belum ada wali" : "Belum ada wali utama",
      action: canEdit
        ? { label: "Atur wali", onClick: () => onJump(SECTION_KELUARGA), testId: "attention-guardian" }
        : undefined,
    });
  }

  if (missingDocs.length > 0) {
    const first = missingDocs[0];
    items.push({
      id: "documents",
      message: `Berkas belum ada: ${missingDocs.map((d) => d.label).join(", ")}`,
      action: canEdit
        ? {
            label: "Lengkapi berkas",
            testId: "attention-documents",
            ...(first.href
              ? { href: first.href }
              : { onClick: () => onJump(first.section ?? SECTION_DOKUMEN) }),
          }
        : undefined,
    });
  }

  if (raportDraft != null && raportDraft > 0) {
    items.push({
      id: "raport",
      message: `Rapor: ${raportDraft} masih draf`,
      action: { label: "Buka rapor", onClick: () => onJump(SECTION_AKADEMIK), testId: "attention-raport" },
    });
  }

  return items;
}
