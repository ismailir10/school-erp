import { studentDays } from "@/lib/attendance/student-days";
import { prisma } from "@/lib/db";

/**
 * Monthly per-student attendance recap (rekap bulanan kehadiran siswa).
 *
 * Roster-based: every ACTIVE enrollment in scope yields a row, including
 * students with zero marked days — a recap that silently omits never-marked
 * students would hide exactly the gap the yayasan/Dinas report exists to
 * surface. Counts exclude voided records. The flip side is intentional:
 * records belonging to a non-ACTIVE enrollment (student withdrawn or moved
 * sections mid-month) are not re-attributed — the recap reports the current
 * roster, per cycle 2026-06-12 spec assumption 2.
 *
 * `StudentAttendance.date` is a `YYYY-MM-DD` string (Jakarta calendar day),
 * so the month window is a lexicographic gte/lt string compare — no Date
 * arithmetic, no timezone drift.
 */

export type StudentRecapRow = {
  studentId: string;
  name: string;
  nickname: string | null;
  nis: string | null;
  classSectionId: string;
  className: string;
  present: number;
  absent: number;
  sick: number;
  permission: number;
  /** Total non-voided marked days in the month (sum of the four counts). */
  total: number;
};

/**
 * Validate raw month/year query params. Same intent as
 * `app/api/attendance/export` (F-11): junk input must 400, never a
 * misleading-but-200 empty result. Digit-only regexes instead of the
 * String-round-trip used there — the round-trip lets `"NaN"` through
 * (`String(NaN) === "NaN"`, every range compare false) and rejects
 * zero-padded `"06"`, which `<input type="month">` values split into.
 */
export function parseMonthYear(
  monthRaw: string,
  yearRaw: string,
): { month: number; year: number } | null {
  const m = monthRaw.trim();
  const y = yearRaw.trim();
  if (!/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) return null;
  const month = parseInt(m, 10);
  const year = parseInt(y, 10);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return { month, year };
}

/** Inclusive start / exclusive end YYYY-MM-DD strings for a calendar month. */
export function monthWindow(month: number, year: number): { gte: string; lt: string } {
  const mm = String(month).padStart(2, "0");
  const gte = `${year}-${mm}-01`;
  const lt =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { gte, lt };
}

/**
 * Shared request resolver for the recap + export routes: validates
 * month/year, verifies a tenant-owned class section when one is requested,
 * and runs the aggregation. Keeps the two endpoints from drifting apart.
 */
export async function resolveRecapRequest(
  tenantId: string,
  searchParams: URLSearchParams,
): Promise<
  | { ok: true; rows: StudentRecapRow[]; month: number; year: number }
  | { ok: false; error: string; status: 400 | 404 }
> {
  const parsed = parseMonthYear(
    searchParams.get("month") ?? "",
    searchParams.get("year") ?? "",
  );
  if (!parsed) {
    return { ok: false, error: "Bulan dan tahun tidak valid", status: 400 };
  }

  const classSectionId = searchParams.get("classSectionId") || undefined;
  if (classSectionId) {
    const section = await prisma.classSection.findFirst({
      where: { id: classSectionId, tenantId },
      select: { id: true },
    });
    if (!section) {
      return { ok: false, error: "Kelas tidak ditemukan", status: 404 };
    }
  }

  const rows = await getStudentRecap(
    tenantId,
    parsed.month,
    parsed.year,
    classSectionId,
  );
  return { ok: true, rows, month: parsed.month, year: parsed.year };
}

export async function getStudentRecap(
  tenantId: string,
  month: number,
  year: number,
  classSectionId?: string,
): Promise<StudentRecapRow[]> {
  const window = monthWindow(month, year);

  const sectionWhere = classSectionId
    ? { id: classSectionId, tenantId }
    : { tenantId };

  const [enrollments, grouped] = await Promise.all([
    prisma.studentEnrollment.findMany({
      where: {
        status: "ACTIVE",
        classSection: sectionWhere,
        student: { tenantId },
      },
      select: {
        studentId: true,
        classSectionId: true,
        student: { select: { name: true, nickname: true, nis: true } },
        classSection: { select: { name: true } },
      },
    }),
    prisma.studentAttendance.findMany({
      where: {
        isVoided: false,
        classSection: sectionWhere,
        date: { gte: window.gte, lt: window.lt },
      },
      select: { studentId: true, classSectionId: true, date: true, sessionId: true, status: true },
    }),
  ]);

  // counts keyed by studentId:classSectionId
  const counts = new Map<
    string,
    { present: number; absent: number; sick: number; permission: number }
  >();
  for (const g of studentDays(grouped)) {
    const key = `${g.studentId}:${g.classSectionId}`;
    const row =
      counts.get(key) ?? { present: 0, absent: 0, sick: 0, permission: 0 };
    const n = 1;
    if (g.status === "PRESENT") row.present += n;
    else if (g.status === "ABSENT") row.absent += n;
    else if (g.status === "SICK") row.sick += n;
    else if (g.status === "PERMISSION") row.permission += n;
    counts.set(key, row);
  }

  const rows: StudentRecapRow[] = enrollments.map((e) => {
    const c =
      counts.get(`${e.studentId}:${e.classSectionId}`) ??
      { present: 0, absent: 0, sick: 0, permission: 0 };
    return {
      studentId: e.studentId,
      name: e.student.name,
      nickname: e.student.nickname,
      nis: e.student.nis,
      classSectionId: e.classSectionId,
      className: e.classSection.name,
      ...c,
      total: c.present + c.absent + c.sick + c.permission,
    };
  });

  rows.sort(
    (a, b) =>
      a.className.localeCompare(b.className, "id") ||
      a.name.localeCompare(b.name, "id"),
  );
  return rows;
}

/**
 * Quote a CSV cell, escaping embedded double quotes (RFC 4180). Cells
 * starting with a formula trigger (= + - @ or tab) are prefixed with `'` —
 * student names originate from the public /daftar admission form, and Excel
 * evaluates formulas even inside quoted cells when the admin opens the
 * download.
 */
function csvCell(value: string | null): string {
  let v = value ?? "";
  if (/^[=+\-@\t]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

/**
 * Assemble the rekap CSV. Mirrors the employee attendance export contract:
 * header row, CRLF line endings, trailing newline. Status vocabulary maps to
 * the school-facing labels: PRESENT→Hadir, SICK→Sakit, PERMISSION→Izin,
 * ABSENT→Alpa.
 */
export function buildRecapCsv(rows: StudentRecapRow[]): string {
  const header = "NIS,Nama,Kelas,Hadir,Sakit,Izin,Alpa,Total Hari Tercatat";
  const lines = rows.map((r) =>
    [
      csvCell(r.nis),
      csvCell(r.name),
      csvCell(r.className),
      r.present,
      r.sick,
      r.permission,
      r.absent,
      r.total,
    ].join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}
