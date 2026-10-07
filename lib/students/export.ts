/**
 * Student (siswa) data export — column registry + CSV builder.
 *
 * Pure functions only (no Prisma import) so the logic is unit-testable in
 * isolation. The export API route (`/api/students/export`) queries students
 * with the active-enrollment + primary-guardian includes this module's row
 * type expects, then hands the rows here.
 *
 * Response contract matches the other admin exports (attendance, payments,
 * student-attendance): `text/csv`, CRLF line endings, comma delimiter.
 */

import { LIVING_WITH_LABELS } from "@/lib/constants/parent-options";
import { pickPrimaryEnrollment } from "@/lib/enrollment/active";

// ------------------------------------------------------------------
// Row shape — the subset of the student query this module reads.
// ------------------------------------------------------------------

export type StudentExportRow = {
  name: string;
  nickname: string | null;
  gender: string | null;
  birthPlace: string | null;
  dateOfBirth: string | null;
  status: string;
  nis: string | null;
  nisn: string | null;
  nik: string | null;
  kkNumber: string | null;
  address: string | null;
  livingWith: string | null;
  // ALL active enrollments — a student may hold a SEMESTER (sekolah) row
  // and a YEAR_ROUND (daycare) row at once. Empty when the student has none.
  // `program` is non-null: `ClassSection.programId` is a required FK.
  enrollments: {
    id: string;
    enrollDate: string;
    classSection: {
      name: string;
      program: { name: string; type: string };
      academicYear: { name: string } | null;
    };
  }[];
  // Primary guardian, `take: 1` — empty when the student has none.
  guardians: { parent: { name: string; phone: string | null } }[];
};

export type ExportColumnGroup = "identity" | "compliance" | "enrollment" | "guardian";

export type ExportColumn = {
  key: string;
  group: ExportColumnGroup;
  header: string; // Bahasa CSV header
  accessor: (row: StudentExportRow) => string;
};

// ------------------------------------------------------------------
// Display maps — turn stored codes into human-readable Bahasa values.
// ------------------------------------------------------------------

const GENDER_LABELS: Record<string, string> = { L: "Laki-laki", P: "Perempuan" };
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Aktif",
  INACTIVE: "Tidak Aktif",
  GRADUATED: "Lulus",
  WITHDRAWN: "Keluar",
};

const primaryGuardian = (r: StudentExportRow) => r.guardians[0];

/**
 * Active enrollments ordered primary (SEMESTER/sekolah) first, then any
 * other ACTIVE enrollment (e.g. daycare). For the common single-enrollment
 * case this is a no-op array of length 1 — `pickPrimaryEnrollment` is only
 * invoked when there's an actual choice to make.
 */
function orderedEnrollments(r: StudentExportRow) {
  const list = r.enrollments;
  if (list.length <= 1) return list;
  const primary = pickPrimaryEnrollment(list);
  if (!primary) return list;
  return [primary, ...list.filter((e) => e.id !== primary.id)];
}

/**
 * Join one field across every active enrollment with " / " — keeps the CSV
 * column count stable (no new columns) while surfacing both classes for a
 * dual-enrolled student. A single-enrollment student's cell is byte-identical
 * to before (`.join(" / ")` on a 1-element array is just that element).
 */
function joinEnrollmentField(r: StudentExportRow, accessor: (e: StudentExportRow["enrollments"][number]) => string) {
  return orderedEnrollments(r).map(accessor).filter(Boolean).join(" / ");
}

// ------------------------------------------------------------------
// Canonical column registry — CSV column order follows this array,
// NOT the order keys arrive in the request.
// ------------------------------------------------------------------

