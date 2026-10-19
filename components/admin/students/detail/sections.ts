/**
 * Anchor ids and grouping for the student dossier.
 *
 * Thirteen concerns live in five groups. Every concern keeps the id it had when
 * it was a section of its own, so `#keuangan`, `#pendaftaran`, `#akademik` and
 * the attention-strip jumps still land; the five groups add `group-*` ids of
 * their own. One table maps a sub-section to its group, which is what lets a
 * jump open the right group before it scrolls.
 */
import type { DossierSectionDef } from "@/components/admin/dossier-section";

export const GROUP_PROFIL = "group-profil";
export const GROUP_KELUARGA = "group-keluarga";
export const GROUP_KELAS = "group-kelas";
export const GROUP_KEUANGAN = "group-keuangan";
export const GROUP_CATATAN = "group-catatan";

export const SECTION_DATA_ANAK = "data-anak";
export const SECTION_KESEHATAN = "kesehatan";
export const SECTION_TAMBAHAN = "informasi-tambahan";
export const SECTION_KELUARGA = "keluarga";
export const SECTION_DOKUMEN = "dokumen";
export const SECTION_KELAS_SAAT_INI = "kelas-saat-ini";
export const SECTION_RIWAYAT_KELAS = "riwayat-kelas";
export const SECTION_KEHADIRAN = "kehadiran";
export const SECTION_AKADEMIK = "akademik";
export const SECTION_STATUS = "riwayat-status";
export const SECTION_KEUANGAN = "keuangan";
export const SECTION_KERINGANAN = "keringanan";
export const SECTION_PENDAFTARAN = "pendaftaran";
export const SECTION_JURNAL = "buku-penghubung";

/** The five groups, in render and nav order. */
export const GROUPS: DossierSectionDef[] = [
  { id: GROUP_PROFIL, label: "Profil" },
  { id: GROUP_KELUARGA, label: "Keluarga & Berkas" },
  { id: GROUP_KELAS, label: "Kelas & Akademik" },
  { id: GROUP_KEUANGAN, label: "Keuangan" },
  { id: GROUP_CATATAN, label: "Pendaftaran & Catatan" },
];

const GROUP_OF: Record<string, string> = {
  [SECTION_DATA_ANAK]: GROUP_PROFIL,
  [SECTION_KESEHATAN]: GROUP_PROFIL,
  [SECTION_TAMBAHAN]: GROUP_PROFIL,
  [SECTION_KELUARGA]: GROUP_KELUARGA,
  [SECTION_DOKUMEN]: GROUP_KELUARGA,
  [SECTION_KELAS_SAAT_INI]: GROUP_KELAS,
  [SECTION_RIWAYAT_KELAS]: GROUP_KELAS,
  [SECTION_KEHADIRAN]: GROUP_KELAS,
  [SECTION_AKADEMIK]: GROUP_KELAS,
  [SECTION_STATUS]: GROUP_KELAS,
  [SECTION_KEUANGAN]: GROUP_KEUANGAN,
  [SECTION_KERINGANAN]: GROUP_KEUANGAN,
  [SECTION_PENDAFTARAN]: GROUP_CATATAN,
  [SECTION_JURNAL]: GROUP_CATATAN,
};

/**
 * The sub-sections that cost a request to show. They are the only collapsible
 * rows inside a group, start closed, and fetch only once opened.
 */
export const LAZY_SECTIONS: ReadonlySet<string> = new Set([
  SECTION_KEHADIRAN,
  SECTION_KERINGANAN,
  SECTION_JURNAL,
  SECTION_AKADEMIK,
  SECTION_PENDAFTARAN,
]);

const GROUP_IDS: ReadonlySet<string> = new Set(GROUPS.map((g) => g.id));

/** The group that holds `id` (a group maps to itself); null for an unknown id. */
export function groupOf(id: string): string | null {
  if (GROUP_IDS.has(id)) return id;
  return GROUP_OF[id] ?? null;
}

/**
 * Whether `id` is something this student's page actually renders. Two
 * sub-sections are conditional: Formulir Pendaftaran only for a child who came
 * from a formulir, Riwayat Status only once withdrawn or graduated. A group's
 * closed body may not be in the DOM (it unmounts unless it holds a lazy
 * section), so existence cannot be read off the document.
 */
export function isKnownTarget(
  id: string,
  state: { hasApplication: boolean; lifecycleShown: boolean },
): boolean {
  if (groupOf(id) === null) return false;
  if (id === SECTION_PENDAFTARAN) return state.hasApplication;
  if (id === SECTION_STATUS) return state.lifecycleShown;
  return true;
}

/**
 * Which groups and lazy rows start open. Desktop opens the three the admin
 * reads most (Profil, Keluarga & Berkas, Keuangan); a phone opens only Profil.
 * Lazy rows always start closed: opening one is what pays for its request.
 */
export function defaultOpenSections(isMobile: boolean): Record<string, boolean> {
  const open: Record<string, boolean> = {};
  for (const g of GROUPS) open[g.id] = false;
  for (const id of LAZY_SECTIONS) open[id] = false;
  open[GROUP_PROFIL] = true;
  if (!isMobile) {
    open[GROUP_KELUARGA] = true;
    open[GROUP_KEUANGAN] = true;
  }
  return open;
}