export const STUDENT_EXPORT_COLUMNS: readonly ExportColumn[] = [
  // Identitas
  { key: "name", group: "identity", header: "Nama Lengkap", accessor: (r) => r.name },
  { key: "nickname", group: "identity", header: "Nama Panggilan", accessor: (r) => r.nickname ?? "" },
  { key: "gender", group: "identity", header: "Jenis Kelamin", accessor: (r) => (r.gender ? (GENDER_LABELS[r.gender] ?? r.gender) : "") },
  { key: "birthPlace", group: "identity", header: "Tempat Lahir", accessor: (r) => r.birthPlace ?? "" },
  { key: "dateOfBirth", group: "identity", header: "Tanggal Lahir", accessor: (r) => r.dateOfBirth ?? "" },
  { key: "status", group: "identity", header: "Status", accessor: (r) => STATUS_LABELS[r.status] ?? r.status },
  { key: "nis", group: "identity", header: "NIS", accessor: (r) => r.nis ?? "" },
  { key: "nisn", group: "identity", header: "NISN", accessor: (r) => r.nisn ?? "" },
  // Data Kependudukan
  { key: "nik", group: "compliance", header: "NIK", accessor: (r) => r.nik ?? "" },
  { key: "kkNumber", group: "compliance", header: "No. KK", accessor: (r) => r.kkNumber ?? "" },
  { key: "address", group: "compliance", header: "Alamat", accessor: (r) => r.address ?? "" },
  { key: "livingWith", group: "compliance", header: "Tinggal Bersama", accessor: (r) => (r.livingWith ? (LIVING_WITH_LABELS[r.livingWith] ?? r.livingWith) : "") },
  // Kelas & Pendaftaran — from ALL active enrollments, joined " / " (primary
  // first) when a student holds more than one (e.g. sekolah + daycare).
  { key: "classSection", group: "enrollment", header: "Kelas", accessor: (r) => joinEnrollmentField(r, (e) => e.classSection.name) },
  { key: "program", group: "enrollment", header: "Program", accessor: (r) => joinEnrollmentField(r, (e) => e.classSection.program.name) },
  { key: "academicYear", group: "enrollment", header: "Tahun Ajaran", accessor: (r) => joinEnrollmentField(r, (e) => e.classSection.academicYear?.name ?? "") },
  { key: "enrollDate", group: "enrollment", header: "Tanggal Daftar", accessor: (r) => joinEnrollmentField(r, (e) => e.enrollDate) },
  // Wali Murid (primary guardian)
  { key: "guardianName", group: "guardian", header: "Nama Wali", accessor: (r) => primaryGuardian(r)?.parent.name ?? "" },
  { key: "guardianPhone", group: "guardian", header: "No. Telepon Wali", accessor: (r) => primaryGuardian(r)?.parent.phone ?? "" },
] as const;

export const EXPORT_GROUP_LABELS: Record<ExportColumnGroup, string> = {
  identity: "Identitas",
  compliance: "Data Kependudukan",
  enrollment: "Kelas & Pendaftaran",
  guardian: "Wali Murid",
};

/** Registry keys in canonical order — the default export when none requested. */
export const ALL_EXPORT_COLUMN_KEYS: readonly string[] = STUDENT_EXPORT_COLUMNS.map((c) => c.key);

/**
 * Resolve requested column keys to ExportColumn objects in canonical order.
 * Empty/undefined ⇒ all columns. Unknown keys are ignored.
 */
export function selectExportColumns(keys?: readonly string[] | null): ExportColumn[] {
  if (!keys || keys.length === 0) return [...STUDENT_EXPORT_COLUMNS];
  const requested = new Set(keys);
  return STUDENT_EXPORT_COLUMNS.filter((c) => requested.has(c.key));
}

/**
 * UTF-8 byte-order mark. Excel opens a BOM-less CSV as the legacy ANSI code
 * page and garbles non-ASCII names ("Ā", "é"), so every human-facing CSV
 * download prepends this as the first bytes of the body. NOT for files a bank
 * or other machine parser consumes (it would corrupt the first header cell).
 */
export const CSV_BOM = "\uFEFF";

/**
 * Escape a single CSV cell.
 *
 * 1. Formula-injection guard: a value whose first character is one of
 *    `= + - @` (or a leading tab / CR that some apps treat as a formula
 *    lead-in) is prefixed with an apostrophe so spreadsheets render it as
 *    literal text instead of executing it. The CSV quotes a parser strips
 *    do NOT neutralise this — the guard must live in the value itself.
 * 2. Every cell is wrapped in double quotes with internal quotes doubled.
 *    Always-quoting sidesteps delimiter/newline edge cases entirely.
 */
export function escapeCsvCell(value: string): string {
  let v = value ?? "";
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

/**
 * Build the CSV document for the given rows + selected column keys.
 * Always emits a header row, so an empty `rows` array yields a valid
 * header-only CSV (never a misleading empty body).
 */
export function buildStudentCsv(rows: readonly StudentExportRow[], keys?: readonly string[] | null): string {
  const cols = selectExportColumns(keys);
  const header = cols.map((c) => escapeCsvCell(c.header)).join(",");
  const lines = rows.map((row) => cols.map((c) => escapeCsvCell(c.accessor(row))).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}
